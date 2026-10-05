#!/usr/bin/env python3
"""
Shift Drift's live-mode companion server: serves the built React client
(client/dist/, see client/README or just `npm run build` in client/) plus a
small JSON API over server/output/attendance.db. stdlib-only on the Python
side (no Flask) - the API surface is a handful of GET/POST endpoints, the
rest is static file serving out of client/dist/.

Gated behind a session-cookie login (APP_USERNAME/APP_PASSWORD in
server/.env) - still meant for localhost / internal-network use only, not
for exposing beyond that. The static app shell (client/dist/) is served to
anyone (it's just code, no data); every /api/* route except /api/login
requires a valid session cookie, issued by POSTing credentials to
/api/login - the React app shows its own login page when it gets a 401.
Sessions live in memory only (lost on restart) and aren't marked Secure
(this serves plain HTTP) - don't expose this past loopback/trusted-network
without putting TLS in front of it first, same as the old Basic Auth note.

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

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT_DIST = os.path.join(REPO_ROOT, "client", "dist")
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")

MAX_RANGE_DAYS = 400
DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 1000

SESSION_COOKIE = "sd_session"
SESSIONS = set()  # valid session tokens - in-memory, cleared on restart


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


def _parse_date_range(params):
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
    if (end_d - start_d).days > MAX_RANGE_DAYS:
        raise ValueError(f"date range too large (max {MAX_RANGE_DAYS} days)")
    return start, end


def _parse_weekday(params):
    raw = _param(params, "weekday")
    if raw is None:
        return None
    try:
        weekday = int(raw)
    except ValueError:
        raise ValueError("weekday must be an integer 0-6 (0=Sunday)")
    if not (0 <= weekday <= 6):
        raise ValueError("weekday must be an integer 0-6 (0=Sunday)")
    return weekday


def _parse_pagination(params):
    try:
        page = max(1, int(_param(params, "page", "1")))
        page_size = int(_param(params, "page_size", str(DEFAULT_PAGE_SIZE)))
    except ValueError:
        raise ValueError("page/page_size must be integers")
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))
    return page, page_size


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stderr.write(f"{self.address_string()} - {format % args}\n")

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

    def _is_authenticated(self):
        token = self._session_token()
        return token is not None and token in SESSIONS

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
            token = secrets.token_urlsafe(32)
            SESSIONS.add(token)
            self._send_json({"ok": True}, status=200, set_cookie=f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict")
        else:
            self._send_error_json("Invalid username or password", 401)

    def _handle_logout(self):
        token = self._session_token()
        SESSIONS.discard(token)
        self._send_json({"ok": True}, set_cookie=f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")

    def _send_file(self, path, content_type=None):
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
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path):
        """Serves a file out of client/dist/ by its request path, falling
        back to index.html for any unknown path (client-side routing isn't
        used today, but this keeps a stray deep link from 404ing instead of
        loading the app) - never outside CLIENT_DIST (path traversal)."""
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(CLIENT_DIST, rel))
        if not full.startswith(os.path.normpath(CLIENT_DIST)):
            self._send_error_json("not found", 404)
            return
        if not os.path.isfile(full):
            full = os.path.join(CLIENT_DIST, "index.html")
        self._send_file(full)

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
            self._send_json({"authenticated": self._is_authenticated()})
            return

        if not self._is_authenticated():
            self._send_error_json("Authentication required", 401)
            return

        try:
            if path == "/api/meta":
                self._handle_meta()
            elif path == "/api/filters":
                self._handle_filters()
            elif path == "/api/outliers":
                self._handle_outliers(params)
            elif path == "/api/outliers.csv":
                self._handle_outliers_csv(params)
            elif path == "/api/combos":
                self._handle_combos(params)
            elif path == "/api/stats":
                self._handle_stats(params)
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

    def _handle_filters(self):
        conn = db.get_connection()
        try:
            self._send_json(db.query_filters(conn))
        finally:
            conn.close()

    def _handle_outliers(self, params):
        start, end = _parse_date_range(params)
        page, page_size = _parse_pagination(params)
        conn = db.get_connection()
        try:
            total, rows = db.query_outliers(
                conn, start, end,
                location=_param(params, "location"),
                department=_param(params, "department"),
                flag=_param(params, "flag"),
                search=_param(params, "search"),
                weekday=_parse_weekday(params),
                page=page, page_size=page_size,
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
                location=_param(params, "location"),
                department=_param(params, "department"),
                flag=_param(params, "flag"),
                search=_param(params, "search"),
                weekday=_parse_weekday(params),
            )
        finally:
            conn.close()

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=db.COLUMNS)
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
        conn = db.get_connection()
        try:
            combos = db.query_combos(
                conn, start, end,
                location=_param(params, "location"),
                department=_param(params, "department"),
                search=_param(params, "search"),
            )
        finally:
            conn.close()
        self._send_json({"total": len(combos), "combos": combos})

    def _handle_stats(self, params):
        start, end = _parse_date_range(params)
        conn = db.get_connection()
        try:
            stats = db.query_stats(
                conn, start, end,
                location=_param(params, "location"),
                department=_param(params, "department"),
            )
        finally:
            conn.close()
        self._send_json(stats)


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
