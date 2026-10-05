"""
SQLite storage for Shift Drift's live data path: one denormalized row per
employee-day, already classified at ingestion time (see shift_rules.py) so
every read here is a cheap indexed query, never a recompute over history.

Shared by import_attendance.py / backfill.py (writers) and app.py (reader).
"""
import os
import sqlite3
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "output", "attendance.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS attendance_days (
  emp_id          TEXT    NOT NULL,
  emp_name        TEXT,
  department      TEXT,
  designation     TEXT,
  location_id     TEXT,
  date            TEXT    NOT NULL,
  weekday         INTEGER NOT NULL,
  shift_code      TEXT    NOT NULL,
  assigned_bucket TEXT    NOT NULL,
  first_in_min    INTEGER NOT NULL,
  derived_bucket  TEXT    NOT NULL,
  flag            TEXT    NOT NULL,
  rules_version   TEXT    NOT NULL,
  imported_at     TEXT    NOT NULL,
  PRIMARY KEY (emp_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date           ON attendance_days(date);
CREATE INDEX IF NOT EXISTS idx_attendance_date_location   ON attendance_days(date, location_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date_department ON attendance_days(date, department);
CREATE INDEX IF NOT EXISTS idx_attendance_date_flag       ON attendance_days(date, flag);
"""

COLUMNS = [
    "emp_id", "emp_name", "department", "designation", "location_id",
    "date", "weekday", "shift_code", "assigned_bucket", "first_in_min",
    "derived_bucket", "flag", "rules_version", "imported_at",
]


def get_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


def upsert_day(conn, date_str, rows):
    """Replaces every row for date_str with the given rows, in one
    transaction. O(that day's rows), not O(accumulated history) - this is
    what makes nightly imports (and date-range backfills/retries) cheap and
    idempotent at 5,000+ employees/year of history."""
    placeholders = ",".join("?" * len(COLUMNS))
    with conn:
        conn.execute("DELETE FROM attendance_days WHERE date = ?", (date_str,))
        conn.executemany(
            f"INSERT INTO attendance_days ({','.join(COLUMNS)}) VALUES ({placeholders})",
            [tuple(row[c] for c in COLUMNS) for row in rows],
        )


def _apply_filters(where, params, location=None, department=None, flag=None, search=None, weekday=None):
    if location:
        where.append("location_id = ?")
        params.append(location)
    if department:
        where.append("department = ?")
        params.append(department)
    if flag:
        where.append("flag = ?")
        params.append(flag)
    else:
        where.append("flag IN ('Early', 'Late')")
    if weekday is not None:
        where.append("weekday = ?")
        params.append(weekday)
    if search:
        where.append("(emp_id LIKE ? OR emp_name LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like])


def query_outliers(conn, start, end, location=None, department=None, flag=None,
                    search=None, weekday=None, page=1, page_size=200):
    where = ["date BETWEEN ? AND ?"]
    params = [start, end]
    _apply_filters(where, params, location, department, flag, search, weekday)
    where_sql = " AND ".join(where)

    total = conn.execute(
        f"SELECT COUNT(*) FROM attendance_days WHERE {where_sql}", params
    ).fetchone()[0]

    offset = (page - 1) * page_size
    rows = conn.execute(
        f"""SELECT {','.join(COLUMNS)} FROM attendance_days
            WHERE {where_sql}
            ORDER BY date DESC, emp_id
            LIMIT ? OFFSET ?""",
        params + [page_size, offset],
    ).fetchall()
    return total, [dict(r) for r in rows]


def query_outliers_all(conn, start, end, location=None, department=None, flag=None, search=None, weekday=None):
    """Unpaginated variant for CSV export."""
    where = ["date BETWEEN ? AND ?"]
    params = [start, end]
    _apply_filters(where, params, location, department, flag, search, weekday)
    rows = conn.execute(
        f"""SELECT {','.join(COLUMNS)} FROM attendance_days
            WHERE {' AND '.join(where)}
            ORDER BY date DESC, emp_id""",
        params,
    ).fetchall()
    return [dict(r) for r in rows]


def query_combos(conn, start, end, location=None, department=None, search=None):
    """Friday-early -> Monday-late weekend-extension pattern, scoped to
    Fridays within [start, end] (the paired Monday is looked up individually
    by its own date, which may fall a day or two past `end`)."""
    where = ["date BETWEEN ? AND ?", "weekday = 5", "flag = 'Early'"]
    params = [start, end]
    if location:
        where.append("location_id = ?")
        params.append(location)
    if department:
        where.append("department = ?")
        params.append(department)
    if search:
        where.append("(emp_id LIKE ? OR emp_name LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like])

    fridays = conn.execute(
        f"""SELECT {','.join(COLUMNS)} FROM attendance_days
            WHERE {' AND '.join(where)}
            ORDER BY emp_id, date""",
        params,
    ).fetchall()

    combos = []
    count_by_emp = {}
    for fri in fridays:
        mon_date = (datetime.strptime(fri["date"], "%Y-%m-%d") + timedelta(days=3)).strftime("%Y-%m-%d")
        mon = conn.execute(
            f"SELECT {','.join(COLUMNS)} FROM attendance_days WHERE emp_id = ? AND date = ?",
            (fri["emp_id"], mon_date),
        ).fetchone()
        if mon and mon["weekday"] == 1 and mon["flag"] == "Late":
            combos.append({"friday": dict(fri), "monday": dict(mon)})
            count_by_emp[fri["emp_id"]] = count_by_emp.get(fri["emp_id"], 0) + 1

    for c in combos:
        c["weekend_count"] = count_by_emp[c["friday"]["emp_id"]]
    combos.sort(key=lambda c: (-c["weekend_count"], c["friday"]["emp_id"], c["friday"]["date"]))
    return combos


def query_stats(conn, start, end, location=None, department=None):
    where = ["date BETWEEN ? AND ?"]
    params = [start, end]
    if location:
        where.append("location_id = ?")
        params.append(location)
    if department:
        where.append("department = ?")
        params.append(department)
    where_sql = " AND ".join(where)

    totals = conn.execute(
        f"""SELECT COUNT(DISTINCT emp_id) AS employees, COUNT(*) AS employee_days,
                   SUM(flag = 'Early') AS early, SUM(flag = 'Late') AS late
            FROM attendance_days WHERE {where_sql}""",
        params,
    ).fetchone()

    by_weekday = conn.execute(
        f"""SELECT weekday, COUNT(*) AS total, SUM(flag = 'Early') AS early,
                   SUM(flag = 'On-time') AS ontime, SUM(flag = 'Late') AS late
            FROM attendance_days WHERE {where_sql} GROUP BY weekday ORDER BY weekday""",
        params,
    ).fetchall()

    by_department = conn.execute(
        f"""SELECT department, SUM(flag = 'Early') AS early, SUM(flag = 'Late') AS late
            FROM attendance_days WHERE {where_sql} GROUP BY department ORDER BY department""",
        params,
    ).fetchall()

    combos = query_combos(conn, start, end, location, department)
    combo_employees = len({c["friday"]["emp_id"] for c in combos})

    return {
        "employees": totals["employees"] or 0,
        "employee_days": totals["employee_days"] or 0,
        "early": totals["early"] or 0,
        "late": totals["late"] or 0,
        "combo_flags": len(combos),
        "combo_employees": combo_employees,
        "by_weekday": [dict(r) for r in by_weekday],
        "by_department": [dict(r) for r in by_department],
    }


def query_filters(conn):
    departments = [r[0] for r in conn.execute(
        "SELECT DISTINCT department FROM attendance_days WHERE department != '' ORDER BY department"
    ).fetchall()]
    locations = [r[0] for r in conn.execute(
        "SELECT DISTINCT location_id FROM attendance_days WHERE location_id != '' ORDER BY location_id"
    ).fetchall()]
    return {"departments": departments, "locations": locations}


def query_meta(conn):
    row = conn.execute(
        "SELECT MIN(date) AS earliest, MAX(date) AS latest, COUNT(*) AS total FROM attendance_days"
    ).fetchone()
    return {
        "last_import_date": row["latest"],
        "earliest_date": row["earliest"],
        "total_rows": row["total"] or 0,
    }
