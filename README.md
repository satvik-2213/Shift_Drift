# Shift Drift

An attendance dashboard that turns raw punch-log data into shift-drift outliers —
the Early/Late clock-ins, and the Friday-early → Monday-late weekend-extension
pattern. It runs in two modes:

- **Offline** — a single HTML file, no backend, no dependencies, no network
  access. Open it, upload CSVs (or use the bundled sample data), done. Good for
  trying the tool out or analyzing a one-off export.
- **Live** — a small local companion server (`server/`) that imports from a
  real attendance DB nightly, stores history in SQLite, and serves the
  dashboard with a date-range picker and branch/department filtering at
  whatever scale your organization needs (tested against 5,000+ employees and
  a year of history). Use this for an always-current, ongoing dashboard.

Both modes share the same `index.html` — it detects a running companion server
on load and switches automatically; if none is found, it falls back to the
fully offline experience untouched.

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

## Running it offline

Open `index.html` directly in a browser — no server, no build step, no network
access required. It ships with realistic sample data so it's usable
immediately; use the upload controls to swap in real punch-log and master
CSVs. All CSV parsing and analysis happens client-side, in-browser. Uploaded
data is never sent anywhere.

## Running it live

The live path is for a real, ongoing deployment against an attendance
database (the setup here assumes a SQL Server DB called `laurus`, with
`DAYFILE`/`EMPMAST`/`tabDesignation` tables — adjust `server/import_attendance.py`'s
query if your schema differs).

1. **Install the one dependency** (only needed for the DB pull, not for
   serving the dashboard):
   ```
   pip install -r server/requirements.txt
   ```
2. **Configure DB credentials** — copy `server/.env.example` to `server/.env`
   and fill in `DB_SERVER`/`DB_USER`/`DB_PASSWORD` (and export them into the
   environment before running the scripts below; `.env` is gitignored and
   never committed).
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
5. **Run the dashboard server**:
   ```
   python3 server/app.py
   ```
   Then open `http://127.0.0.1:8787` — the dashboard detects the server and
   switches to live mode automatically.

**Security note:** `server/app.py` has no authentication and is meant for
localhost / internal-network use only. It holds real HR attendance data —
don't expose this port beyond that without adding access control first.

If `BUCKET_RANGE` or the shift-code mapping in `server/shift_rules.py` ever
changes, already-stored rows keep whatever `flag` they were classified with
at import time (tagged with a `rules_version`) — they are **not**
automatically reclassified, so a rule change doesn't silently rewrite history
during an unrelated nightly run.

## Data sensitivity note

This repo contains only the tool. No real attendance or employee data is
checked in — the bundled sample data is synthetic, and `server/output/`
(including the SQLite database) and `server/.env` are gitignored. Treat any
real attendance data — CSV exports, the SQLite file, or anything in
`server/output/` — as sensitive HR data: keep it off of public tooling and
don't commit it.
