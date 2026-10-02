#!/usr/bin/env python3
"""
Writes realistic fake attendance history straight into
server/output/attendance.db, for testing the live dashboard (server/app.py)
without a real DB connection - mirrors the offline mode's bundled sample
data, just for the live/SQLite path instead.

Usage:
    python3 seed_demo_data.py [days]   # default 60 days of history
"""
import random
import sys
from datetime import date, datetime, timedelta

import db
import shift_rules

EMPLOYEES = [
    ("E1001", "Aditi Sharma",  "Production", "BLR-01", "Line Supervisor", "GS", "06:50"),
    ("E1002", "Rohan Verma",   "Production", "BLR-01", "Operator",        "AS", "06:15"),
    ("E1003", "Kavya Iyer",    "Quality",    "BLR-01", "QA Engineer",     "GS", "09:00"),
    ("E1004", "Manoj Pillai",  "Logistics",  "PUN-02", "Warehouse Lead",  "BS", "13:00"),
    ("E1005", "Sneha Rao",     "Maintenance","PUN-02", "Technician",      "CS", "20:30"),
    ("E1006", "Farhan Sheikh", "Production", "PUN-02", "Operator",        "GS", "08:20"),
    ("E1007", "Priya Nair",    "Quality",    "DEL-03", "Inspector",       "AS", "06:40"),
    ("E1008", "Vikram Desai",  "Logistics",  "DEL-03", "Dispatcher",      "GS", "08:45"),
    ("E1009", "Ishaan Gupta",  "Production", "DEL-03", "Operator",        "GS", "07:55"),
    ("E1010", "Meera Pillai",  "Quality",    "BLR-01", "QA Lead",         "BS", "12:30"),
]

# Employees who get a deliberate Friday-early -> Monday-late pattern (so the
# combo table has something to show, not just the per-day outlier table).
WEEKEND_EXTENDERS = {"E1002", "E1007"}


def to_minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def jitter(base_minutes, rng):
    # Mostly on-time, occasionally early/late by enough to actually flag.
    roll = rng.random()
    if roll < 0.08:
        return base_minutes - rng.randint(20, 90)   # early
    if roll < 0.16:
        return base_minutes + rng.randint(20, 90)    # late
    return base_minutes + rng.randint(-10, 10)        # normal noise


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    end = date.today()
    start = end - timedelta(days=days - 1)

    rng = random.Random(42)
    conn = db.get_connection()
    imported_at = datetime.utcnow().isoformat()

    d = start
    while d <= end:
        weekday = (d.weekday() + 1) % 7  # JS-style Sun=0..Sat=6
        rows = []
        for emp_id, name, dept, loc, desig, shift_code, base in EMPLOYEES:
            base_min = to_minutes(base)
            bucket_lo, bucket_hi = shift_rules.BUCKET_RANGE[shift_rules.SHIFT_CODE_TO_BUCKET[shift_code]]
            if weekday == 5 and emp_id in WEEKEND_EXTENDERS:
                first_in_min = bucket_lo - 30  # clearly before the shift's own start -> Early
            elif weekday == 1 and emp_id in WEEKEND_EXTENDERS:
                first_in_min = bucket_hi + 30  # clearly after the shift's own end -> Late
            else:
                first_in_min = jitter(base_min, rng)
            first_in_min = max(0, min(23 * 60 + 59, first_in_min))

            assigned_bucket, derived_bucket, flag = shift_rules.classify_row(shift_code, first_in_min)
            rows.append({
                "emp_id": emp_id, "emp_name": name, "department": dept,
                "designation": desig, "location_id": loc, "date": d.strftime("%Y-%m-%d"),
                "weekday": weekday, "shift_code": shift_code,
                "assigned_bucket": assigned_bucket, "first_in_min": first_in_min,
                "derived_bucket": derived_bucket, "flag": flag,
                "rules_version": shift_rules.RULES_VERSION, "imported_at": imported_at,
            })
        db.upsert_day(conn, d.strftime("%Y-%m-%d"), rows)
        d += timedelta(days=1)

    conn.close()
    print(f"Seeded {len(EMPLOYEES)} employees x {days} days ({start} to {end}) into {db.DB_PATH}")


if __name__ == "__main__":
    main()
