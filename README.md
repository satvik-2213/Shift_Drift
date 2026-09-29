# Shift Drift

A single-file, offline-capable attendance dashboard that turns raw device punch-log
exports into shift-drift outliers — with no backend and no external dependencies.

## What it does

- Ingests raw punch-log CSVs (`DeviceLogId`, `LogDate`, `Direction`, ...) and, for
  each employee/day, keeps only the **earliest IN punch**.
- Joins that against a separate employee/shift master CSV (`EmpID`, `ShiftCode`,
  `Department`, ...) to know each employee's assigned shift.
- Buckets the earliest-IN time into a shift window:
  - **A**: 05:30–07:30
  - **General**: 07:31–12:00
  - **B**: 12:01–16:00
  - **C**: 20:00–23:00
- Flags any day where the derived bucket is earlier or later than the employee's
  assigned shift.
- Specifically surfaces the **Friday-early → Monday-late** weekend-extension
  pattern: employees who clock in early on a Friday and late on the Monday that
  follows.

## Running it

Open `index.html` directly in a browser — no server, no build step, no network
access required. It ships with realistic sample data so it's usable immediately;
use the upload controls to swap in real punch-log and master CSVs.

All CSV parsing and analysis happens client-side, in-browser. Uploaded data is
never sent anywhere.

## Data sensitivity note

This repo contains only the tool. No real attendance or employee data is checked
in — the bundled sample data is synthetic. Treat any exported CSVs from your
attendance system as sensitive HR data: keep them off of public tooling and
delete local copies after use.
