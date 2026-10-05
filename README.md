# Laurus Labs — Shift Drift

An attendance dashboard that turns raw punch-log data into shift-drift outliers —
the Early/Late clock-ins, and the Friday-early → Monday-late weekend-extension
pattern. Two pieces:

- **`server/`** — imports from the real attendance DB nightly, stores history
  in SQLite, and serves a small JSON API (tested against 5,000+ employees and
  a year of history).
- **`client/`** — the dashboard UI (React + Vite + Tailwind), with a
  date-range picker and branch/department filtering. Built to static files
  that `server/app.py` serves directly.

## What it does

- Ingests raw punch-log data and, for each employee/day, keeps only the
  **earliest IN punch**.
- Joins that against an employee/shift master record (`EmpID`, `ShiftCode`,
  `Department`, `location_ID`, ...) to know each employee's assigned shift and
  branch/location.
- Buckets the earliest-IN time into a shift window:
  - **A**: 05:30–07:30
  - **General**: 07:31–12:00
  - **B**: 12:01–16:00
  - **C**: 20:00–23:00
- Flags any day where the earliest-IN time falls outside the employee's own
  assigned shift's start/end (Early / Late / On-time).
- Specifically surfaces the **Friday-early → Monday-late** weekend-extension
  pattern: employees who clock in early on a Friday and late on the Monday that
  follows.
- In live mode: filters by date range, branch/location, and department; shows
  name, employee ID, designation, branch, and assigned shift per outlier row.

## Running it

Against a real attendance database (the setup here assumes a SQL Server DB
called `laurus`, with `DAYFILE`/`EMPMAST`/`tabDesignation` tables — adjust
`server/import_attendance.py`'s query if your schema differs).

1. **Install the one Python dependency** (only needed for the DB pull, not for
   serving the dashboard):
   ```
   pip install -r server/requirements.txt
   ```
2. **Configure DB credentials and dashboard login** — copy
   `server/.env.example` to `server/.env` and fill in `DB_SERVER`/`DB_USER`/
   `DB_PASSWORD` (and export them into the environment before running the
   scripts below; `.env` is gitignored and never committed), plus
   `APP_USERNAME`/`APP_PASSWORD` — the login `server/app.py` will require.
3. **Backfill history** (optional, one-off — how far back you can go depends
   on how much history your source DB actually retains):
   ```
   python3 server/backfill.py 2025-10-01 2026-09-30
   ```
4. **Schedule the nightly import** to run once a day, shortly after your
   source system's own nightly import (e.g. 00:30), via cron/Task
   Scheduler/launchd — whichever fits your host (not provided here):
   ```
   python3 server/import_attendance.py
   ```
   Each run upserts just that day's rows into `server/output/attendance.db`,
   so re-running (or backfilling) a date replaces it rather than duplicating
   it.
5. **Build the dashboard UI** — needs Node.js/npm. If you can't install Node
   system-wide (no admin rights), a portable zip works with zero system
   changes: download the "win-x64" zip for the current LTS from
   https://nodejs.org/en/download, extract it to `tools/` in the repo root,
   and use its `node.exe`/`npm.cmd` directly (no PATH edits needed) — see
   `tools/` being gitignored, this is local-machine tooling, not checked in.
   ```
   cd client
   npm install
   npm run build        # outputs to client/dist/, which server/app.py serves
   ```
   During active UI development, `npm run dev` instead runs a hot-reloading
   dev server (proxying `/api` to `server/app.py` on 8787 — start that first).
6. **Run the dashboard server**:
   ```
   python3 server/app.py
   ```
   Then open `http://127.0.0.1:8787` and log in with `APP_USERNAME`/
   `APP_PASSWORD`.

**Security note:** `server/app.py` is gated behind HTTP Basic Auth
(`APP_USERNAME`/`APP_PASSWORD` in `server/.env` — the server refuses to start
without both set) and is meant for localhost / internal-network use only.
Basic Auth sends credentials base64-encoded, not encrypted, so that's only
adequate over loopback/trusted-network traffic — don't expose this port
beyond that without putting TLS in front of it first. It holds real HR
attendance data.

If `BUCKET_RANGE` or the shift-code mapping in `server/shift_rules.py` ever
changes, already-stored rows keep whatever `flag` they were classified with
at import time (tagged with a `rules_version`) — they are **not**
automatically reclassified, so a rule change doesn't silently rewrite history
during an unrelated nightly run.

## Data sensitivity note

This repo contains only the tool. No real attendance or employee data is
checked in — `server/output/` (including the SQLite database) and
`server/.env` are gitignored. Treat any real attendance data — CSV exports,
the SQLite file, or anything in `server/output/` — as sensitive HR data: keep
it off of public tooling and don't commit it. `server/seed_demo_data.py`
writes synthetic data into `server/output/attendance.db` if you need
something to test the dashboard against without a DB connection.
