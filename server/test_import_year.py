#!/usr/bin/env python3
"""
One-off test run: backfills a year of history into server/output/attendance.db
and prints a summary so you can sanity-check the import without opening the
dashboard. Thin wrapper around backfill.py + db.py - no new import logic here.

Loads server/.env itself (simple KEY=VALUE parser, stdlib only - doesn't
override anything already set in the real environment), since backfill.py /
import_attendance.py expect DB_SERVER/DB_USER/DB_PASSWORD etc. to already be
exported.

Usage:
    python3 test_import_year.py                        # trailing 365 days, through yesterday
    python3 test_import_year.py 2025-01-01 2025-12-31   # explicit range
"""
import os
import sys
from datetime import date, datetime, timedelta

HERE = os.path.dirname(__file__)
ENV_PATH = os.path.join(HERE, ".env")


def load_env_file(path):
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


def require_env():
    missing = [k for k in ("DB_SERVER", "DB_USER", "DB_PASSWORD") if not os.environ.get(k)]
    if missing:
        print(f"Missing required DB settings: {', '.join(missing)}")
        print(f"Fill them in at {ENV_PATH} (copy server/.env.example) and re-run.")
        sys.exit(1)


def parse_args():
    if len(sys.argv) == 1:
        end = date.today() - timedelta(days=1)
        start = end - timedelta(days=365)
        return start, end
    if len(sys.argv) == 3:
        start = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
        end = datetime.strptime(sys.argv[2], "%Y-%m-%d").date()
        if start > end:
            print(f"START_DATE {start} is after END_DATE {end}")
            sys.exit(1)
        return start, end
    print("Usage: python3 test_import_year.py [START_DATE END_DATE]  (YYYY-MM-DD, inclusive)")
    sys.exit(1)


def main():
    load_env_file(ENV_PATH)
    require_env()
    start, end = parse_args()

    import db
    import import_attendance as ia

    print(f"Backfilling {start} .. {end} into {db.DB_PATH}")
    conn = db.get_connection()
    dayfile_conn = ia.get_connection()
    try:
        ambiguous = ia.find_ambiguous_empmast_emp_codes(dayfile_conn)
        if ambiguous:
            log_path = os.path.join(HERE, "output", "ambiguous_empmast_emp_codes.txt")
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, "w", encoding="utf-8") as f:
                f.write("\n".join(ambiguous))
            print(f"{len(ambiguous)} employees have >1 CONSIDER='1' EMPMAST row - "
                  f"their department/location was picked by an unconfirmed tie-break "
                  f"(highest trid). List written to {log_path} for HR follow-up.\n")

        total_fetched = total_skipped = total_days = 0
        d = start
        while d <= end:
            fetched, skipped = ia.import_date(conn, d, dayfile_conn=dayfile_conn)
            total_fetched += fetched
            total_skipped += skipped
            total_days += 1
            if fetched or skipped:
                print(f"  {d}: fetched {fetched}, skipped {skipped}")
            d += timedelta(days=1)
    finally:
        dayfile_conn.close()

    print(f"\nBackfilled {total_days} day(s), {total_fetched} rows fetched, {total_skipped} skipped.")

    meta = db.query_meta(conn)
    stats = db.query_stats(conn, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    print("\n--- Test summary ---")
    print(f"Stored rows total: {meta['total_rows']} (range in DB: {meta['earliest_date']} .. {meta['last_import_date']})")
    print(f"Employees seen: {stats['employees']}, employee-days: {stats['employee_days']}")
    print(f"Early: {stats['early']}, Late: {stats['late']}")
    print(f"Friday-early -> Monday-late combos: {stats['combo_flags']} flags across {stats['combo_employees']} employees")
    conn.close()


if __name__ == "__main__":
    main()
