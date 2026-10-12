export function compactNumber(n) {
  if (n == null) return "-";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

export function minutesToClock(minutes) {
  if (minutes == null) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_FULL_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Formats the `period` key returned by /api/attrition/trends ("YYYY-MM",
// "YYYY-Qn", or "YYYY") into a short axis label, e.g. "Jan '25", "Q1 '25", "2025".
export function formatPeriodLabel(period) {
  const quarterMatch = period.match(/^(\d{4})-Q(\d)$/);
  if (quarterMatch) return `Q${quarterMatch[2]} '${quarterMatch[1].slice(2)}`;
  const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) return `${MONTH_NAMES[Number(monthMatch[2]) - 1]} '${monthMatch[1].slice(2)}`;
  return period;
}

// Display-only - the underlying value stays ISO (YYYY-MM-DD) everywhere
// (API params, state, sorting/comparison all depend on that); this just
// reformats it for showing to the user. DD-MM-YYYY site-wide, no exceptions.
export function formatDateDMY(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
