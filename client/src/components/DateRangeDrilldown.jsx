import { useEffect, useState } from "react";
import { compactNumber, formatDateDMY } from "../lib/format";
import { getHeadcount, ApiError } from "../lib/api";
import AttritionTrendChart from "./AttritionTrendChart";

// Below a week: just the one whole-range row, nothing to usefully break
// into weeks or days. A week up to (not including) a month: whole range ->
// click -> daily rows. A month up to (not including) ~2 months: whole range
// -> click -> weekly rows -> click a week -> daily rows. ~2 months or more
// (multiple months, a year, whatever): whole range -> click -> MONTHLY rows
// -> click a month -> weekly rows for just that month -> click a week ->
// daily rows for just that week - one calendar month is too few weeks to be
// worth its own grouping level, but a year of weekly rows (~52 of them) is
// unusable, so months become the top breakdown once there are enough of
// them to actually group. "Week" chunks are sequential 7-day blocks from
// whatever the chunk's own start is, not calendar Mon-Sun weeks - there's no
// calendar-week boundary to anchor to since the overall range is arbitrary
// (whatever the filter bar's date pickers say). Month chunks DO follow
// calendar month boundaries (1st to end-of-month), clipped to the real
// start/end at the edges, since "month" only reads naturally that way.
const WEEK_THRESHOLD_DAYS = 7;
const MONTH_THRESHOLD_DAYS = 28;
const MULTI_MONTH_THRESHOLD_DAYS = 60;

// "DD/MM", no year - for the chart's x-axis only. A chunk's full range (not
// just the day it starts on) still needs to show on multi-day chunks - the
// last week/month chunk of a range is often a short tail (e.g. just the
// 29th-30th), and labeling it with only its start date made that tail look
// like missing data. This stays short enough to avoid the same label-
// collision problem the full "DD-MM-YYYY–DD-MM-YYYY" format caused.
function shortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function daysInclusive(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
}

function addDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildDailyChunks(start, end) {
  const chunks = [];
  let cur = start;
  while (cur <= end) {
    chunks.push({ start: cur, end: cur });
    cur = addDays(cur, 1);
  }
  return chunks;
}

function buildWeeklyChunks(start, end) {
  const chunks = [];
  let cur = start;
  while (cur <= end) {
    const tentativeEnd = addDays(cur, 6);
    const chunkEnd = tentativeEnd > end ? end : tentativeEnd;
    chunks.push({ start: cur, end: chunkEnd });
    cur = addDays(chunkEnd, 1);
  }
  return chunks;
}

function endOfMonth(iso) {
  // Date.UTC, not `new Date(y, m, d)` - that second form reads/writes LOCAL
  // time, while every other date here is parsed from an ISO string (UTC
  // midnight) - mixing the two shifted the result a day either way outside
  // UTC+0 (e.g. IST), which could make `cur` stop advancing and loop forever.
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of month m (1-indexed) = last day of month m-1 (0-indexed) = month m itself
}

function buildMonthlyChunks(start, end) {
  const chunks = [];
  let cur = start;
  while (cur <= end) {
    const monthEnd = endOfMonth(cur);
    const chunkEnd = monthEnd > end ? end : monthEnd;
    chunks.push({ start: cur, end: chunkEnd });
    cur = addDays(chunkEnd, 1);
  }
  return chunks;
}

function ChevronIcon({ expanded }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3 w-3 flex-none transition-transform ${expanded ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function Row({ label, data, indent = 0, expandable = false, expanded = false, onToggle }) {
  return (
    <tr
      className={`border-b border-[color:var(--border)] last:border-0 ${expandable ? "cursor-pointer hover:bg-[color:var(--bg-surface-2)]" : ""}`}
      onClick={expandable ? onToggle : undefined}
    >
      <td className="py-1.5 pr-3 align-top tabular" style={{ paddingLeft: 12 + indent * 18 }}>
        <span className="inline-flex items-center gap-1.5">
          {expandable ? <ChevronIcon expanded={expanded} /> : indent > 0 ? <span className="inline-block w-3" /> : null}
          {label}
        </span>
      </td>
      <td className="px-3 py-1.5 align-top tabular">{data ? compactNumber(data.headcount_start) : "-"}</td>
      <td className="px-3 py-1.5 align-top tabular" style={{ color: "var(--late)" }}>
        {data ? compactNumber(data.exits) : "-"}
      </td>
      <td className="px-3 py-1.5 align-top tabular" style={{ color: "var(--ontime)" }}>
        {data ? compactNumber(data.joins) : "-"}
      </td>
      <td className="px-3 py-1.5 align-top tabular">{data ? compactNumber(data.headcount_end) : "-"}</td>
      <td className="px-3 py-1.5 align-top tabular font-medium" style={{ color: "var(--late)" }}>
        {data ? `${data.attrition_rate}%` : "-"}
      </td>
    </tr>
  );
}

function LoadingRow({ indent = 0 }) {
  return (
    <tr className="border-b border-[color:var(--border)] last:border-0">
      <td colSpan={6} className="py-2 text-xs text-[color:var(--text-muted)]" style={{ paddingLeft: 12 + indent * 18 }}>
        Loading&hellip;
      </td>
    </tr>
  );
}

function ErrorRow({ message, indent = 0 }) {
  return (
    <tr className="border-b border-[color:var(--border)] last:border-0">
      <td colSpan={6} className="py-2 text-xs font-medium text-[color:var(--late)]" style={{ paddingLeft: 12 + indent * 18 }}>
        {message}
      </td>
    </tr>
  );
}

function WeekRow({ chunk, scope, indent = 1 }) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const label = `${formatDateDMY(chunk.start)} – ${formatDateDMY(chunk.end)}`;

  const toggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (days) return;
    setLoading(true);
    setError(null);
    try {
      const chunks = buildDailyChunks(chunk.start, chunk.end);
      const results = await Promise.all(
        chunks.map((c) => getHeadcount({ start: c.start, end: c.end, location: scope.location, department: scope.department, block: scope.block }))
      );
      setDays(chunks.map((c, i) => ({ ...c, data: results[i] })));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load daily breakdown");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Row label={label} data={chunk.data} indent={indent} expandable expanded={expanded} onToggle={toggle} />
      {expanded && error && <ErrorRow message={error} indent={indent + 1} />}
      {expanded && loading && <LoadingRow indent={indent + 1} />}
      {expanded &&
        days &&
        days.map((d) => <Row key={d.start} label={formatDateDMY(d.start)} data={d.data} indent={indent + 1} />)}
    </>
  );
}

function MonthRow({ chunk, scope }) {
  const [expanded, setExpanded] = useState(false);
  const [weeks, setWeeks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const label = `${formatDateDMY(chunk.start)} – ${formatDateDMY(chunk.end)}`;

  const toggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (weeks) return;
    setLoading(true);
    setError(null);
    try {
      const chunks = buildWeeklyChunks(chunk.start, chunk.end);
      const results = await Promise.all(
        chunks.map((c) => getHeadcount({ start: c.start, end: c.end, location: scope.location, department: scope.department, block: scope.block }))
      );
      setWeeks(chunks.map((c, i) => ({ ...c, data: results[i] })));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load weekly breakdown");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Row label={label} data={chunk.data} indent={1} expandable expanded={expanded} onToggle={toggle} />
      {expanded && error && <ErrorRow message={error} indent={2} />}
      {expanded && loading && <LoadingRow indent={2} />}
      {expanded && weeks && weeks.map((w) => <WeekRow key={w.start} chunk={w} scope={scope} indent={2} />)}
    </>
  );
}

export default function DateRangeDrilldown({ scope, headcount }) {
  const { start, end } = scope || {};
  // Table row expand/collapse (click-driven) is separate from fetching the
  // top-tier breakdown: the chart below needs that breakdown up front to
  // have more than one bar group to show, not gated behind a click the way
  // the table's own drill-down still is.
  const [tableExpanded, setTableExpanded] = useState(false);
  const [subRows, setSubRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const totalDays = start && end ? daysInclusive(start, end) : 0;
  const isWeekOrMore = totalDays >= WEEK_THRESHOLD_DAYS;
  const isMonthOrMore = totalDays >= MONTH_THRESHOLD_DAYS;
  const isMultiMonthOrMore = totalDays >= MULTI_MONTH_THRESHOLD_DAYS;

  useEffect(() => {
    if (!isWeekOrMore || !start || !end) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const chunks = isMultiMonthOrMore
      ? buildMonthlyChunks(start, end)
      : isMonthOrMore
      ? buildWeeklyChunks(start, end)
      : buildDailyChunks(start, end);
    Promise.all(chunks.map((c) => getHeadcount({ start: c.start, end: c.end, location: scope.location, department: scope.department, block: scope.block })))
      .then((results) => {
        if (!cancelled) setSubRows(chunks.map((c, i) => ({ ...c, data: results[i] })));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load breakdown");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, isWeekOrMore, isMonthOrMore, isMultiMonthOrMore, scope?.location, scope?.department, scope?.block]);

  if (!headcount || !start || !end) {
    return (
      <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
        <table className="w-full min-w-[460px] border-collapse text-left text-[12px]">
          <tbody>
            <tr>
              <td className="px-3 py-6 text-center text-[color:var(--text-muted)]">No data for this range.</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const wholeLabel = `${formatDateDMY(start)} – ${formatDateDMY(end)}`;

  // Chart data: the whole range as one bar group below a week (nothing to
  // break down into), otherwise one group per top-tier chunk (day/week/
  // month, same breakdown the table itself expands into). Labeled with a
  // short "DD/MM" (or "DD/MM–DD/MM" when the chunk spans more than one day) -
  // not the full "DD-MM-YYYY–DD-MM-YYYY" the table rows show, which was too
  // long to fit a narrow x-axis band without colliding with its neighbors,
  // and not just the chunk's start date either, which made a short tail
  // chunk (e.g. a range's last 2 days) look like it was missing data instead
  // of just being unlabeled past its first day. `period` isn't one of
  // formatPeriodLabel's recognized codes, so it prints as-is.
  const chartPeriods = !isWeekOrMore
    ? [{ period: wholeLabel, ...headcount }]
    : (subRows || []).map((row) => ({
        period: row.start === row.end ? shortDate(row.start) : `${shortDate(row.start)}–${shortDate(row.end)}`,
        ...row.data,
      }));

  const toggleTable = () => {
    if (isWeekOrMore) setTableExpanded((e) => !e);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      {loading && chartPeriods.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading&hellip;</p>
      ) : error && chartPeriods.length === 0 ? (
        <p className="text-xs font-medium text-[color:var(--late)]">{error}</p>
      ) : (
        <AttritionTrendChart periods={chartPeriods} />
      )}
      <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
        <table className="w-full min-w-[460px] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[color:var(--border)] text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <th className="py-1.5 pr-3 pl-3 font-medium">Date range</th>
              <th className="px-3 py-1.5 font-medium">Opening headcount</th>
              <th className="px-3 py-1.5 font-medium">Exits</th>
              <th className="px-3 py-1.5 font-medium">Joins</th>
              <th className="px-3 py-1.5 font-medium">Closing headcount</th>
              <th className="px-3 py-1.5 font-medium">Attrition rate</th>
            </tr>
          </thead>
          <tbody>
            <Row label={wholeLabel} data={headcount} expandable={isWeekOrMore} expanded={tableExpanded} onToggle={toggleTable} />
            {tableExpanded && error && <ErrorRow message={error} indent={1} />}
            {tableExpanded && loading && <LoadingRow indent={1} />}
            {tableExpanded &&
              subRows &&
              subRows.map((row) =>
                isMultiMonthOrMore ? (
                  <MonthRow key={row.start} chunk={row} scope={scope} />
                ) : isMonthOrMore ? (
                  <WeekRow key={row.start} chunk={row} scope={scope} />
                ) : (
                  <Row key={row.start} label={formatDateDMY(row.start)} data={row.data} indent={1} />
                )
              )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
