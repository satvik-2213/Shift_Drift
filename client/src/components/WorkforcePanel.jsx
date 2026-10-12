import { useEffect, useRef, useState } from "react";
import { compactNumber, formatDateDMY, formatPeriodLabel } from "../lib/format";
import { getAttritionTrends, attritionTrendsCsvUrl, headcountCsvUrl, ApiError } from "../lib/api";
import AttritionTrendChart from "./AttritionTrendChart";
import RosterDrilldownTable from "./RosterDrilldownTable";
import DateRangeDrilldown from "./DateRangeDrilldown";

const GRANULARITIES = [
  { key: "month", label: "Monthly", periods: 12 },
  { key: "quarter", label: "Quarterly", periods: 8 },
  { key: "year", label: "Yearly", periods: 5 },
];

// "Date Range" is a tab alongside the trend granularities, but it isn't a
// trend at all - no trailing window, no periods API call, just the single
// opening/closing/exits/joins totals for whatever range is in the filter
// bar right now (the same numbers as the headcount tiles up top), shown as
// a one-row table so HR can read/export exactly that range.
const TABS = [{ key: "range", label: "Date Range" }, ...GRANULARITIES];

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19.5h16" />
    </svg>
  );
}

function DownloadCsvButton({ href, label = "Download CSV" }) {
  return (
    <button
      type="button"
      onClick={() => window.open(href, "_blank")}
      className="flex items-center justify-center rounded-lg border border-[color:var(--border-strong)] p-1.5 text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
      title={label}
    >
      <DownloadIcon />
    </button>
  );
}

// Trend snapshots look back N periods of that granularity from `end`,
// independent of the main filter bar's date range - a useful monthly/
// quarterly/yearly overview needs its own trailing window, not whatever
// handful of days happens to be selected up top.
function trendStartDate(end, granularity, periodCount) {
  const d = new Date(end);
  if (granularity === "month") d.setMonth(d.getMonth() - periodCount + 1, 1);
  else if (granularity === "quarter") d.setMonth(d.getMonth() - periodCount * 3 + 1, 1);
  else d.setFullYear(d.getFullYear() - periodCount + 1, 0, 1);
  return d.toISOString().slice(0, 10);
}

function HeadcountTile({ label, value, color, onClick, active }) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className="rounded-2xl border p-4 text-left shadow-[var(--shadow)] transition-colors"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: "var(--bg-surface)",
        cursor: clickable ? "pointer" : "default",
      }}
    >
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
        {label}
        {clickable && <span className="text-[color:var(--accent)]">&#8964;</span>}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: color ?? "var(--text-primary)" }}>
        {value}
      </div>
    </button>
  );
}

function EmployeeTable({ rows }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-[color:var(--border)]">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-[color:var(--border)] text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
            <th className="px-3 py-2 font-medium">Employee</th>
            <th className="px-3 py-2 font-medium">Designation</th>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="px-3 py-2 font-medium">Date joined</th>
            <th className="px-3 py-2 font-medium">Date exited</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.emp_id} className="border-b border-[color:var(--border)] last:border-0">
              <td className="px-3 py-2 align-top">
                <div className="font-medium text-[color:var(--text-primary)]">{r.emp_name || r.emp_id}</div>
                <div className="text-xs text-[color:var(--text-muted)]">{r.emp_id}</div>
              </td>
              <td className="px-3 py-2 align-top">{r.designation}</td>
              <td className="px-3 py-2 align-top">{r.location_id}</td>
              <td className="px-3 py-2 align-top tabular">{r.date_joined ? formatDateDMY(r.date_joined) : "-"}</td>
              <td className="px-3 py-2 align-top tabular">{r.date_exited ? formatDateDMY(r.date_exited) : "-"}</td>
              <td className="px-3 py-2 align-top">
                {r.date_exited ? (
                  <span className="font-semibold" style={{ color: "var(--late)" }}>
                    Exited
                  </span>
                ) : (
                  <span className="font-semibold" style={{ color: "var(--ontime)" }}>
                    Active
                  </span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-[color:var(--text-muted)]">
                No employees here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const BLOCK_LABELS = { DS15: "DS15 (GROUPCODE 860)", DS1: "DS1 (GROUPCODE 861)" };

function BlockHeadcountCard({ blockKey, data }) {
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 shadow-[var(--shadow)]">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
        {BLOCK_LABELS[blockKey]}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">Opening</div>
          <div className="text-lg font-semibold text-[color:var(--text-primary)]">
            {data ? compactNumber(data.headcount_start) : "-"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">Exits</div>
          <div className="text-lg font-semibold" style={{ color: "var(--late)" }}>
            {data ? compactNumber(data.exits) : "-"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">Joins</div>
          <div className="text-lg font-semibold" style={{ color: "var(--ontime)" }}>
            {data ? compactNumber(data.joins) : "-"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">Closing</div>
          <div className="text-lg font-semibold text-[color:var(--text-primary)]">
            {data ? compactNumber(data.headcount_end) : "-"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">Attrition rate</div>
          <div className="text-lg font-semibold" style={{ color: "var(--late)" }}>
            {data ? `${data.attrition_rate}%` : "-"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkforcePanel({ headcount, prevHeadcount, blockHeadcounts, scope, employeeResults, employeeSearchError }) {
  // Exits/Joins tiles are drill-downs: click toggles a table of the
  // specific employees behind that count, for the same date/location/
  // department scope currently selected in the filter bar.
  const [drilldown, setDrilldown] = useState(null); // null | "exits" | "joins"
  const drilldownRef = useRef(null);

  const [granularity, setGranularity] = useState("month");
  const [trendPeriods, setTrendPeriods] = useState(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState(null);

  useEffect(() => {
    if (!scope?.end) return;
    if (granularity === "range") {
      // Not a trend - the "Date Range" tab just reads the already-fetched
      // `headcount` prop for the filter bar's own start/end.
      setTrendPeriods(null);
      setTrendError(null);
      setTrendLoading(false);
      return;
    }
    let cancelled = false;
    const config = GRANULARITIES.find((g) => g.key === granularity);
    setTrendLoading(true);
    setTrendError(null);
    getAttritionTrends({
      start: trendStartDate(scope.end, granularity, config.periods),
      end: scope.end,
      granularity,
      location: scope.location,
      department: scope.department,
      block: scope.block,
    })
      .then(({ periods }) => {
        if (!cancelled) setTrendPeriods(periods);
      })
      .catch((e) => {
        if (!cancelled) setTrendError(e instanceof ApiError ? e.message : "Failed to load attrition trends");
      })
      .finally(() => !cancelled && setTrendLoading(false));
    return () => {
      cancelled = true;
    };
  }, [scope?.end, scope?.location, scope?.department, scope?.block, granularity]);

  const toggleDrilldown = (kind) => setDrilldown((d) => (d === kind ? null : kind));

  // Scrolls the Exits/Joins drilldown table into view once it actually has
  // rows to show (RosterDrilldownTable's onLoaded, below) - not the instant
  // it opens, since the table renders nothing until its own fetch resolves,
  // so scrolling on open targeted an empty container with no real height
  // yet. Same reasoning as the Outliers accordion on the Shift Drift tab.
  const scrollDrilldownIntoView = () => {
    requestAnimationFrame(() => {
      drilldownRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Shared by the trend CSV and Excel-chart downloads - same trailing
  // window/filters, just two different file formats of the same data.
  const trendParams = (g) => ({
    start: trendStartDate(scope.end, g, GRANULARITIES.find((x) => x.key === g).periods),
    end: scope.end,
    granularity: g,
    location: scope.location,
    department: scope.department,
    block: scope.block,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <HeadcountTile label="Opening headcount" value={headcount ? compactNumber(headcount.headcount_start) : "-"} />
        <HeadcountTile
          label="Exits"
          value={headcount ? compactNumber(headcount.exits) : "-"}
          color="var(--late)"
          onClick={() => toggleDrilldown("exits")}
          active={drilldown === "exits"}
        />
        <HeadcountTile
          label="Joins"
          value={headcount ? compactNumber(headcount.joins) : "-"}
          color="var(--ontime)"
          onClick={() => toggleDrilldown("joins")}
          active={drilldown === "joins"}
        />
        <HeadcountTile label="Closing headcount" value={headcount ? compactNumber(headcount.headcount_end) : "-"} />
        <HeadcountTile label="Attrition rate" value={headcount ? `${headcount.attrition_rate}%` : "-"} color="var(--late)" />
      </div>

      {/* DS15/DS1 (EMPMAST.GROUPCODE 860/861) disabled for now, per request -
          was `scope?.location === "RND"` (see import_employee_roster.py -
          they only ever exist at RND, so this section and the Block filter
          beside the tabs below were RND-only noise everywhere else). */}
      {false && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-[color:var(--text-primary)]">Headcount by block</h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <BlockHeadcountCard blockKey="DS15" data={blockHeadcounts?.DS15} />
            <BlockHeadcountCard blockKey="DS1" data={blockHeadcounts?.DS1} />
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 shadow-[var(--shadow)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[color:var(--text-primary)]">Attrition rate snapshots</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-[color:var(--border)] p-0.5">
              {TABS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGranularity(g.key)}
                  className="rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors"
                  style={{
                    background: granularity === g.key ? "var(--accent-2)" : "transparent",
                    color: granularity === g.key ? "#fff" : "var(--text-secondary)",
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {granularity === "range" && scope?.start && scope?.end && (
              <DownloadCsvButton
                href={headcountCsvUrl({
                  start: scope.start,
                  end: scope.end,
                  location: scope.location,
                  department: scope.department,
                  block: scope.block,
                })}
              />
            )}
            {granularity !== "range" && trendPeriods && trendPeriods.length > 0 && (
              <DownloadCsvButton href={attritionTrendsCsvUrl(trendParams(granularity))} />
            )}
          </div>
        </div>

        {granularity === "range" ? (
          <DateRangeDrilldown
            // Remounts (resetting all its internal expand/cache state)
            // whenever the actual scope changes - without this, switching
            // from one date range to another left the previous range's
            // already-expanded weekly/daily breakdown sitting in state,
            // showing stale rows under the new (correct) whole-range total.
            key={`${scope?.start}|${scope?.end}|${scope?.location}|${scope?.department}|${scope?.block}`}
            scope={scope}
            headcount={headcount}
          />
        ) : (
          <>
            {trendError && <p className="text-xs font-medium text-[color:var(--late)]">{trendError}</p>}
            {!trendError && trendLoading && <p className="text-sm text-[color:var(--text-muted)]">Loading&hellip;</p>}
            {!trendError && !trendLoading && trendPeriods && trendPeriods.length > 0 && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
                <AttritionTrendChart periods={trendPeriods} exportFilename={`attrition_trend_${granularity}_${scope?.end ?? ""}`} />
                <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
                  <table className="w-full min-w-[420px] border-collapse text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-[color:var(--border)] text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                        <th className="px-3 py-1.5 font-medium">Period</th>
                        <th className="px-3 py-1.5 font-medium">Opening headcount</th>
                        <th className="px-3 py-1.5 font-medium">Exits</th>
                        <th className="px-3 py-1.5 font-medium">Joins</th>
                        <th className="px-3 py-1.5 font-medium">Closing headcount</th>
                        <th className="px-3 py-1.5 font-medium">Attrition rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendPeriods.map((p) => (
                        <tr key={p.period} className="border-b border-[color:var(--border)] last:border-0">
                          <td className="px-3 py-1.5 align-top tabular">{formatPeriodLabel(p.period)}</td>
                          <td className="px-3 py-1.5 align-top tabular">{compactNumber(p.headcount_start)}</td>
                          <td className="px-3 py-1.5 align-top tabular">{compactNumber(p.exits)}</td>
                          <td className="px-3 py-1.5 align-top tabular">{compactNumber(p.joins)}</td>
                          <td className="px-3 py-1.5 align-top tabular">{compactNumber(p.headcount_end)}</td>
                          <td className="px-3 py-1.5 align-top tabular font-medium" style={{ color: "var(--late)" }}>
                            {p.attrition_rate}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {!trendError && !trendLoading && trendPeriods && trendPeriods.length === 0 && (
              <p className="text-sm text-[color:var(--text-muted)]">No data for this range.</p>
            )}
          </>
        )}
      </div>

      {drilldown && (
        <div ref={drilldownRef} className="scroll-mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
            {drilldown === "exits" ? "Employees who exited in range" : "Employees who joined in range"}
          </div>
          <RosterDrilldownTable kind={drilldown} scope={scope} onLoaded={scrollDrilldownIntoView} />
        </div>
      )}

      {(employeeSearchError || employeeResults) && (
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
            Employee lookup &mdash; joining &amp; exit date
          </div>
          {employeeSearchError && <p className="text-xs font-medium text-[color:var(--late)]">{employeeSearchError}</p>}
          {employeeResults && <EmployeeTable rows={employeeResults} />}
        </div>
      )}
    </div>
  );
}
