#!/usr/bin/env python3
"""
Syncs the laurus DB's Department table (DeptCode/DeptDesc/location_id) into
server/output/attendance.db as a small reference lookup, so the dashboard
can resolve a department code to a human-readable name. Kept separate from
attendance_days: the same DeptCode maps to a *different* description per
location (confirmed against real data - e.g. code 10000018 reads "BD
Generics FDF - DOM" at CO but "Business Development" at LNSN), so a code is
resolved at query time against (code, location), not baked into history.

This is small (~1,000 rows) and changes rarely, so a full replace each run
is simplest - no need for incremental diffing like the nightly attendance
import. Re-run this whenever department names/structure change org-side;
nothing else depends on running it on any particular schedule.

Usage:
    python3 import_departments.py
"""
import os

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")


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


def fetch_departments(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT DeptCode, location_id, DeptDesc FROM Department")
    return cursor.fetchall()


def main():
    dayfile_conn = ia.get_connection()
    try:
        raw_rows = fetch_departments(dayfile_conn)
    finally:
        dayfile_conn.close()

    # TRIM in Python, not SQL: source data has inconsistent leading/trailing
    # whitespace on DeptCode/location_id (e.g. " 10000455" alongside
    # "10000455" for what's otherwise the same code) that would otherwise
    # split into spurious duplicate lookup keys.
    seen = {}
    for row in raw_rows:
        code = (row["DeptCode"] or "").strip()
        location = (row["location_id"] or "").strip()
        desc = (row["DeptDesc"] or "").strip()
        if not code or not location:
            continue
        seen[(code, location)] = desc  # last one wins on any true duplicate

    rows = [(code, location, desc) for (code, location), desc in seen.items()]

    conn = db.get_connection()
    try:
        db.replace_department_names(conn, rows)
    finally:
        conn.close()

    print(f"Synced {len(rows)} department/location name mappings "
          f"({len(raw_rows)} source rows, {len(raw_rows) - len(rows)} skipped/collapsed).")


if __name__ == "__main__":
    main()
