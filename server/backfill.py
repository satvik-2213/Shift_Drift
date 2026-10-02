#!/usr/bin/env python3
"""
One-off historical seed: imports every date in [start, end] (inclusive) into
server/output/attendance.db, reusing a single DAYFILE connection across the
whole range instead of reconnecting per day.

How much history you can actually backfill depends on how far back DAYFILE
retains data on the source system - check with whoever owns the laurus DB
before promising a full year; if retention is shorter, the dashboard just
starts with whatever's available and grows nightly from there via
import_attendance.py.

Usage:
    python3 backfill.py 2025-10-01 2026-09-30
"""
import sys
from datetime import datetime, timedelta

import db
import import_attendance as ia


def daterange(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 backfill.py START_DATE END_DATE  (YYYY-MM-DD, inclusive)")
        sys.exit(1)

    start = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
    end = datetime.strptime(sys.argv[2], "%Y-%m-%d").date()
    if start > end:
        print(f"START_DATE {start} is after END_DATE {end}")
        sys.exit(1)

    conn = db.get_connection()
    dayfile_conn = ia.get_connection()
    try:
        total_fetched = total_skipped = total_days = 0
        for target_date in daterange(start, end):
            fetched, skipped = ia.import_date(conn, target_date, dayfile_conn=dayfile_conn)
            total_fetched += fetched
            total_skipped += skipped
            total_days += 1
            print(f"{target_date}: fetched {fetched}, skipped {skipped}")
    finally:
        dayfile_conn.close()
        conn.close()

    print(f"Backfilled {total_days} day(s), {total_fetched} rows fetched, {total_skipped} skipped.")


if __name__ == "__main__":
    main()
