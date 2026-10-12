#!/usr/bin/env python3
"""
Pulls one day's completed attendance from the laurus DB (DAYFILE + EMPMAST +
tabDesignation) and upserts it into server/output/attendance.db (SQLite), the
store Shift Drift's live dashboard (server/app.py) queries. Each employee-day
row is classified (assigned shift bucket, derived bucket, Early/Late/On-time
flag - see shift_rules.py) at import time, not at query time, so the
dashboard stays fast however much history has accumulated.

The source system only imports new punches once a night, so this is meant
to run once nightly (~00:30, half an hour after that import), not on a
short interval. Each run replaces just that day's rows (db.upsert_day), so
re-running a date (backfill, retry) is idempotent and every other date's
history is left untouched. To seed a longer backfill in one go, use
server/backfill.py instead of calling this script in a loop.

Connection settings come from environment variables (loaded from server/.env
automatically, same as every other script here - no need to `export` them
into the shell yourself) so credentials never get committed:
    DB_SERVER     e.g. 10.0.1.25  or myserver\\SQLEXPRESS
    DB_PORT       default 1433
    DB_NAME       default laurus
    DB_USER
    DB_PASSWORD

Usage:
    python3 import_attendance.py              # pulls yesterday
    python3 import_attendance.py 2026-09-30   # pulls a specific date
"""
import os
import sys
from datetime import date, datetime, timedelta

import pymssql

import db
import shift_rules

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")


def load_env_file(path):
    """Minimal KEY=VALUE .env loader (stdlib only) - same pattern as every
    other script in this project (app.py, import_employee_roster.py, ...).
    Doesn't override anything already set in the real environment, so an
    explicit `export DB_SERVER=...` before running this still wins."""
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

# WH (weekly holiday) and anything not in this list is deliberately excluded -
# there's no shift window to compare attendance against for those rows.
KNOWN_SHIFT_CODES = ["GS", "AS", "BS", "CS"]


def get_connection():
    server = os.environ["DB_SERVER"]
    port = os.environ.get("DB_PORT", "1433")
    database = os.environ.get("DB_NAME", "laurus")
    user = os.environ["DB_USER"]
    password = os.environ["DB_PASSWORD"]
    kwargs = {}
    if os.environ.get("DB_TDS_VERSION"):
        kwargs["tds_version"] = os.environ["DB_TDS_VERSION"]
    return pymssql.connect(
        server=server, port=port, database=database,
        user=user, password=password, as_dict=True,
        **kwargs,
    )


def hhmm_to_hour_minute(value):
    """DAYFILE stores times as HH.MM - the fractional digits ARE the minutes,
    not a decimal fraction of an hour (confirmed against TOTHRSWORK across
    multiple rows, including an overnight CS-shift row). Formatting to a
    fixed 2 decimal places recovers any trailing zero the float dropped
    (17.3 -> "17.30" -> 17:30), instead of doing fraction*60 math that would
    silently misread 17.3 as 17:18."""
    text = f"{float(value):.2f}"
    hour_str, minute_str = text.split(".")
    hour, minute = int(hour_str), int(minute_str)
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"Unexpected HH.MM value: {value!r}")
    return hour, minute


def fetch_rows(conn, target_date):
    """EMPMAST keeps one row per employee per department/location transfer
    (not one row per employee), and tabDesignation is keyed per
    (desgcode, location_id), not just desgcode - a plain LEFT JOIN on either
    fans one DAYFILE row out into several duplicates. The OUTER APPLYs below
    pick exactly one row from each:
      - EMPMAST: prefer CONSIDER='0' - confirmed with HR/IT as the flag
        marking the row to use, tie-broken by highest trid for the
        employees who have more than one CONSIDER='0' row (see
        find_ambiguous_empmast_emp_codes). Only used here for EMP_NAME and
        DESIGN (designation code) - NOT department/location, see below.
      - tabDesignation: prefer the row whose location_id matches the punch's
        own DAYFILE location (case/whitespace-insensitive), falling back to
        any row for that desgcode if no location match exists.

    Department/location come straight from DAYFILE's own DEPT_CODE/Location_Id
    columns, not from the EMPMAST row - verified against real data that
    EMPMAST.location_id can sit stuck at a stale/placeholder value (e.g. "HO")
    for months after someone's actually working elsewhere, while DAYFILE's
    own columns are populated fresh on every punch and reflect where the
    employee is actually clocking in that day.
    """
    shift_list = ",".join(f"'{code}'" for code in KNOWN_SHIFT_CODES)
    query = f"""
        SELECT
            d.EMP_CODE   AS EmpID,
            d.PDATE      AS PunchDate,
            d.SHIFTCODE  AS ShiftCode,
            d.FirstIn    AS FirstIn,
            e.EMP_NAME   AS EmpName,
            LTRIM(RTRIM(d.DEPT_CODE))    AS Department,
            LTRIM(RTRIM(d.Location_Id))  AS LocationID,
            td.desgdesc  AS Designation
        FROM DAYFILE d
        OUTER APPLY (
            SELECT TOP 1 em.*
            FROM EMPMAST em
            WHERE em.EMP_CODE = d.EMP_CODE
            ORDER BY CASE WHEN em.CONSIDER = '0' THEN 0 ELSE 1 END, em.trid DESC
        ) e
        OUTER APPLY (
            SELECT TOP 1 td2.desgdesc
            FROM tabDesignation td2
            WHERE td2.desgcode = TRY_CAST(e.DESIGN AS INT)
            ORDER BY CASE
                WHEN UPPER(LTRIM(RTRIM(td2.location_id))) = UPPER(LTRIM(RTRIM(d.Location_Id))) THEN 0
                ELSE 1
            END
        ) td
        WHERE d.PDATE = %(target_date)s
          AND d.STATUS = 'XX'
          AND d.SHIFTCODE IN ({shift_list})
          AND d.FirstIn IS NOT NULL
    """
    cursor = conn.cursor()
    cursor.execute(query, {"target_date": target_date})
    return cursor.fetchall()


def find_ambiguous_empmast_emp_codes(conn):
    """EMP_CODEs with more than one CONSIDER='0' row in EMPMAST - for these,
    fetch_rows' tie-break (highest trid) is still an arbitrary pick among
    the otherwise-equally-valid rows. One-off diagnostic, not called from
    the regular nightly import."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT EMP_CODE
        FROM EMPMAST
        WHERE CONSIDER = '0'
        GROUP BY EMP_CODE
        HAVING COUNT(*) > 1
    """)
    return [row["EMP_CODE"] for row in cursor.fetchall()]


def build_rows(rows, imported_at):
    """Converts DAYFILE rows into attendance_days rows (see db.COLUMNS),
    classifying each one, and skips any row whose FirstIn can't be parsed."""
    out = []
    skipped = 0

    for row in rows:
        punch_date = row["PunchDate"]
        if isinstance(punch_date, datetime):
            punch_date = punch_date.date()

        try:
            hour, minute = hhmm_to_hour_minute(row["FirstIn"])
        except (ValueError, TypeError):
            skipped += 1
            continue

        first_in_min = hour * 60 + minute
        shift_code = row["ShiftCode"]
        assigned_bucket, derived_bucket, flag = shift_rules.classify_row(shift_code, first_in_min)
        # Python Monday=0..Sunday=6 -> JS-style Sunday=0..Saturday=6, which is
        # the convention the Friday/Monday combo detection relies on.
        weekday = (punch_date.weekday() + 1) % 7

        out.append({
            "emp_id": row["EmpID"],
            "emp_name": row["EmpName"] or "",
            "department": row["Department"] or "",
            "designation": row["Designation"] or "",
            "location_id": row["LocationID"] or "",
            "date": punch_date.strftime("%Y-%m-%d"),
            "weekday": weekday,
            "shift_code": shift_code,
            "assigned_bucket": assigned_bucket,
            "first_in_min": first_in_min,
            "derived_bucket": derived_bucket,
            "flag": flag,
            "rules_version": shift_rules.RULES_VERSION,
            "imported_at": imported_at,
        })

    return out, skipped


def import_date(conn, target_date, dayfile_conn=None):
    """Fetches and upserts one date's attendance. Shared by main() and
    server/backfill.py. Pass an existing `dayfile_conn` to reuse one
    connection across many dates (backfill); otherwise one is opened and
    closed just for this date."""
    own_conn = dayfile_conn is None
    if own_conn:
        dayfile_conn = get_connection()
    try:
        raw_rows = fetch_rows(dayfile_conn, target_date)
    finally:
        if own_conn:
            dayfile_conn.close()

    rows, skipped = build_rows(raw_rows, datetime.utcnow().isoformat())
    db.upsert_day(conn, target_date.strftime("%Y-%m-%d"), rows)
    return len(raw_rows), skipped


def main():
    if len(sys.argv) > 1:
        target_date = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
    else:
        target_date = date.today() - timedelta(days=1)

    print(f"Fetching DAYFILE for {target_date} ...")
    conn = db.get_connection()
    try:
        fetched, skipped = import_date(conn, target_date)
    finally:
        conn.close()

    print(f"Fetched {fetched} rows.")
    if skipped:
        print(f"Skipped {skipped} rows with unparseable FirstIn values.")
    print(f"Upserted {target_date} into {db.DB_PATH}.")


if __name__ == "__main__":
    main()
