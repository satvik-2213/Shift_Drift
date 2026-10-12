#!/usr/bin/env python3
"""
Syncs a company-wide employee roster (join date, exit date, current
department/designation) into server/output/attendance.db, for HR headcount
and attrition reporting - a separate concern from the shift-drift attendance
pipeline, so this is its own table/sync script/API routes, touching none of
that existing code.

Sources:
  - EMPMAST for date of joining, designation, and exit date. EMPMAST has one
    row per employee per department/location transfer (see
    import_attendance.py's fetch_rows docstring) - the "current" row is
    picked the same way (CONSIDER='0' preferred - confirmed with HR/IT as
    the flag marking the row to use, highest trid tie-break for employees
    with more than one such row - see find_ambiguous_empmast_emp_codes).
    Date of joining itself is taken as MIN(DT_JOIN) across all of an
    employee's rows instead, since that's consistent across 99%+ of
    multi-row employees regardless of which row "wins" for department
    purposes, and sidesteps the ambiguity entirely for this one field.
  - EMPMAST.DTRETIR for exit date, taken from that same "current" row -
    confirmed with HR/IT as the only exit-date field EMPMAST has.
    1900-01-01 00:00:00.000 is EMPMAST's sentinel for "not set" (same idea
    as the dtretir sentinel the old leftemployees source used) - treated
    as still-active, same as NULL, by resolve_exit_date below. DTRETIR is
    also just stale for a real, provable subset of employees - verified
    against real data (240 company-wide, ~2.8% of everyone marked exited):
    people with a DTRETIR date from years ago who are still punching in
    every working day right now.

    resolve_exit_date_with_attendance below overrides DTRETIR to "still
    active" only when the employee's most recent DAYFILE punch is (a) recent
    (within RECENT_ACTIVITY_WINDOW_DAYS of today) AND (b) well past DTRETIR -
    more than EXIT_GAP_BUFFER_DAYS after it, not merely "after" it.

    Two overcorrections already found and fixed by these two conditions:
      - "any punch after DTRETIR, ever" (no recency check) flipped 7,289 of
        8,499 exited employees back to active company-wide, not the 240 real
        contradictions - most exits have a stray punch shortly after their
        recorded exit date (notice period, clearance processing), which
        doesn't mean they're still employed *today*. Fixed by (a).
      - "any punch after DTRETIR that's also recent" (no gap buffer) then
        wrongly flipped genuine *recent* exits too - someone who left in
        September legitimately can still have a punch a few days after their
        recorded DTRETIR (same notice-period overlap), and "a few days ago"
        is also "recent". Fixed by (b): only a gap of real substance (weeks+)
        past DTRETIR, not a few days of overlap, counts as a contradiction.
  - DAYFILE (most recent punch, by PDATE) for current department/location,
    NOT EMPMAST - verified against real data that EMPMAST.location_id can
    sit stuck at a stale/placeholder value (e.g. "HO") for months after
    someone's actually working elsewhere, while DAYFILE's own DEPT_CODE/
    Location_Id columns are populated fresh on every punch and reflect
    where the employee is actually clocking in. Falls back to EMPMAST's
    department/location only for employees with zero DAYFILE rows at all
    (e.g. a brand new joiner who hasn't punched in yet).
  - EMPMAST.GROUPCODE for "block" (860 -> DS15, 861 -> DS1, anything else ->
    no block) - an Attrition-tab-only distinction, see BLOCK_BY_GROUPCODE.
    Not surfaced anywhere on the Shift Drift side; attendance_days has no
    such column and never will.

NOT done: merging EMP_CODEs that share a DOB+Mobile match shortly after an
exit (an earlier version of this script did this, to handle employees
re-issued a new code for the same continuous job - a promotion, a
contract-to-permanent conversion). Tried against a real case (same DOB and
Mobile on both codes, old code's exit the day before the new code's join)
that looked exactly like a re-code - turned out, confirmed with HR, to
actually be a genuine resignation followed by a genuine rehire out of
retirement. That real-world case is structurally IDENTICAL in the data to
a true re-code: same person, exit on one code, join on another shortly
after. There is no field in EMPMAST that tells the two apart - only HR's
own knowledge of what actually happened does - so a DOB+Mobile+date-gap
heuristic can't safely distinguish "still the same job, just re-coded"
from "really left and really came back", and would silently hide real
attrition events for anyone who's ever been rehired. Don't reintroduce this
without a field that actually signals which case it is.

Usage:
    python3 import_employee_roster.py
"""
import os
from datetime import datetime, timedelta

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")

# How recent a post-DTRETIR punch has to be to count as "still actively
# employed today" (not someone who was active for a while after a wrong exit
# date but has since genuinely left) - see resolve_exit_date_with_attendance.
RECENT_ACTIVITY_WINDOW_DAYS = 30

# How far past DTRETIR that punch has to fall to count as a real contradiction
# rather than normal notice-period/clearance overlap right around the exit
# date. The real contradictions found in practice were months to years past
# DTRETIR; a genuine exit's trailing punches are typically days, not weeks.
EXIT_GAP_BUFFER_DAYS = 45


def load_env_file(path):
    """Minimal KEY=VALUE .env loader (stdlib only) - doesn't override
    anything already set in the real environment. Strips one layer of
    matching quotes so a value like DB_PASSWORD='foo' isn't taken literally
    with the quotes included."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if key and key not in os.environ:
                os.environ[key] = value


load_env_file(ENV_PATH)

import db
import import_attendance as ia

ROSTER_QUERY = """
SELECT
    codes.EMP_CODE AS EmpID,
    emp.EMP_NAME AS EmpName,
    COALESCE(LTRIM(RTRIM(latest.DEPT_CODE)), LTRIM(RTRIM(emp.DEPT_CODE))) AS Department,
    COALESCE(LTRIM(RTRIM(latest.Location_Id)), LTRIM(RTRIM(emp.location_ID))) AS LocationID,
    td.desgdesc AS Designation,
    joins.MinJoin AS DateOfJoining,
    emp.DTRETIR AS DateExited,
    latest.PDATE AS LastPunch,
    emp.GROUPCODE AS GroupCode
FROM (SELECT DISTINCT EMP_CODE FROM EMPMAST) codes
OUTER APPLY (
    SELECT TOP 1 em.* FROM EMPMAST em WHERE em.EMP_CODE = codes.EMP_CODE
    ORDER BY CASE WHEN em.CONSIDER = '0' THEN 0 ELSE 1 END, em.trid DESC
) emp
OUTER APPLY (
    SELECT TOP 1 d.DEPT_CODE, d.Location_Id, d.PDATE
    FROM DAYFILE d WHERE d.EMP_CODE = codes.EMP_CODE
    ORDER BY d.PDATE DESC
) latest
OUTER APPLY (
    SELECT TOP 1 td2.desgdesc FROM tabDesignation td2
    WHERE td2.desgcode = TRY_CAST(emp.DESIGN AS INT)
    ORDER BY CASE
        WHEN UPPER(LTRIM(RTRIM(td2.location_id))) = UPPER(LTRIM(RTRIM(COALESCE(latest.Location_Id, emp.location_ID)))) THEN 0
        ELSE 1
    END
) td
OUTER APPLY (
    SELECT MIN(DT_JOIN) AS MinJoin FROM EMPMAST em2 WHERE em2.EMP_CODE = codes.EMP_CODE
) joins
"""


# EMPMAST.GROUPCODE -> the Attrition-tab-only "block" distinction. Any other
# group code (or a blank/unrecognized one) gets no block, same as having no
# location - "All blocks" still includes them, a specific block filter won't.
BLOCK_BY_GROUPCODE = {
    "860": "DS15",
    "861": "DS1",
}


def resolve_block(group_code):
    if group_code is None:
        return None
    return BLOCK_BY_GROUPCODE.get(str(group_code).strip())


def resolve_exit_date(value):
    """EMPMAST.DTRETIR -> ISO exit date, or None if the employee hasn't
    resigned. None and the 1900-01-01 00:00:00.000 sentinel (EMPMAST's way
    of saying "not set", same idea as the old leftemployees dtretir
    sentinel) both mean "still active". pymssql hands DATETIME columns back
    as datetime objects, but a plain string is handled too in case the
    column ever comes back as varchar."""
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    if parsed.year <= 1900:
        return None
    return parsed.strftime("%Y-%m-%d")


def resolve_exit_date_with_attendance(dtretir_value, last_punch, recent_cutoff=None, gap_cutoff_fn=None):
    """resolve_exit_date, but overridden back to "still active" (None) only
    if the employee's most recent DAYFILE punch is recent (within
    RECENT_ACTIVITY_WINDOW_DAYS) AND falls more than EXIT_GAP_BUFFER_DAYS
    after the resolved exit date - see the module docstring for why both
    conditions are needed, not just one.
    `recent_cutoff` is an ISO date string; defaults to today minus the
    window. `gap_cutoff_fn` maps an exit-date string to the ISO date string
    a punch must clear (defaults to exit_date + EXIT_GAP_BUFFER_DAYS). Both
    are parameters so this stays testable without mocking the clock."""
    exit_date = resolve_exit_date(dtretir_value)
    if exit_date is None or last_punch is None:
        return exit_date
    last_punch_date = last_punch.strftime("%Y-%m-%d") if isinstance(last_punch, datetime) else str(last_punch)[:10]
    if recent_cutoff is None:
        recent_cutoff = (datetime.utcnow() - timedelta(days=RECENT_ACTIVITY_WINDOW_DAYS)).strftime("%Y-%m-%d")
    if gap_cutoff_fn is None:
        gap_cutoff_fn = lambda d: (datetime.strptime(d, "%Y-%m-%d") + timedelta(days=EXIT_GAP_BUFFER_DAYS)).strftime("%Y-%m-%d")
    if last_punch_date >= recent_cutoff and last_punch_date > gap_cutoff_fn(exit_date):
        return None
    return exit_date


def main():
    dayfile_conn = ia.get_connection()
    try:
        cursor = dayfile_conn.cursor()
        cursor.execute(ROSTER_QUERY)
        roster_rows = cursor.fetchall()
    finally:
        dayfile_conn.close()

    rows = []
    overridden = 0
    for r in roster_rows:
        doj = r["DateOfJoining"]
        raw_exit = resolve_exit_date(r["DateExited"])
        exit_date = resolve_exit_date_with_attendance(r["DateExited"], r["LastPunch"])
        if raw_exit is not None and exit_date is None:
            overridden += 1
        rows.append((
            r["EmpID"],
            r["EmpName"] or "",
            r["Department"] or "",
            r["Designation"] or "",
            r["LocationID"] or "",
            doj.strftime("%Y-%m-%d") if doj else None,
            exit_date,
            resolve_block(r["GroupCode"]),
        ))

    conn = db.get_connection()
    try:
        db.replace_employee_roster(conn, rows)
    finally:
        conn.close()

    with_exit = sum(1 for r in rows if r[6])
    print(f"Synced {len(rows)} employees ({with_exit} with a known exit date from EMPMAST.DTRETIR, "
          f"{overridden} overridden back to active - DTRETIR said exited but they're still punching in).")


if __name__ == "__main__":
    main()
