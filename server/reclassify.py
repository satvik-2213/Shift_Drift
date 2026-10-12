#!/usr/bin/env python3
"""
Re-derives assigned_bucket/derived_bucket/flag/rules_version for every row
already stored in server/output/attendance.db, using the *current*
shift_rules.BUCKET_RANGE/SHIFT_CODE_TO_BUCKET. Rows are classified at
import time (see import_attendance.py), not at query time, so a shift-window
change doesn't retroactively apply to history until this is run once -
otherwise old rows stay classified under whatever rules were live when they
were imported (visible via their stored rules_version column).

Only touches the three derived columns plus rules_version - emp_id, date,
shift_code, first_in_min and the rest of the row are untouched, so this is
safe to re-run any time the rules change (idempotent).

Usage:
    python3 reclassify.py
"""
import db
import shift_rules


def main():
    conn = db.get_connection()
    try:
        rows = conn.execute("SELECT emp_id, date, shift_code, first_in_min FROM attendance_days").fetchall()
        updates = []
        for r in rows:
            assigned_bucket, derived_bucket, flag = shift_rules.classify_row(r["shift_code"], r["first_in_min"])
            updates.append((assigned_bucket, derived_bucket, flag, shift_rules.RULES_VERSION, r["emp_id"], r["date"]))
        with conn:
            conn.executemany(
                """UPDATE attendance_days
                   SET assigned_bucket = ?, derived_bucket = ?, flag = ?, rules_version = ?
                   WHERE emp_id = ? AND date = ?""",
                updates,
            )
        print(f"Reclassified {len(updates)} rows under rules_version {shift_rules.RULES_VERSION}.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
