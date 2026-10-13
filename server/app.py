#!/usr/bin/env python3
"""
Shift Drift's live-mode companion server: serves the built React client
(client/dist/, see client/README or just `npm run build` in client/) plus a
small JSON API over server/output/attendance.db. stdlib-only on the Python
side (no Flask) - the API surface is a handful of GET/POST endpoints, the
rest is static file serving out of client/dist/.

Gated behind a session-cookie login (APP_USERNAME/APP_PASSWORD in
server/.env) - meant to sit behind a TLS-terminating reverse proxy (e.g.
nginx) on loopback, never exposed directly: this process itself still binds
127.0.0.1 and speaks plain HTTP, and the session cookie is marked Secure
(browsers then refuse to send it over any non-HTTPS connection), so local
testing against this process directly - http://127.0.0.1:PORT, not through
the proxy - won't keep a session; use the real https:// hostname instead.
The static app shell (client/dist/) is served to anyone (it's just code, no
data); every /api/* route except /api/login requires a valid session
cookie, issued by POSTing credentials to /api/login - the React app shows
its own login page when it gets a 401. Sessions live in memory only (lost
on restart).

Two kinds of login, same /api/login endpoint:
  - Master admin (APP_USERNAME/APP_PASSWORD in server/.env) - unrestricted,
    sees every location. A break-glass account, not tied to any one person.
  - Everyone else: the db.app_users table (emp_id/password/role/locations -
    see seed_app_users.py). An "admin" row there gets the same unrestricted
    access as the master account; a "restricted" row is pinned to its own
    locations (almost always one, but can be several - see
    _effective_location) for every query, regardless of what `location` the
    client sends - a non-admin can't see another branch's data just by
    editing the request.

Usage:
    python3 app.py [port]   # default 8787
"""
import csv
import hmac
import http.cookies
import io
import json
import mimetypes
import os
import secrets
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import db
import shift_rules
import xlsx_export

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT_DIST = os.path.join(REPO_ROOT, "client", "dist")
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")

MAX_RANGE_DAYS = 400
# Trend snapshots (monthly/quarterly/yearly) are summaries, not row-level
# exports, so they're allowed a much wider window than MAX_RANGE_DAYS - a
# yearly view needs several years of history to be worth looking at.
MAX_TREND_RANGE_DAYS = 1827
DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 1000

SESSION_COOKIE = "sd_session"
# token -> {"role": "admin" | "employee", "location": str | None} - in-memory,
# cleared on restart. "location" is only ever set for role "employee" (the
# location that session is pinned to); it's None for admin (unrestricted).
SESSIONS = {}


def _to_dmy(iso_date):
    """Display-only: CSV exports show DD-MM-YYYY (matching the dashboard
    UI) - everywhere else (DB storage, the JSON API, date-range query
    params) stays ISO YYYY-MM-DD, which sorts/compares correctly."""
    y, m, d = iso_date.split("-")
    return f"{d}-{m}-{y}"


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
APP_USERNAME = os.environ.get("APP_USERNAME")
APP_PASSWORD = os.environ.get("APP_PASSWORD")


def _param(params, key, default=None):
    values = params.get(key)
    if not values or values[0] == "":
        return default
    return values[0]


def _parse_date_range(params, max_days=MAX_RANGE_DAYS):
    start = _param(params, "start")
    end = _param(params, "end")
    if not start or not end:
        raise ValueError("start and end query params are required (YYYY-MM-DD)")
    try:
        start_d = datetime.strptime(start, "%Y-%m-%d").date()
        end_d = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("start/end must be YYYY-MM-DD")
    if start_d > end_d:
        raise ValueError("start must be on or before end")
    if (end_d - start_d).days > max_days:
        raise ValueError(f"date range too large (max {max_days} days)")
    return start, end


def _parse_weekday(params, key="weekday", default=None):
    raw = _param(params, key)
    if raw is None:
        return default
    try:
        weekday = int(raw)
    except ValueError:
        raise ValueError(f"{key} must be an integer 0-6 (0=Sunday)")
    if not (0 <= weekday <= 6):
        raise ValueError(f"{key} must be an integer 0-6 (0=Sunday)")
    return weekday


def _parse_combo_days(params):
    """early/late weekday pair for the flagged-pattern query (0=Sunday..
    6=Saturday) - defaults to Friday-early -> Monday-late, the original
    hardcoded pattern, so callers that don't pass these keep that behavior."""
    early = _parse_weekday(params, "early_weekday", default=5)
    late = _parse_weekday(params, "late_weekday", default=1)
    if early == late:
        raise ValueError("early_weekday and late_weekday must differ")
    return early, late


def _parse_combo_mode(params):
    mode = _param(params, "mode", "both")
    if mode not in ("both", "either"):
        raise ValueError("mode must be 'both' or 'either'")
    return mode


def _parse_sort(params, columns, default):
    """Which column a sortable table is ordered by, and which direction -
    whitelisted against the given column map (db.OUTLIER_SORT_COLUMNS or
    db.ROSTER_SORT_COLUMNS) so this never builds a SQL identifier out of raw
    user input."""
    sort = _param(params, "sort", default)
    if sort not in columns:
        raise ValueError(f"sort must be one of {sorted(columns)}")
    direction = _param(params, "dir", "desc")
    if direction not in ("asc", "desc"):
        raise ValueError("dir must be 'asc' or 'desc'")
    return sort, direction


def _parse_outlier_sort(params):
    return _parse_sort(params, db.OUTLIER_SORT_COLUMNS, "date")


def _parse_pagination(params):
    try:
        page = max(1, int(_param(params, "page", "1")))
        page_size = int(_param(params, "page_size", str(DEFAULT_PAGE_SIZE)))
    except ValueError:
        raise ValueError("page/page_size must be integers")
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))
    return page, page_size


class Handler(BaseHTTPRequestHandler):
    # BaseHTTPRequestHandler defaults to HTTP/1.0, which closes the TCP
    # connection after every single response - no keep-alive. Sitting behind
    # an nginx reverse proxy that reuses upstream connections, that mismatch
    # means nginx can try to reuse a connection this backend already closed,
    # which fails mid-request and surfaces to the browser as a broken
    # downstream HTTP/2 stream (ERR_HTTP2_PROTOCOL_ERROR) on whichever asset
    # happened to land on the stale connection - intermittent, different
    # asset each time. Safe to switch on: every response path below already
    # sends an explicit Content-Length, which is what persistent connections
    # need to know where one response ends and the next begins.
    protocol_version = "HTTP/1.1"

    # Without this, a kept-alive connection with no further requests blocks
    # its handler thread on rfile.readline() forever - ThreadingHTTPServer
    # spawns one thread per connection with no cap, so idle browser tabs
    # (which keep several keep-alive connections open per origin long after
    # the page finished loading) accumulate blocked threads all day instead
    # of freeing them. Once enough pile up, the process is short on threads/
    # file descriptors right when a new request needs one - intermittent,
    # worse for larger responses (more socket buffer needed), and affects
    # every client hitting this same process, not any one device or
    # network. 15s just needs to be long enough that a real next request
    # on the same connection isn't mistaken for an idle one.
    timeout = 15

    def log_message(self, format, *args):
        # Raw IP, not BaseHTTPRequestHandler's default address_string() -
        # that does a reverse DNS lookup (socket.getfqdn()) on every single
        # request just to log it, which is pure latency for no benefit on
        # a loopback-only internal tool.
        sys.stderr.write(f"{self.client_address[0]} - {format % args}\n")

    def _send_json(self, payload, status=200, set_cookie=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, message, status=400):
        self._send_json({"error": message}, status)

    def _session_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        jar = http.cookies.SimpleCookie()
        jar.load(raw)
        morsel = jar.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def _session_info(self):
        token = self._session_token()
        return SESSIONS.get(token) if token else None

    def _is_authenticated(self):
        return self._session_info() is not None

    def _effective_location(self, params):
        """The `location` a query should actually run with - a non-admin
        (location-restricted) session never gets more than its own allowed
        location(s), regardless of what the client sent, so scoping can't be
        bypassed by editing the request. A single-location session always
        gets that one location back. A multi-location session (e.g. one
        manager covering several units) may narrow down to any ONE of its
        own locations by requesting it - that's legitimate, not a bypass -
        but a request for anything outside its allowed set, or no location
        at all, falls back to its full allowed set. Admins (and the
        unauthenticated-login-only path) get whatever `location` the client
        asked for, with no restriction."""
        info = self._session_info()
        if not info or info["role"] != "employee":
            return _param(params, "location")
        allowed = info["location"]
        if isinstance(allowed, (list, tuple, set)):
            requested = _param(params, "location")
            return requested if requested in allowed else list(allowed)
        return allowed

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    def _handle_login(self):
        body = self._read_json_body()
        user = body.get("username", "")
        password = body.get("password", "")
        # compare_digest avoids leaking match-length via response timing
        if hmac.compare_digest(user, APP_USERNAME) and hmac.compare_digest(password, APP_PASSWORD):
            role, location = "admin", None
        else:
            conn = db.get_connection()
            try:
                matched = db.verify_app_user(conn, user, password)
            finally:
                conn.close()
            if matched is None:
                self._send_error_json("Invalid username or password", 401)
                return
            role = "admin" if matched["role"] == "admin" else "employee"
            location = None if role == "admin" else matched["locations"]
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = {"role": role, "location": location}
        self._send_json(
            {"ok": True, "role": role, "location": location},
            status=200,
            set_cookie=f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Secure",
        )

    def _handle_logout(self):
        token = self._session_token()
        SESSIONS.pop(token, None)
        self._send_json({"ok": True}, set_cookie=f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0")

    def _send_file(self, path, content_type=None, cache_control=None):
        if not os.path.isfile(path):
            self._send_error_json("not found", 404)
            return
        if content_type is None:
            content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if cache_control:
            self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path):
        """Serves a file out of client/dist/ by its request path, falling
        back to index.html for any unknown path (client-side routing isn't
        used today, but this keeps a stray deep link from 404ing instead of
        loading the app) - never outside CLIENT_DIST (path traversal).

        Cache-Control is deliberately split in two: every Vite build gives
        its JS/CSS a fresh content hash in the filename (e.g.
        index-CZbvMqV9.js), so those are safe to cache forever - a stale
        copy simply never gets requested again, since the next build's
        index.html points at different filenames. index.html itself is the
        one thing that MUST be revalidated on every load, because it's what
        names those filenames - caching it risks a browser serving a
        pre-rebuild index.html that points at JS/CSS the new build already
        deleted, which 404s and leaves the page blank until a hard refresh
        bypasses the cache (the exact bug this fixes)."""
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(CLIENT_DIST, rel))
        if not full.startswith(os.path.normpath(CLIENT_DIST)):
            self._send_error_json("not found", 404)
            return
        if not os.path.isfile(full):
            full = os.path.join(CLIENT_DIST, "index.html")
        is_index = os.path.basename(full) == "index.html"
        cache_control = "no-cache" if is_index else "public, max-age=31536000, immutable"
        self._send_file(full, cache_control=cache_control)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # Static app shell is public (no data in it) - the API is what's
        # gated. The React app itself decides what to render based on
        # whether its API calls come back 401.
        if not path.startswith("/api/"):
            self._send_static(path)
            return

        if path == "/api/session":
            info = self._session_info()
            if info:
                self._send_json({"authenticated": True, "role": info["role"], "location": info["location"]})
            else:
                self._send_json({"authenticated": False})
            return

        if not self._is_authenticated():
            self._send_error_json("Authentication required", 401)
            return

        try:
            if path == "/api/meta":
                self._handle_meta()
            elif path == "/api/filters":
                self._handle_filters(params)
            elif path == "/api/outliers":
                self._handle_outliers(params)
            elif path == "/api/outliers.csv":
                self._handle_outliers_csv(params)
            elif path == "/api/combos":
                self._handle_combos(params)
            elif path == "/api/combos.csv":
                self._handle_combos_csv(params)
            elif path == "/api/stats":
                self._handle_stats(params)
            elif path == "/api/headcount":
                self._handle_headcount(params)
            elif path == "/api/headcount.csv":
                self._handle_headcount_csv(params)
            elif path == "/api/headcount/exits":
                self._handle_headcount_exits(params)
            elif path == "/api/headcount/joins":
                self._handle_headcount_joins(params)
            elif path == "/api/attrition/trends":
                self._handle_attrition_trends(params)
            elif path == "/api/attrition/trends.csv":
                self._handle_attrition_trends_csv(params)
            elif path == "/api/attrition/trends.xlsx":
                self._handle_attrition_trends_xlsx(params)
            elif path == "/api/employees":
                self._handle_employee_search(params)
            else:
                self._send_error_json("not found", 404)
        except ValueError as e:
            self._send_error_json(str(e), 400)
        except Exception as e:  # keep the server alive on unexpected failures
            self._send_error_json(f"internal error: {e}", 500)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/login":
                self._handle_login()
            elif path == "/api/logout":
                self._handle_logout()
            else:
                self._send_error_json("not found", 404)
        except Exception as e:  # keep the server alive on unexpected failures
            self._send_error_json(f"internal error: {e}", 500)

    def _handle_meta(self):
        conn = db.get_connection()
        try:
            meta = db.query_meta(conn)
        finally:
            conn.close()
        meta["rules_version"] = shift_rules.RULES_VERSION
        self._send_json(meta)

    def _handle_filters(self, params):
        conn = db.get_connection()
        try:
            self._send_json(db.query_filters(
                conn,
                location=self._effective_location(params),
                department=_param(params, "department"),
            ))
        finally:
            conn.close()

    def _handle_outliers(self, params):
        start, end = _parse_date_range(params)
        page, page_size = _parse_pagination(params)
        sort, sort_dir = _parse_outlier_sort(params)
        conn = db.get_connection()
        try:
            total, rows = db.query_outliers(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                flag=_param(params, "flag"),
                search=_param(params, "search"),
                weekday=_parse_weekday(params),
                page=page, page_size=page_size,
                sort=sort, sort_dir=sort_dir,
            )
        finally:
            conn.close()
        self._send_json({"total": total, "page": page, "page_size": page_size, "rows": rows})

    def _handle_outliers_csv(self, params):
        start, end = _parse_date_range(params)
        conn = db.get_connection()
        try:
            rows = db.query_outliers_all(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                flag=_param(params, "flag"),
                search=_param(params, "search"),
                weekday=_parse_weekday(params),
            )
        finally:
            conn.close()

        for row in rows:
            row["date"] = _to_dmy(row["date"])

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=db.OUTLIER_CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
        body = buf.getvalue().encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="outliers_{start}_{end}.csv"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_combos(self, params):
        start, end = _parse_date_range(params)
        early_weekday, late_weekday = _parse_combo_days(params)
        mode = _parse_combo_mode(params)
        conn = db.get_connection()
        try:
            combos = db.query_combos(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                search=_param(params, "search"),
                early_weekday=early_weekday,
                late_weekday=late_weekday,
                mode=mode,
            )
        finally:
            conn.close()
        payload = {
            "total": len(combos), "combos": combos,
            "early_weekday": early_weekday, "late_weekday": late_weekday,
            "mode": mode,
        }
        if mode == "either":
            payload["both_count"] = sum(1 for c in combos if c["match"] == "both")
            payload["day1_only_count"] = sum(1 for c in combos if c["match"] == "day1_only")
            payload["day2_only_count"] = sum(1 for c in combos if c["match"] == "day2_only")
        self._send_json(payload)

    COMBO_CSV_COLUMNS = [
        "emp_id", "emp_name", "department", "department_name", "location_id", "designation",
        "match",
        "day1_date", "day1_shift_code", "day1_clock_in",
        "day2_date", "day2_shift_code", "day2_clock_in",
        "pair_count",
    ]

    def _handle_combos_csv(self, params):
        start, end = _parse_date_range(params)
        early_weekday, late_weekday = _parse_combo_days(params)
        mode = _parse_combo_mode(params)
        conn = db.get_connection()
        try:
            combos = db.query_combos(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                search=_param(params, "search"),
                early_weekday=early_weekday,
                late_weekday=late_weekday,
                mode=mode,
            )
        finally:
            conn.close()

        def clock(minutes):
            return f"{minutes // 60:02d}:{minutes % 60:02d}" if minutes is not None else ""

        rows = []
        for c in combos:
            d1, d2 = c["day1"], c["day2"]
            anchor = d1 or d2
            rows.append({
                "emp_id": anchor["emp_id"], "emp_name": anchor["emp_name"],
                "department": anchor["department"], "department_name": anchor["department_name"],
                "location_id": anchor["location_id"],
                "designation": anchor["designation"],
                "match": c.get("match", "both"),
                "day1_date": _to_dmy(d1["date"]) if d1 else "",
                "day1_shift_code": d1["shift_code"] if d1 else "",
                "day1_clock_in": clock(d1["first_in_min"]) if d1 else "",
                "day2_date": _to_dmy(d2["date"]) if d2 else "",
                "day2_shift_code": d2["shift_code"] if d2 else "",
                "day2_clock_in": clock(d2["first_in_min"]) if d2 else "",
                "pair_count": c["pair_count"],
            })

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=self.COMBO_CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
        body = buf.getvalue().encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="flagged_pattern_{mode}_{start}_{end}.csv"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_stats(self, params):
        start, end = _parse_date_range(params)
        early_weekday, late_weekday = _parse_combo_days(params)
        conn = db.get_connection()
        try:
            stats = db.query_stats(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                early_weekday=early_weekday,
                late_weekday=late_weekday,
            )
        finally:
            conn.close()
        self._send_json(stats)

    def _handle_headcount(self, params):
        start, end = _parse_date_range(params)
        conn = db.get_connection()
        try:
            headcount = db.query_headcount(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                block=_param(params, "block"),
            )
        finally:
            conn.close()
        self._send_json(headcount)

    HEADCOUNT_CSV_COLUMNS = [
        "period_start", "period_end", "headcount_start",
        "exits", "joins", "headcount_end", "attrition_rate",
    ]

    def _handle_headcount_csv(self, params):
        start, end = _parse_date_range(params)
        conn = db.get_connection()
        try:
            headcount = db.query_headcount(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                block=_param(params, "block"),
            )
        finally:
            conn.close()

        row = {"period_start": _to_dmy(start), "period_end": _to_dmy(end), **headcount}
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=self.HEADCOUNT_CSV_COLUMNS)
        writer.writeheader()
        writer.writerow(row)
        body = buf.getvalue().encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="headcount_{start}_{end}.csv"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_headcount_exits(self, params):
        start, end = _parse_date_range(params)
        page, page_size = _parse_pagination(params)
        sort, sort_dir = _parse_sort(params, db.ROSTER_SORT_COLUMNS, "date_exited")
        conn = db.get_connection()
        try:
            total, rows = db.query_exited_employees(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                search=_param(params, "search"),
                page=page, page_size=page_size,
                sort=sort, sort_dir=sort_dir,
                block=_param(params, "block"),
            )
        finally:
            conn.close()
        self._send_json({"total": total, "page": page, "page_size": page_size, "rows": rows})

    def _handle_headcount_joins(self, params):
        start, end = _parse_date_range(params)
        page, page_size = _parse_pagination(params)
        sort, sort_dir = _parse_sort(params, db.ROSTER_SORT_COLUMNS, "date_joined")
        conn = db.get_connection()
        try:
            total, rows = db.query_joined_employees(
                conn, start, end,
                location=self._effective_location(params),
                department=_param(params, "department"),
                search=_param(params, "search"),
                page=page, page_size=page_size,
                sort=sort, sort_dir=sort_dir,
                block=_param(params, "block"),
            )
        finally:
            conn.close()
        self._send_json({"total": total, "page": page, "page_size": page_size, "rows": rows})

    def _handle_attrition_trends(self, params):
        start, end = _parse_date_range(params, max_days=MAX_TREND_RANGE_DAYS)
        granularity = _param(params, "granularity", "month")
        if granularity not in ("month", "quarter", "year"):
            raise ValueError("granularity must be one of month, quarter, year")
        conn = db.get_connection()
        try:
            periods = db.query_attrition_trends(
                conn, start, end, granularity,
                location=self._effective_location(params),
                department=_param(params, "department"),
                block=_param(params, "block"),
            )
        finally:
            conn.close()
        self._send_json({"periods": periods})

    TREND_CSV_COLUMNS = [
        "period", "period_start", "period_end", "headcount_start",
        "exits", "joins", "headcount_end", "attrition_rate",
    ]

    def _handle_attrition_trends_csv(self, params):
        start, end = _parse_date_range(params, max_days=MAX_TREND_RANGE_DAYS)
        granularity = _param(params, "granularity", "month")
        if granularity not in ("month", "quarter", "year"):
            raise ValueError("granularity must be one of month, quarter, year")
        conn = db.get_connection()
        try:
            periods = db.query_attrition_trends(
                conn, start, end, granularity,
                location=self._effective_location(params),
                department=_param(params, "department"),
                block=_param(params, "block"),
            )
        finally:
            conn.close()

        rows = [{
            **p,
            "period_start": _to_dmy(p["period_start"]),
            "period_end": _to_dmy(p["period_end"]),
        } for p in periods]

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=self.TREND_CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
        body = buf.getvalue().encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="attrition_trends_{granularity}_{start}_{end}.csv"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_attrition_trends_xlsx(self, params):
        start, end = _parse_date_range(params, max_days=MAX_TREND_RANGE_DAYS)
        granularity = _param(params, "granularity", "month")
        if granularity not in ("month", "quarter", "year"):
            raise ValueError("granularity must be one of month, quarter, year")
        conn = db.get_connection()
        try:
            periods = db.query_attrition_trends(
                conn, start, end, granularity,
                location=self._effective_location(params),
                department=_param(params, "department"),
                block=_param(params, "block"),
            )
        finally:
            conn.close()

        body = xlsx_export.build_trend_workbook(periods)

        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Disposition", f'attachment; filename="attrition_trend_{granularity}_{start}_{end}.xlsx"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_employee_search(self, params):
        search = _param(params, "search")
        if not search:
            raise ValueError("search query param is required")
        conn = db.get_connection()
        try:
            rows = db.query_employee_search(conn, search, location=self._effective_location(params))
        finally:
            conn.close()
        self._send_json({"rows": rows})


def main():
    if not APP_USERNAME or not APP_PASSWORD:
        print("Missing APP_USERNAME/APP_PASSWORD - set both in server/.env before running the server.")
        print("This gates login to the dashboard, which holds real HR attendance data.")
        sys.exit(1)

    if not os.path.isfile(os.path.join(CLIENT_DIST, "index.html")):
        print(f"No build found at {CLIENT_DIST}.")
        print("Run `npm install` then `npm run build` in client/ first.")
        sys.exit(1)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Shift Drift live server at http://127.0.0.1:{port} (localhost only)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
