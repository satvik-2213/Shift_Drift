"""
SQLite storage for Shift Drift's live data path: one denormalized row per
employee-day, already classified at ingestion time (see shift_rules.py) so
every read here is a cheap indexed query, never a recompute over history.

Shared by import_attendance.py / backfill.py (writers) and app.py (reader).
"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
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

-- query_filters (the Location/Department dropdown catalogs, rebuilt on every
-- login and every time either dropdown narrows the other) deliberately scans
-- the *whole* history, not a date range - these two give it a covering index
-- for both the GROUP BY department / narrow-by-location shape and the
-- DISTINCT location_id / narrow-by-department shape, instead of a full
-- table scan over every attendance row ever imported.
CREATE INDEX IF NOT EXISTS idx_attendance_department_location ON attendance_days(department, location_id);
CREATE INDEX IF NOT EXISTS idx_attendance_location_department ON attendance_days(location_id, department);

-- Reference/lookup table synced from the source DB's Department table (see
-- import_departments.py) - deliberately separate from attendance_days: it's
-- small, changes rarely, and a department code can map to a different
-- description string per location, so it's resolved at query time (prefer
-- an exact location match, else any row for that code) rather than baked
-- into the big denormalized attendance table.
CREATE TABLE IF NOT EXISTS department_names (
  dept_code   TEXT NOT NULL,
  location_id TEXT NOT NULL,
  dept_desc   TEXT NOT NULL,
  PRIMARY KEY (dept_code, location_id)
);
CREATE INDEX IF NOT EXISTS idx_department_names_code ON department_names(dept_code);

-- Company-wide employee roster (join date, exit date, current department/
-- designation) for HR headcount/attrition reporting - see
-- import_employee_roster.py. Separate concern from attendance_days (that
-- table is about clock-in timing, this one is about who's employed when);
-- kept apart deliberately so neither query path touches the other's rows.
CREATE TABLE IF NOT EXISTS employee_roster (
  emp_id       TEXT NOT NULL PRIMARY KEY,
  emp_name     TEXT,
  department   TEXT,
  designation  TEXT,
  location_id  TEXT,
  date_joined  TEXT,  -- YYYY-MM-DD, NULL if unknown
  date_exited  TEXT,  -- YYYY-MM-DD, NULL if still active (or unknown - see
                       -- import_employee_roster.py's leftemployees caveat)
  block        TEXT   -- EMPMAST.GROUPCODE 860/861 -> "DS15"/"DS1", NULL for
                       -- any other group code. Attrition-tab-only filter -
                       -- deliberately not on attendance_days, so it never
                       -- shows up on the Shift Drift side.
);
CREATE INDEX IF NOT EXISTS idx_employee_roster_name ON employee_roster(emp_name);

-- Dashboard login accounts beyond the single master admin (APP_USERNAME/
-- PASSWORD in server/.env) - see seed_app_users.py. "admin" rows are
-- unrestricted (locations NULL, same privilege as the master account);
-- every other row is location-restricted to the location_id(s) in
-- `locations` (JSON array - almost always one, but a manager covering
-- several units gets several) via app.py's _effective_location. Passwords
-- are never stored in the clear - password_hash is PBKDF2-HMAC-SHA256 over
-- password_salt (see _hash_password/verify_app_user).
-- must_change_password: forces a one-time password-change prompt (see
-- app.py's /api/change-password) after a password is set via
-- upsert_app_user - cleared (0) once the account holder picks their own.
-- Lives in this table (server/output/attendance.db, gitignored) rather than
-- anywhere code-adjacent so it survives a `git pull` + server restart: a
-- fresh checkout never touches this file, so the flag only ever flips back
-- to 1 when an actual password is (re)set, never as a side effect of
-- deploying new code.
CREATE TABLE IF NOT EXISTS app_users (
  emp_id               TEXT NOT NULL PRIMARY KEY,
  name                 TEXT,
  role                 TEXT NOT NULL, -- "admin" or "restricted"
  locations            TEXT,          -- JSON array of location_id, NULL for admin
  password_salt        TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0
);
"""

def department_name_expr(alias="department_name"):
    """Correlated subquery, not a JOIN: a department code can have a different
    description per location (see import_departments.py), so this prefers
    the row whose location_id matches this attendance row's own location,
    falling back to any row for that code if there's no exact match. Needs
    the outer table aliased "a". The UNION ALL + literal priority column
    (rather than ORDER BY (dn.location_id = a.location_id)) is deliberate -
    SQLite allows correlating an outer alias in a subquery's WHERE but not
    in its ORDER BY ("no such column: a.location_id"), so the preference is
    expressed as "try the exact-match branch first, else the fallback
    branch" instead."""
    return f"""(
        SELECT dept_desc FROM (
            SELECT dept_desc, 0 AS pri FROM department_names
            WHERE dept_code = a.department AND location_id = a.location_id
            UNION ALL
            SELECT dept_desc, 1 AS pri FROM department_names
            WHERE dept_code = a.department
        )
        ORDER BY pri LIMIT 1
    ) AS {alias}"""


DEPARTMENT_NAME_EXPR = department_name_expr()

COLUMNS = [
    "emp_id", "emp_name", "department", "designation", "location_id",
    "date", "weekday", "shift_code", "assigned_bucket", "first_in_min",
    "derived_bucket", "flag", "rules_version", "imported_at",
]

# query_outliers/query_outliers_all additionally select department_name (via
# DEPARTMENT_NAME_EXPR) - not a stored column (so NOT in COLUMNS, which also
# drives upsert_day's INSERT), just for CSV fieldnames to match what those
# queries actually return.
OUTLIER_CSV_COLUMNS = COLUMNS + ["department_name"]


def get_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


def _migrate(conn):
    """One-off patches for columns added after a database already exists -
    CREATE TABLE IF NOT EXISTS only creates missing tables, it doesn't add
    columns to a table that's already there, so a new column needs an
    explicit, idempotent ALTER TABLE gated on whether it's already been
    applied."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(employee_roster)")}
    if "block" not in cols:
        conn.execute("ALTER TABLE employee_roster ADD COLUMN block TEXT")

    user_cols = {row[1] for row in conn.execute("PRAGMA table_info(app_users)")}
    if "must_change_password" not in user_cols:
        conn.execute("ALTER TABLE app_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")


_PBKDF2_ITERATIONS = 200_000


def _hash_password(password, salt_hex=None):
    """PBKDF2-HMAC-SHA256, stdlib-only (no extra dependency for something
    this project otherwise has zero use for) - salt_hex is generated fresh
    (secrets.token_hex) when creating/resetting a password, and passed back
    in (the stored salt) when verifying a login attempt."""
    salt_hex = salt_hex or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), _PBKDF2_ITERATIONS).hex()
    return salt_hex, digest


def upsert_app_user(conn, emp_id, name, role, locations, password):
    """Creates a dashboard login account, or syncs an existing one's
    profile (name/role/locations) from seed_app_users.py. `role` is "admin"
    (unrestricted) or "restricted"; `locations` is a list of location_id
    values for a restricted account (ignored/stored NULL for admin).

    `password` is only ever applied on genuine creation (the INSERT path) -
    an existing row's password_salt/password_hash/must_change_password are
    deliberately left untouched on conflict. seed_app_users.py reapplies
    its *entire* users_seed.json on every run (not just new entries), so if
    this also reset the password on every run, anyone who'd used
    /api/change-password to move off their DOB default would silently have
    it wiped back the next time an admin re-ran the script to onboard one
    new hire - see reset_app_user_password for the explicit, deliberate way
    to force a specific account's password back to a new value."""
    salt_hex, digest = _hash_password(password)
    locations_json = json.dumps(list(locations)) if role != "admin" and locations else None
    with conn:
        conn.execute(
            """INSERT INTO app_users (emp_id, name, role, locations, password_salt, password_hash, must_change_password)
               VALUES (?, ?, ?, ?, ?, ?, 1)
               ON CONFLICT(emp_id) DO UPDATE SET
                 name=excluded.name, role=excluded.role, locations=excluded.locations""",
            (emp_id, name, role, locations_json, salt_hex, digest),
        )


def _set_password(conn, emp_id, new_password, must_change_password):
    salt_hex, digest = _hash_password(new_password)
    with conn:
        cur = conn.execute(
            "UPDATE app_users SET password_salt = ?, password_hash = ?, must_change_password = ? WHERE emp_id = ?",
            (salt_hex, digest, int(bool(must_change_password)), emp_id),
        )
    return cur.rowcount > 0


def set_user_password(conn, emp_id, new_password):
    """Self-service password change (see app.py's /api/change-password) -
    clears must_change_password since the account holder has now picked
    their own. Returns False if emp_id isn't a real app_users row (e.g. the
    master admin account, which lives in server/.env and has no row here)."""
    return _set_password(conn, emp_id, new_password, must_change_password=False)


def reset_app_user_password(conn, emp_id, new_password):
    """Explicit admin-triggered reset of an EXISTING account's password
    (see seed_app_users.py --reset), as opposed to upsert_app_user which
    never touches an existing row's password. Re-flags must_change_password
    so the account holder is forced to pick a new one of their own on next
    login, same as a brand-new account. Returns False if emp_id has no
    app_users row at all - this resets, it doesn't create."""
    return _set_password(conn, emp_id, new_password, must_change_password=True)


def verify_app_user(conn, emp_id, password):
    """Checks emp_id/password against app_users. Returns
    {"emp_id", "name", "role", "locations", "must_change_password"} on a
    match (locations is a list, or None for an admin account) - None if
    there's no such account or the password doesn't match. Always hashes
    even on a missing account (dummy salt) so a wrong-username and a
    wrong-password attempt take the same time, not a tell for username
    enumeration."""
    row = conn.execute("SELECT * FROM app_users WHERE emp_id = ?", (emp_id,)).fetchone()
    salt_hex = row["password_salt"] if row else secrets.token_hex(16)
    _, digest = _hash_password(password, salt_hex)
    if row is None or not hmac.compare_digest(digest, row["password_hash"]):
        return None
    locations = json.loads(row["locations"]) if row["locations"] else None
    return {
        "emp_id": row["emp_id"], "name": row["name"], "role": row["role"], "locations": locations,
        "must_change_password": bool(row["must_change_password"]),
    }


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


def replace_department_names(conn, rows):
    """Full replace, not a diff/merge - this is a small (~1,000-row) reference
    table synced wholesale each run (see import_departments.py), not
    date-partitioned like attendance_days."""
    with conn:
        conn.execute("DELETE FROM department_names")
        conn.executemany(
            "INSERT INTO department_names (dept_code, location_id, dept_desc) VALUES (?, ?, ?)",
            rows,
        )


def _search_clause(search, id_column="emp_id", name_column="emp_name"):
    """A numeric search is an employee ID - exact match (`= ?`, not LIKE), so
    it can actually use an index (emp_id leads attendance_days' primary key)
    instead of forcing a full-table scan like a leading-wildcard LIKE
    always does. Anything else is treated as a name fragment - still a
    LIKE, since partial-name matching is the whole point there, but only
    against one column now, not two."""
    search = search.strip()
    if search.isdigit():
        return f"{id_column} = ?", [search]
    return f"{name_column} LIKE ?", [f"%{search}%"]


def _location_clause(location, column="location_id"):
    """SQL fragment + params for a location filter that accepts either a
    single location string (one branch - the common case) or a list/tuple
    of them (a multi-location-restricted session - e.g. one manager who
    covers several units, see app.py's _effective_location) - every query
    that scopes by location goes through this instead of each hand-rolling
    its own `= ?` vs `IN (...)` branch."""
    if not location:
        return "", []
    if isinstance(location, (list, tuple, set)):
        locs = list(location)
        return f"{column} IN ({','.join('?' * len(locs))})", locs
    return f"{column} = ?", [location]


def _apply_filters(where, params, location=None, department=None, flag=None, search=None, weekday=None):
    if location:
        clause, loc_params = _location_clause(location)
        where.append(clause)
        params.extend(loc_params)
    if department:
        where.append("department = ?")
        params.append(department)
    if flag == "all":
        where.append("flag IN ('Early', 'On-time', 'Late')")
    elif flag:
        where.append("flag = ?")
        params.append(flag)
    else:
        where.append("flag IN ('Early', 'Late')")
    if weekday is not None:
        where.append("weekday = ?")
        params.append(weekday)
    if search:
        clause, search_params = _search_clause(search)
        where.append(clause)
        params.extend(search_params)


# Column the outliers table can be sorted by -> the actual SQL column/alias
# to order on. Whitelisted (never build an ORDER BY identifier from raw user
# input) and keyed on the same names the client's column filters already use.
# "department" orders by the resolved department_name alias (what's actually
# shown), not the raw code, so it reads alphabetically the way the column looks.
OUTLIER_SORT_COLUMNS = {
    "date": "date",
    "employee": "emp_name",
    "department": "department_name",
    "location": "location_id",
    "assigned": "shift_code",
    "camein": "derived_bucket",
    "clockin": "first_in_min",
    "flag": "flag",
}


def query_outliers(conn, start, end, location=None, department=None, flag=None,
                    search=None, weekday=None, page=1, page_size=200,
                    sort="date", sort_dir="desc"):
    where = ["date BETWEEN ? AND ?"]
    params = [start, end]
    _apply_filters(where, params, location, department, flag, search, weekday)
    where_sql = " AND ".join(where)

    total = conn.execute(
        f"SELECT COUNT(*) FROM attendance_days WHERE {where_sql}", params
    ).fetchone()[0]

    sort_col = OUTLIER_SORT_COLUMNS.get(sort, "date")
    direction = "ASC" if sort_dir == "asc" else "DESC"
    # emp_id as a tie-break keeps paging stable when the sort column has
    # duplicate values (e.g. many rows with the same flag or date).
    order_sql = f"{sort_col} {direction}, emp_id" if sort_col != "emp_id" else f"emp_id {direction}"

    offset = (page - 1) * page_size
    rows = conn.execute(
        f"""SELECT {','.join(COLUMNS)}, {DEPARTMENT_NAME_EXPR} FROM attendance_days a
            WHERE {where_sql}
            ORDER BY {order_sql}
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
        f"""SELECT {','.join(COLUMNS)}, {DEPARTMENT_NAME_EXPR} FROM attendance_days a
            WHERE {' AND '.join(where)}
            ORDER BY date DESC, emp_id""",
        params,
    ).fetchall()
    return [dict(r) for r in rows]


def query_combos(conn, start, end, location=None, department=None, search=None, early_weekday=5, late_weekday=1, mode="both"):
    """<day1>-early -> <day2>-late flagged pattern, scoped to day1
    occurrences within [start, end] (the paired day2 is looked up
    individually by its own date, which may fall a few days past `end`).
    `early_weekday`/`late_weekday` are 0=Sunday..6=Saturday; day2 is always
    the NEXT occurrence of that weekday after day1 (offset wraps forward
    mod 7), e.g. Fri(5)->Mon(1) is +3 days, Mon(1)->Fri(5) is +4 days.
    Defaults to the original Friday-early -> Monday-late pattern.

    mode="both" (default): unchanged strict-pair behavior - a row only
    exists when both sides fired, {"day1": {...}, "day2": {...}}.

    mode="either": also includes employees who only fired one side (early
    on day1 but not late on day2, or vice versa) - every row additionally
    carries a "match" field ("both" / "day1_only" / "day2_only"), and the
    side that didn't fire is None instead of a fabricated row."""
    offset = (late_weekday - early_weekday) % 7
    where = ["date BETWEEN ? AND ?", "weekday = ?", "flag = 'Early'"]
    params = [start, end, early_weekday]
    if location:
        clause, loc_params = _location_clause(location)
        where.append(clause)
        params.extend(loc_params)
    if department:
        where.append("department = ?")
        params.append(department)
    if search:
        clause, search_params = _search_clause(search)
        where.append(clause)
        params.extend(search_params)

    day1_rows = conn.execute(
        f"""SELECT {','.join(COLUMNS)}, {DEPARTMENT_NAME_EXPR} FROM attendance_days a
            WHERE {' AND '.join(where)}
            ORDER BY emp_id, date""",
        params,
    ).fetchall()

    if mode != "either":
        combos = []
        count_by_emp = {}
        for day1 in day1_rows:
            day2_date = (datetime.strptime(day1["date"], "%Y-%m-%d") + timedelta(days=offset)).strftime("%Y-%m-%d")
            day2 = conn.execute(
                f"SELECT {','.join(COLUMNS)}, {DEPARTMENT_NAME_EXPR} FROM attendance_days a WHERE emp_id = ? AND date = ?",
                (day1["emp_id"], day2_date),
            ).fetchone()
            if day2 and day2["weekday"] == late_weekday and day2["flag"] == "Late":
                combos.append({"day1": dict(day1), "day2": dict(day2)})
                count_by_emp[day1["emp_id"]] = count_by_emp.get(day1["emp_id"], 0) + 1

        for c in combos:
            c["pair_count"] = count_by_emp[c["day1"]["emp_id"]]
        combos.sort(key=lambda c: (-c["pair_count"], c["day1"]["emp_id"], c["day1"]["date"]))
        return combos

    # mode == "either": a second indexed range query for day2 candidates
    # (own window, shifted by the same offset) instead of a point lookup per
    # day1 row - two scans plus an in-Python merge, not 1+N round trips.
    day2_start = (datetime.strptime(start, "%Y-%m-%d") + timedelta(days=offset)).strftime("%Y-%m-%d")
    day2_end = (datetime.strptime(end, "%Y-%m-%d") + timedelta(days=offset)).strftime("%Y-%m-%d")
    where2 = ["date BETWEEN ? AND ?", "weekday = ?", "flag = 'Late'"]
    params2 = [day2_start, day2_end, late_weekday]
    if location:
        clause, loc_params = _location_clause(location)
        where2.append(clause)
        params2.extend(loc_params)
    if department:
        where2.append("department = ?")
        params2.append(department)
    if search:
        clause, search_params = _search_clause(search)
        where2.append(clause)
        params2.extend(search_params)

    day2_rows = conn.execute(
        f"""SELECT {','.join(COLUMNS)}, {DEPARTMENT_NAME_EXPR} FROM attendance_days a
            WHERE {' AND '.join(where2)}
            ORDER BY emp_id, date""",
        params2,
    ).fetchall()

    # Keyed by (emp_id, day1's date) either way - day2 rows get their key
    # computed backwards (its own date minus the offset) so a day1 row and
    # its paired day2 row land on the same key regardless of which side(s)
    # actually fired.
    day1_by_key = {(r["emp_id"], r["date"]): dict(r) for r in day1_rows}
    day2_by_key = {}
    for r in day2_rows:
        implied_day1_date = (datetime.strptime(r["date"], "%Y-%m-%d") - timedelta(days=offset)).strftime("%Y-%m-%d")
        day2_by_key[(r["emp_id"], implied_day1_date)] = dict(r)

    combos = []
    count_by_emp = {}
    for key in sorted(set(day1_by_key) | set(day2_by_key)):
        emp_id, day1_date = key
        d1 = day1_by_key.get(key)
        d2 = day2_by_key.get(key)
        match = "both" if d1 and d2 else ("day1_only" if d1 else "day2_only")
        combos.append({"day1": d1, "day2": d2, "match": match})
        count_by_emp[emp_id] = count_by_emp.get(emp_id, 0) + 1

    for c in combos:
        emp_id = (c["day1"] or c["day2"])["emp_id"]
        c["pair_count"] = count_by_emp[emp_id]
    combos.sort(key=lambda c: (-c["pair_count"], (c["day1"] or c["day2"])["emp_id"], (c["day1"] or c["day2"])["date"]))
    return combos


def query_stats(conn, start, end, location=None, department=None, early_weekday=5, late_weekday=1):
    where = ["date BETWEEN ? AND ?"]
    params = [start, end]
    if location:
        clause, loc_params = _location_clause(location)
        where.append(clause)
        params.extend(loc_params)
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
        f"""SELECT department, {department_name_expr("department_name")},
                   SUM(flag = 'Early') AS early, SUM(flag = 'Late') AS late
            FROM attendance_days a WHERE {where_sql} GROUP BY department ORDER BY department""",
        params,
    ).fetchall()

    combos = query_combos(conn, start, end, location, department, early_weekday=early_weekday, late_weekday=late_weekday)
    combo_employees = len({c["day1"]["emp_id"] for c in combos})

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


_FILTERS_CACHE = None  # {"pairs": [(department, location_id, name)], "loaded_at": epoch}
_FILTERS_CACHE_TTL_SECONDS = 300


def _filters_catalog(conn):
    """The full (department, location, display name) catalog behind
    query_filters, cached in-process for _FILTERS_CACHE_TTL_SECONDS.

    Computing it is an unavoidable full scan of attendance_days (3M+ rows
    and growing) even with its covering indexes (idx_attendance_department_
    location / idx_attendance_location_department) - measured at ~0.5-1s
    per call on real data. query_filters used to pay that cost on every
    single /api/filters request: once on every login, and again on every
    keystroke-driven narrowing of the Location/Department dropdowns
    (FiltersBar's own effect re-calls it whenever either draft value
    changes) - which is what made a non-admin's post-login load (and the
    employee-lookup flow sitting right next to those dropdowns) feel slow.
    The catalog only changes when new data is imported (nightly), so
    caching it and narrowing location/department combinations in Python
    from the cached list - cheap, since there are only ever a few hundred
    distinct (department, location) pairs - replaces that repeated full
    scan with one scan per cache window."""
    global _FILTERS_CACHE
    now = time.time()
    if _FILTERS_CACHE is not None and now - _FILTERS_CACHE["loaded_at"] < _FILTERS_CACHE_TTL_SECONDS:
        return _FILTERS_CACHE["pairs"]

    # Distinct (department, location) combos first - a plain DISTINCT over
    # just the two indexed columns, so it's satisfied entirely from
    # idx_attendance_department_location/idx_attendance_location_department
    # (covering indexes) without touching department_name_expr's correlated
    # subquery per underlying row. Resolving each pair's display name
    # happens next, against department_names directly (small, changes
    # rarely) - a couple hundred dict lookups, not a couple hundred SQL
    # round trips or a few million subquery evaluations.
    combos = conn.execute("""
        SELECT DISTINCT department, location_id
        FROM attendance_days
        WHERE department != '' AND location_id != ''
    """).fetchall()

    exact_names = {}
    fallback_names = {}
    for r in conn.execute("SELECT dept_code, location_id, dept_desc FROM department_names"):
        exact_names[(r["dept_code"], r["location_id"])] = r["dept_desc"]
        fallback_names.setdefault(r["dept_code"], r["dept_desc"])

    pairs = [
        (c["department"], c["location_id"], exact_names.get((c["department"], c["location_id"])) or fallback_names.get(c["department"]))
        for c in combos
    ]
    _FILTERS_CACHE = {"pairs": pairs, "loaded_at": now}
    return pairs


def query_filters(conn, location=None, department=None):
    """Each list is scoped by the *other* filter, not itself - picking a
    location narrows the department list to what's actually used there, and
    picking a department narrows the location list to branches that have
    it, so either can be picked first and then narrowed further by the
    other. Confirmed against real data that both directions are genuinely
    restrictive (not theoretical): some locations use only 1-2 of the 189
    total departments, and plenty of departments exist at only one or two
    branches."""
    pairs = _filters_catalog(conn)
    allowed_locs = {location} if isinstance(location, str) else (set(location) if location else None)

    dept_names = {}
    for dept, loc, name in pairs:
        if allowed_locs is not None and loc not in allowed_locs:
            continue
        dept_names.setdefault(dept, name)
    departments = [{"code": code, "name": dept_names[code]} for code in sorted(dept_names)]

    locations = sorted({
        loc for dept, loc, _ in pairs
        if (not department or dept == department) and (allowed_locs is None or loc in allowed_locs)
    })
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


def replace_employee_roster(conn, rows):
    """Full replace, not a diff/merge - same reasoning as
    replace_department_names: a small (~17,000-row) reference table synced
    wholesale each run (see import_employee_roster.py), not date-partitioned
    like attendance_days."""
    with conn:
        conn.execute("DELETE FROM employee_roster")
        conn.executemany(
            """INSERT INTO employee_roster
               (emp_id, emp_name, department, designation, location_id, date_joined, date_exited, block)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )


def _headcount_window(conn, start, end, location=None, department=None, block=None):
    """Headcount at the start and end of [start, end], plus exits
    ("separations") and joins ("joinings") within it.

    Confirmed directly with HR: someone who exits on day D is counted in
    THAT day's opening headcount (and in that period's exits) - DTRETIR is
    their last working day, still present for it - but NOT in a period's
    closing headcount, since by the close of the range they're already gone.
    So "active at the start of D" is joined on or before D AND (no exit, or
    exited on or after D); "active at the close of D" is the same but
    exited AFTER D, not on it - two different operators for what looks like
    the same question, because "opening of day D" and "closing of day D"
    aren't actually the same instant. (They're consistent with each other
    across a boundary: closing of day D using ">" and opening of day D+1
    using ">=" agree for every exit date, which is exactly why HR's own
    monthly figures chain perfectly - this period's close IS next period's
    open, computed either way.)

    location/department scope this to a specific branch, a specific
    department across all branches, or both at once - employee_roster's
    department/location_id is each employee's *current* one (from the same
    EMPMAST snapshot date_joined/designation come from), not a historical
    assignment as of `start`/`end`, so a mid-range transfer attributes to
    wherever they are as of the last roster sync, not where they were on
    any given day in the range.

    `block` scopes to EMPMAST.GROUPCODE 860/861 ("DS15"/"DS1") - an
    Attrition-tab-only distinction, not available on the Shift Drift side
    (attendance_days has no such column)."""
    extra_where = ""
    extra_params = []
    if location:
        clause, loc_params = _location_clause(location)
        extra_where += f" AND {clause}"
        extra_params.extend(loc_params)
    if department:
        extra_where += " AND department = ?"
        extra_params.append(department)
    if block:
        extra_where += " AND block = ?"
        extra_params.append(block)

    def active_on(date_str, exit_op):
        return conn.execute(
            f"""SELECT COUNT(*) FROM employee_roster
               WHERE date_joined IS NOT NULL AND date_joined <= ?
                 AND (date_exited IS NULL OR date_exited {exit_op} ?){extra_where}""",
            (date_str, date_str, *extra_params),
        ).fetchone()[0]

    headcount_start = active_on(start, ">=")
    headcount_end = active_on(end, ">")
    exits = conn.execute(
        f"SELECT COUNT(*) FROM employee_roster WHERE date_exited BETWEEN ? AND ?{extra_where}",
        (start, end, *extra_params),
    ).fetchone()[0]
    joins = conn.execute(
        f"SELECT COUNT(*) FROM employee_roster WHERE date_joined BETWEEN ? AND ?{extra_where}",
        (start, end, *extra_params),
    ).fetchone()[0]

    return {
        "headcount_start": headcount_start,
        "headcount_end": headcount_end,
        "exits": exits,
        "joins": joins,
    }


def _attrition_rate(headcount_start, headcount_end, exits):
    """exits ("separations") / average(opening, closing) * 100 - the
    standard HR formula, confirmed against HR's own numbers. (Previously
    averaged opening headcount with joins instead of closing headcount - a
    plausible-sounding but non-standard substitute that gave 2.29% where HR
    expected ~1.15% for the same range; averaging opening/closing gives
    1.17%, matching.)"""
    average_base = (headcount_start + headcount_end) / 2
    return round((exits / average_base * 100) if average_base else 0.0, 2)


def query_headcount(conn, start, end, location=None, department=None, block=None):
    """Headcount at the start/end of [start, end], and the attrition rate
    for that range. See _headcount_window and _attrition_rate."""
    window = _headcount_window(conn, start, end, location, department, block)
    window["attrition_rate"] = _attrition_rate(
        window["headcount_start"], window["headcount_end"], window["exits"]
    )
    return window


def _month_periods(start_date, end_date):
    cur = start_date.replace(day=1)
    while cur <= end_date:
        if cur.month == 12:
            next_month = cur.replace(year=cur.year + 1, month=1)
        else:
            next_month = cur.replace(month=cur.month + 1)
        period_end = next_month - timedelta(days=1)
        yield cur.strftime("%Y-%m"), max(cur, start_date), min(period_end, end_date)
        cur = next_month


def _quarter_periods(start_date, end_date):
    first_month = ((start_date.month - 1) // 3) * 3 + 1
    cur = start_date.replace(month=first_month, day=1)
    while cur <= end_date:
        quarter = (cur.month - 1) // 3 + 1
        if quarter == 4:
            next_q = cur.replace(year=cur.year + 1, month=1, day=1)
        else:
            next_q = cur.replace(month=cur.month + 3, day=1)
        period_end = next_q - timedelta(days=1)
        yield f"{cur.year}-Q{quarter}", max(cur, start_date), min(period_end, end_date)
        cur = next_q


def _year_periods(start_date, end_date):
    cur = start_date.replace(month=1, day=1)
    while cur <= end_date:
        next_year = cur.replace(year=cur.year + 1)
        period_end = next_year - timedelta(days=1)
        yield str(cur.year), max(cur, start_date), min(period_end, end_date)
        cur = next_year


PERIOD_GENERATORS = {
    "month": _month_periods,
    "quarter": _quarter_periods,
    "year": _year_periods,
}


def query_attrition_trends(conn, start, end, granularity, location=None, department=None, block=None):
    """Monthly/quarterly/yearly attrition-rate snapshots covering [start,
    end], one row per period with that period's own headcount/exits/joins
    and attrition rate (same formula as query_headcount, just scoped to
    the period instead of the whole range)."""
    generator = PERIOD_GENERATORS.get(granularity)
    if generator is None:
        raise ValueError(f"granularity must be one of {sorted(PERIOD_GENERATORS)}")

    start_date = datetime.strptime(start, "%Y-%m-%d").date()
    end_date = datetime.strptime(end, "%Y-%m-%d").date()

    periods = []
    for label, period_start, period_end in generator(start_date, end_date):
        window = _headcount_window(
            conn, period_start.isoformat(), period_end.isoformat(), location, department, block
        )
        periods.append({
            "period": label,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            **window,
            "attrition_rate": _attrition_rate(window["headcount_start"], window["headcount_end"], window["exits"]),
        })
    return periods


# Column the exits/joins drill-down tables can be sorted by -> the actual
# SQL column. Whitelisted the same way OUTLIER_SORT_COLUMNS is - never build
# an ORDER BY identifier out of raw user input.
ROSTER_SORT_COLUMNS = {
    "employee": "emp_name",
    "designation": "designation",
    "location": "location_id",
    "date_joined": "date_joined",
    "date_exited": "date_exited",
}


def _roster_rows_in_range(conn, date_column, start, end, location=None, department=None,
                           search=None, page=1, page_size=200, sort=None, sort_dir="desc", block=None):
    where = f"{date_column} BETWEEN ? AND ?"
    params = [start, end]
    if location:
        clause, loc_params = _location_clause(location)
        where += f" AND {clause}"
        params.extend(loc_params)
    if department:
        where += " AND department = ?"
        params.append(department)
    if block:
        where += " AND block = ?"
        params.append(block)
    if search:
        clause, search_params = _search_clause(search)
        where += f" AND {clause}"
        params.extend(search_params)

    total = conn.execute(f"SELECT COUNT(*) FROM employee_roster WHERE {where}", params).fetchone()[0]

    sort_col = ROSTER_SORT_COLUMNS.get(sort, date_column)
    direction = "ASC" if sort_dir == "asc" else "DESC"
    order_sql = f"{sort_col} {direction}, emp_id" if sort_col != "emp_id" else f"emp_id {direction}"

    offset = (page - 1) * page_size
    rows = conn.execute(
        f"""SELECT emp_id, emp_name, department, designation, location_id, date_joined, date_exited
            FROM employee_roster WHERE {where} ORDER BY {order_sql}
            LIMIT ? OFFSET ?""",
        params + [page_size, offset],
    ).fetchall()
    return total, [dict(r) for r in rows]


def query_exited_employees(conn, start, end, location=None, department=None,
                            search=None, page=1, page_size=200, sort=None, sort_dir="desc", block=None):
    """Employees whose date_exited falls within [start, end] - the drill-down
    behind the "Exits" stat tile."""
    return _roster_rows_in_range(conn, "date_exited", start, end, location, department,
                                  search, page, page_size, sort or "date_exited", sort_dir, block)


def query_joined_employees(conn, start, end, location=None, department=None,
                            search=None, page=1, page_size=200, sort=None, sort_dir="desc", block=None):
    """Employees whose date_joined falls within [start, end] - the drill-down
    behind the "Joins" stat tile."""
    return _roster_rows_in_range(conn, "date_joined", start, end, location, department,
                                  search, page, page_size, sort or "date_joined", sort_dir, block)


def query_employee_search(conn, search, location=None, limit=20):
    """Employee lookup by ID or name - for HR pulling DOJ/DOR on demand, not
    meant to list the whole 17,000-employee roster at once.

    `location` scopes results to one branch (or several, for a multi-
    location-restricted session) - used to confine a non-admin session's
    search to their own access, same as every other query in this module."""
    clause, search_params = _search_clause(search)
    if location:
        loc_clause, loc_params = _location_clause(location)
        clause += f" AND {loc_clause}"
        search_params = (*search_params, *loc_params)
    rows = conn.execute(
        f"""SELECT emp_id, emp_name, department, designation, location_id, date_joined, date_exited
           FROM employee_roster
           WHERE {clause}
           ORDER BY emp_name
           LIMIT ?""",
        (*search_params, limit),
    ).fetchall()
    return [dict(r) for r in rows]
