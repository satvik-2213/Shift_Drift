#!/usr/bin/env python3
"""
Shift Drift's live-mode companion server: serves index.html plus a small
JSON API over server/output/attendance.db. stdlib-only (no Flask) - the
whole surface is 5 GET endpoints and one static file, not enough to justify
a new dependency.

No authentication. Intended for localhost / internal-network use only - this
holds real HR attendance data, don't expose this port beyond that.

Usage:
    python3 app.py [port]   # default 8787
"""
import csv
import io
import json
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import db
import shift_rules

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_HTML = os.path.join(REPO_ROOT, "index.html")

MAX_RANGE_DAYS = 400
DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 1000


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

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, message, status=400):
        self._send_json({"error": message}, status)

    def _send_file(self, path, content_type):
        if not os.path.isfile(path):
            self._send_error_json("not found", 404)
            return
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        try:
            if path in ("/", "/index.html"):
                self._send_file(INDEX_HTML, "text/html; charset=utf-8")
            elif path == "/api/meta":
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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Shift Drift live server at http://127.0.0.1:{port} (localhost only)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
