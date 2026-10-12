#!/usr/bin/env python3
"""
Celery + Celery Beat setup for the nightly attendance import -
import_attendance.py already says it's meant to run once nightly around
00:30 (half an hour after the source system's own nightly import); this is
that schedule, automated, instead of a hand-run cron/Task Scheduler entry.

Calls import_attendance.import_date(conn, yesterday) directly rather than
import_attendance.main() - main() reads sys.argv for an optional date
override, but inside a Celery worker process sys.argv belongs to the WORKER
("worker", "--loglevel=info", ...), not this task, so going through main()
risks it trying to parse "worker" as a date and crashing. Calling import_date
directly sidesteps that entirely.

Needs a message broker - Redis by default (`pip install celery redis`, plus
Redis itself running somewhere reachable at CELERY_BROKER_URL). Redis has no
official native Windows build; on Windows, either run it under WSL2, in a
Docker container, or swap in Celery's filesystem transport (no server to
install at all, fine for a single-machine setup) - see the broker note below.

Usage (two long-running processes, both from server/, both need to keep
running - e.g. as two Windows services/scheduled "At startup" tasks, not a
one-off script):
    celery -A celery_app worker --loglevel=info --pool=solo   # Windows: --pool=solo, no fork()
    celery -A celery_app beat --loglevel=info

requirements.txt has celery + redis added - `pip install -r requirements.txt`
before running either command above.
"""
import os
from datetime import date, timedelta

from celery import Celery
from celery.schedules import crontab

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")


def load_env_file(path):
    """Minimal KEY=VALUE .env loader (stdlib only) - same pattern as every
    other script in this project (app.py, import_employee_roster.py, ...)."""
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

# Redis by default. For a no-install-needed alternative on a single Windows
# machine, set CELERY_BROKER_URL=filesystem:// in server/.env and uncomment
# the transport_options below (folders it'll use for the queue).
BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")

app = Celery("shift_drift", broker=BROKER_URL)

# if BROKER_URL.startswith("filesystem://"):
#     app.conf.broker_transport_options = {
#         "data_folder_in": "./celery_queue/out",
#         "data_folder_out": "./celery_queue/out",
#         "data_folder_processed": "./celery_queue/processed",
#     }

app.conf.timezone = "Asia/Kolkata"  # match the real-world "nightly" this follows
app.conf.beat_schedule = {
    "nightly-attendance-import": {
        "task": "celery_app.import_previous_day",
        "schedule": crontab(hour=0, minute=30),  # 00:30 daily
    },
}


@app.task(name="celery_app.import_previous_day", bind=True, max_retries=3, default_retry_delay=300)
def import_previous_day(self):
    """Imports yesterday's attendance - retries up to 3 times, 5 minutes
    apart, if the source DB is briefly unreachable (it's flaky - see
    import_attendance.py's own notes on that connection)."""
    import db
    import import_attendance

    target_date = date.today() - timedelta(days=1)
    conn = db.get_connection()
    try:
        fetched, skipped = import_attendance.import_date(conn, target_date)
    except Exception as exc:
        raise self.retry(exc=exc)
    finally:
        conn.close()

    return {"date": target_date.isoformat(), "fetched": fetched, "skipped": skipped}
