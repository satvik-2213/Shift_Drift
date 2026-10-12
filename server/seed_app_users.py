#!/usr/bin/env python3
"""
Seeds/resets server/output/attendance.db's app_users table (dashboard login
accounts beyond the single master admin - see app.py's module docstring)
from server/users_seed.json - a local-only, gitignored data file containing
real names and dates of birth, which this script never prints or logs.

users_seed.json is a JSON array of:
  {"emp_id": "...", "name": "...", "role": "admin" | "restricted",
   "locations": [...], "dob": "YYYY-MM-DD"}
`locations` is a list of employee_roster.location_id values (see
/api/filters) - almost always one, but a manager covering several units
gets several; ignored for role "admin" (unrestricted either way).

The default/initial password for every account is its DOB as DDMMYYYY
(e.g. 1971-08-01 -> "01081971") - HR's own chosen convention. There is
deliberately no password-reset flow (no SMTP configured anywhere in this
project, and HR confirmed the DOB default is fine to keep permanently) -
whoever needs an account's password changed re-runs this script with an
updated users_seed.json entry, same as creating the account in the first
place.

Usage:
    python3 seed_app_users.py
"""
import json
import os

import db

SEED_PATH = os.path.join(os.path.dirname(__file__), "users_seed.json")


def dob_to_password(dob_iso):
    """YYYY-MM-DD -> DDMMYYYY, HR's chosen default-password convention."""
    y, m, d = dob_iso.split("-")
    return f"{d}{m}{y}"


def main():
    if not os.path.isfile(SEED_PATH):
        print(f"No {SEED_PATH} found - nothing to seed. See this script's module docstring for the expected format.")
        return

    with open(SEED_PATH, encoding="utf-8") as f:
        users = json.load(f)

    conn = db.get_connection()
    try:
        for u in users:
            password = dob_to_password(u["dob"])
            db.upsert_app_user(conn, u["emp_id"], u["name"], u["role"], u.get("locations") or [], password)
    finally:
        conn.close()

    print(f"Seeded/updated {len(users)} dashboard login accounts from {SEED_PATH}.")


if __name__ == "__main__":
    main()
