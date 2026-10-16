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

The default/initial password for a BRAND-NEW account is its DOB as
DDMMYYYY (e.g. 1971-08-01 -> "01081971") - HR's own chosen convention - and
the dashboard forces a change away from it on first login (see app.py's
module docstring). Running this script normally (no flags) only creates
new accounts and syncs name/role/locations for existing ones - it never
touches an existing account's password, so re-running it to onboard one
new hire can't silently wipe out passwords everyone else has already
personalized (see db.upsert_app_user's docstring for why that matters).

To deliberately force one or more EXISTING accounts back to their DOB
password (e.g. someone's forgotten it - there's still no SMTP/email reset
flow, HR confirmed that's fine to keep as a manual, in-person process):
    python3 seed_app_users.py --reset EMP_ID [EMP_ID2 ...]
This resets exactly those accounts to the DOB on file in users_seed.json
and re-flags must_change_password, same as a new account - every other
account is left completely alone, password included.

Usage:
    python3 seed_app_users.py                      # create new / sync profiles
    python3 seed_app_users.py --reset EMP_ID ...    # force-reset specific accounts' passwords
"""
import json
import os
import sys

import db

SEED_PATH = os.path.join(os.path.dirname(__file__), "users_seed.json")


def dob_to_password(dob_iso):
    """YYYY-MM-DD -> DDMMYYYY, HR's chosen default-password convention."""
    y, m, d = dob_iso.split("-")
    return f"{d}{m}{y}"


def load_users():
    if not os.path.isfile(SEED_PATH):
        print(f"No {SEED_PATH} found - nothing to seed. See this script's module docstring for the expected format.")
        return None
    with open(SEED_PATH, encoding="utf-8") as f:
        return json.load(f)


def main():
    args = sys.argv[1:]
    conn = db.get_connection()
    try:
        if args and args[0] == "--reset":
            reset_ids = set(args[1:])
            if not reset_ids:
                print("Usage: python3 seed_app_users.py --reset EMP_ID [EMP_ID2 ...]")
                return
            users = load_users()
            if users is None:
                return
            by_id = {u["emp_id"]: u for u in users}
            for emp_id in reset_ids:
                if emp_id not in by_id:
                    print(f"  {emp_id}: not found in {SEED_PATH}, skipped")
                    continue
                ok = db.reset_app_user_password(conn, emp_id, dob_to_password(by_id[emp_id]["dob"]))
                print(f"  {emp_id}: {'reset to DOB default, must-change-password set' if ok else 'no existing account to reset'}")
            return

        users = load_users()
        if users is None:
            return
        for u in users:
            password = dob_to_password(u["dob"])
            db.upsert_app_user(conn, u["emp_id"], u["name"], u["role"], u.get("locations") or [], password)
        print(f"Seeded/updated {len(users)} dashboard login accounts from {SEED_PATH} "
              f"(existing accounts' passwords left untouched).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
