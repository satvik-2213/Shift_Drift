"""
Single source of truth for shift-bucket windows and Early/Late classification
on the live (SQLite-backed) data path. Mirrors BUCKET_RANGE/bucketFromMinutes/
classify() in index.html (search those names there) - that copy is what the
fully-offline/manual-CSV-upload mode in the browser still uses, since it can't
depend on this server being up. Keep the two in sync by hand if the shift
windows or code mapping ever change; see server/reclassify.py to re-derive
already-stored rows after such a change.
"""

# Minutes-since-midnight, inclusive on both ends - matches index.html's
# BUCKET_RANGE exactly.
BUCKET_RANGE = {
    "A": (330, 450),        # 05:30-07:30
    "General": (451, 720),  # 07:31-12:00
    "B": (721, 960),        # 12:01-16:00
    "C": (1200, 1380),      # 20:00-23:00
}

# The real DAYFILE pipeline only ever sees these four codes (see
# KNOWN_SHIFT_CODES in import_attendance.py), so unlike the browser's
# interactive shift-code-mapping UI (built for arbitrary ad-hoc CSVs), this
# mapping can just be fixed.
SHIFT_CODE_TO_BUCKET = {
    "GS": "General",
    "AS": "A",
    "BS": "B",
    "CS": "C",
}

# Bumped whenever BUCKET_RANGE or SHIFT_CODE_TO_BUCKET changes, so stored rows
# can be told apart from rows classified under a different rule set.
RULES_VERSION = "2026-10-01"


def bucket_from_minutes(minutes):
    """Which named bucket a clock-in time falls into, purely informational -
    it does not by itself decide the Early/Late flag (see classify_row)."""
    if minutes is None:
        return "Unclassified"
    for bucket, (lo, hi) in BUCKET_RANGE.items():
        if lo <= minutes <= hi:
            return bucket
    return "Unclassified"


def classify_row(shift_code, first_in_min):
    """Returns (assigned_bucket, derived_bucket, flag) for one employee-day.

    Compares the earliest-IN time directly against the *assigned* shift's own
    start/end, not bucket-vs-bucket, so a clock-in outside all four named
    windows still resolves to Early/Late instead of "Unclassified"."""
    derived_bucket = bucket_from_minutes(first_in_min)

    assigned_bucket = SHIFT_CODE_TO_BUCKET.get(shift_code, "")
    if not assigned_bucket:
        return assigned_bucket, derived_bucket, "Unmapped shift code"

    lo, hi = BUCKET_RANGE[assigned_bucket]
    if first_in_min < lo:
        flag = "Early"
    elif first_in_min > hi:
        flag = "Late"
    else:
        flag = "On-time"
    return assigned_bucket, derived_bucket, flag
