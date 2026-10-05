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

Connection settings come from environment variables so credentials never
get committed:
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
      - EMPMAST: prefer CONSIDER='1' (the "active assignment" flag), tie-broken
        by highest trid - an arbitrary but deterministic choice for the
        employees who have more than one CONSIDER='1' row (see
        find_ambiguous_empmast_emp_codes), pending HR confirming the real rule.
      - tabDesignation: prefer the row whose location_id matches the chosen
        EMPMAST row's location (case/whitespace-insensitive), falling back to
        any row for that desgcode if no location match exists.
    """
    shift_list = ",".join(f"'{code}'" for code in KNOWN_SHIFT_CODES)
    query = f"""
        SELECT
            d.EMP_CODE   AS EmpID,
            d.PDATE      AS PunchDate,
            d.SHIFTCODE  AS ShiftCode,
            d.FirstIn    AS FirstIn,
            e.EMP_NAME   AS EmpName,
            e.DEPT_CODE  AS Department,
            e.location_ID AS LocationID,
            td.desgdesc  AS Designation
        FROM DAYFILE d
        OUTER APPLY (
            SELECT TOP 1 em.*
            FROM EMPMAST em
            WHERE em.EMP_CODE = d.EMP_CODE
            ORDER BY CASE WHEN em.CONSIDER = '1' THEN 0 ELSE 1 END, em.trid DESC
        ) e
        OUTER APPLY (
            SELECT TOP 1 td2.desgdesc
            FROM tabDesignation td2
            WHERE td2.desgcode = TRY_CAST(e.DESIGN AS INT)
            ORDER BY CASE
                WHEN UPPER(LTRIM(RTRIM(td2.location_id))) = UPPER(LTRIM(RTRIM(e.location_ID))) THEN 0
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
    """EMP_CODEs with more than one CONSIDER='1' row in EMPMAST - for these,
    fetch_rows' tie-break (highest trid) is an arbitrary guess, not a
    confirmed rule, pending HR/IT confirming what actually marks an
    employee's current department/location row. One-off diagnostic, not
    called from the regular nightly import."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT EMP_CODE
        FROM EMPMAST
        WHERE CONSIDER = '1'
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
