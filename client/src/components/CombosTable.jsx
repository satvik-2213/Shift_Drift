import { useEffect, useMemo, useState } from "react";
import { minutesToClock, formatDateDMY, WEEKDAY_FULL_NAMES } from "../lib/format";
import { getCombos } from "../lib/api";

// Mirrors BUCKET_RANGE in server/shift_rules.py - shown as a hover hint only,
// not used for any calculation (the server already classified every row).
const BUCKET_WINDOWS = {
  A: "05:30–07:30",
  General: "07:31–12:00",
  B: "12:01–19:00",
  C: "19:01–23:00",
};
const SHIFT_CODES = ["AS", "GS", "BS", "CS"];

function ShiftBadge({ code, bucket }) {
  if (!code) return <span className="text-[color:var(--text-muted)]">&ndash;</span>;
  const window = BUCKET_WINDOWS[bucket];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-[color:var(--bg-surface-2)] px-2 py-0.5 text-xs font-medium text-[color:var(--text-secondary)]"
      title={window ? `Assigned shift ${bucket}: ${window}` : undefined}
    >
      {code}
    </span>
  );
}

const MATCH_LABELS = { both: "Both days", day1_only: "Day 1 only", day2_only: "Day 2 only" };
const MATCH_COLORS = { both: "var(--accent)", day1_only: "var(--early)", day2_only: "var(--late)" };

function MatchBadge({ match }) {
  const color = MATCH_COLORS[match] ?? "var(--text-secondary)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: color }} />
      {MATCH_LABELS[match] ?? match}
    </span>
  );
}

const EMPTY_FILTERS = { employee: "", department: "", match: "", day1: "", day2: "", day1Shift: "", day2Shift: "", minOccurrences: "" };

// Fixed page size - the table body always renders this many row slots (padded
// with blanks when a page is short) so its height never shifts with the data,
// since the charts beside it share the same grid row height.
const PAGE_SIZE = 8;

export default function CombosTable({ data, filters, mode, onModeChange, onExport, className = "", focusRepeatOffenders = 0 }) {
  const [showFilters, setShowFilters] = useState(true);
  const [colFilters, setColFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const setCol = (key) => (e) => {
    setPage(1);
    setColFilters((f) => ({ ...f, [key]: e.target.value }));
  };

  // Driven by the "Repeat offenders" KPI tile (StatTiles) - a sibling, not a
  // parent/child, so it reaches this filter via a bumped counter prop rather
  // than local state: applies the same 3+ threshold the tile itself counts,
  // reveals the filter row so it's obvious why the table narrowed, and jumps
  // back to page 1 since the previous page may no longer exist.
  useEffect(() => {
    if (focusRepeatOffenders === 0) return;
    setShowFilters(true);
    setPage(1);
    setColFilters((f) => ({ ...f, minOccurrences: "3" }));
  }, [focusRepeatOffenders]);

  // Either-day is opt-in and fetched lazily, like the Outliers accordion -
  // "both" mode (the default, used for the stat tile and the headline CSV
  // export) stays on the data the parent already fetches on every search,
  // so switching the toggle on doesn't cost anything until someone actually
  // asks for it.
  const [eitherData, setEitherData] = useState(null);
  const [eitherLoading, setEitherLoading] = useState(false);
  useEffect(() => {
    if (mode !== "either" || !filters) return;
    let cancelled = false;
    setEitherLoading(true);
    getCombos({
      start: filters.start,
      end: filters.end,
      location: filters.location,
      department: filters.department,
      early_weekday: filters.earlyDay,
      late_weekday: filters.lateDay,
      search: filters.search,
      mode: "either",
    })
      .then((d) => !cancelled && setEitherData(d))
      .finally(() => !cancelled && setEitherLoading(false));
    return () => {
      cancelled = true;
    };
  }, [mode, filters?.start, filters?.end, filters?.location, filters?.department, filters?.earlyDay, filters?.lateDay, filters?.search]);

  const activeData = mode === "either" ? eitherData : data;

  const departmentOptions = useMemo(() => {
    if (!activeData) return [];
    const seen = new Map();
    activeData.combos.forEach((c) => {
      const anchor = c.day1 ?? c.day2;
      if (anchor.department && !seen.has(anchor.department)) seen.set(anchor.department, anchor.department_name || anchor.department);
    });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [activeData]);

  const filteredCombos = useMemo(() => {
    if (!activeData) return [];
    const f = colFilters;
    const active = Object.values(f).some(Boolean);
    if (!active) return activeData.combos;
    return activeData.combos.filter((c) => {
      const anchor = c.day1 ?? c.day2;
      return (
        (!f.employee || `${anchor.emp_name || ""} ${anchor.emp_id || ""}`.toLowerCase().includes(f.employee.toLowerCase())) &&
        (!f.department || anchor.department === f.department) &&
        (mode !== "either" || !f.match || c.match === f.match) &&
        (!f.day1 || (c.day1 && formatDateDMY(c.day1.date).toLowerCase().includes(f.day1.toLowerCase()))) &&
        (!f.day2 || (c.day2 && formatDateDMY(c.day2.date).toLowerCase().includes(f.day2.toLowerCase()))) &&
        (!f.day1Shift || c.day1?.shift_code === f.day1Shift) &&
        (!f.day2Shift || c.day2?.shift_code === f.day2Shift) &&
        (!f.minOccurrences || c.pair_count >= Number(f.minOccurrences))
      );
    });
  }, [activeData, colFilters, mode]);

  // One row per employee, not one row per occurrence - with a repeat offender
  // showing a dozen+ occurrences, a flat list let a single person fill an
  // entire page (or, in Either-day mode, dozens of pages) before any other
  // employee's row appeared at all. Sorted worst-first (highest pair_count)
  // since that's what "who does this the most" actually wants to surface.
  // Each group expands in place to the individual Friday/Monday rows behind
  // its count, same expand-to-detail pattern as the Date Range drilldown.
  const groupedEmployees = useMemo(() => {
    const byEmployee = new Map();
    for (const c of filteredCombos) {
      const anchor = c.day1 ?? c.day2;
      let group = byEmployee.get(anchor.emp_id);
      if (!group) {
        group = {
          emp_id: anchor.emp_id,
          emp_name: anchor.emp_name,
          department: anchor.department,
          department_name: anchor.department_name,
          total: c.pair_count,
          rows: [],
        };
        byEmployee.set(anchor.emp_id, group);
      }
      group.rows.push(c);
    }
    return [...byEmployee.values()].sort((a, b) => b.total - a.total || (a.emp_name || "").localeCompare(b.emp_name || ""));
  }, [filteredCombos]);

  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const toggleExpanded = (empId) =>
    setExpandedIds((s) => {
      const next = new Set(s);
      if (next.has(empId)) next.delete(empId);
      else next.add(empId);
      return next;
    });

  useEffect(() => setPage(1), [activeData]);

  if (!data) return null;
  const combos = filteredCombos;
  const filtered = activeData && combos.length !== activeData.combos.length;
  const lastPage = Math.max(1, Math.ceil(groupedEmployees.length / PAGE_SIZE));
  const pageGroups = groupedEmployees.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const fillerRows = Math.max(0, PAGE_SIZE - pageGroups.length);
  // When there's nothing to show, the message sits in the *middle* filler
  // slot (blank rows above and below) instead of the top, so it reads as a
  // deliberately centered empty state rather than a message floating above
  // a wall of dead rows - while the row *count* stays PAGE_SIZE either way,
  // so the charts beside this table never resize based on whether there's data.
  const emptyMessageSlot = Math.floor(PAGE_SIZE / 2);
  const colCount = mode === "either" ? 10 : 9;
  const day1Name = WEEKDAY_FULL_NAMES[data.early_weekday] ?? "Day 1";
  const day2Name = WEEKDAY_FULL_NAMES[data.late_weekday] ?? "Day 2";
  const title = data.early_weekday === 5 && data.late_weekday === 1 ? "Extension Pattern" : `${day1Name} → ${day2Name} Pattern`;

  return (
    <div
      className={`flex flex-col rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-[var(--shadow)] ${className}`}
    >
      <div className="flex flex-none items-center justify-between gap-2 px-5 pt-3 pb-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-bold text-[color:var(--heading)]">{title}</h2>
          {/* Flag counts live right beside the title, not buried in the footer
              below a full page of rows - the whole point is seeing at a
              glance how many flags there are without scrolling down to find out. */}
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[color:var(--text-muted)]">
            {mode === "either" ? (
              eitherLoading && !eitherData ? (
                "Loading…"
              ) : (
                <>
                  <span>{(activeData?.total ?? 0).toLocaleString()} total</span>
                  <span style={{ color: "var(--accent)" }}>{activeData?.both_count ?? 0} both</span>
                  <span style={{ color: "var(--early)" }}>{activeData?.day1_only_count ?? 0} {day1Name}-only</span>
                  <span style={{ color: "var(--late)" }}>{activeData?.day2_only_count ?? 0} {day2Name}-only</span>
                </>
              )
            ) : (
              <span>{(activeData?.total ?? 0).toLocaleString()} total flags</span>
            )}
            {filtered && <span>&middot; {combos.length} shown (filtered)</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-[color:var(--border-strong)] p-0.5" title="Both days requires the full pattern; Either day also shows one-sided matches">
            <button
              type="button"
              onClick={() => onModeChange("both")}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                background: mode === "both" ? "var(--accent)" : "transparent",
                color: mode === "both" ? "var(--accent-ink)" : "var(--text-secondary)",
              }}
            >
              Both days
            </button>
            <button
              type="button"
              onClick={() => onModeChange("either")}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                background: mode === "either" ? "var(--accent)" : "transparent",
                color: mode === "either" ? "var(--accent-ink)" : "var(--text-secondary)",
              }}
            >
              Either day
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="flex items-center justify-center rounded-lg border p-1.5 transition-colors"
            style={{
              borderColor: showFilters ? "var(--accent)" : "var(--border-strong)",
              color: showFilters ? "var(--accent)" : "var(--text-secondary)",
            }}
            title="Filter columns"
          >
            <FilterIcon />
          </button>
          <button
            type="button"
            onClick={onExport}
            className="flex items-center justify-center rounded-lg border border-[color:var(--border-strong)] p-1.5 text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            title="Download CSV"
          >
            <DownloadIcon />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto px-5">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[color:var(--border)] text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <Th>Employee</Th>
              <Th>Department</Th>
              {mode === "either" && <Th>Match</Th>}
              <Th>{day1Name}</Th>
              <Th>Clock-In</Th>
              <Th>Assigned Shift</Th>
              <Th>{day2Name}</Th>
              <Th>Clock-In</Th>
              <Th>Assigned Shift</Th>
              <Th title="Total times this employee shows this pattern across the selected range - the same number on every one of their rows below, not specific to a single date pair">
                Total occurrences
              </Th>
            </tr>
            {/* Always mounted (space reserved either way), just toggled invisible -
                a conditionally-*mounted* row changes the table's row count, which
                changes this card's height, which (CSS Grid stretches both dashboard
                columns to the row's tallest item) resizes the charts beside it. */}
            <tr className={`border-b border-[color:var(--border)] bg-[color:var(--bg-surface-2)] ${showFilters ? "" : "invisible"}`}>
              <Fth value={colFilters.employee} onChange={setCol("employee")} />
              <th className="px-3 py-1.5 font-normal">
                <select value={colFilters.department} onChange={setCol("department")} className={selectClass}>
                  <option value="">All</option>
                  {departmentOptions.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </th>
              {mode === "either" && (
                <th className="px-3 py-1.5 font-normal">
                  <select value={colFilters.match} onChange={setCol("match")} className={selectClass}>
                    <option value="">All</option>
                    <option value="both">Both days</option>
                    <option value="day1_only">Day 1 only</option>
                    <option value="day2_only">Day 2 only</option>
                  </select>
                </th>
              )}
              <Fth value={colFilters.day1} onChange={setCol("day1")} />
              <th />
              <th className="px-3 py-1.5 font-normal">
                <select value={colFilters.day1Shift} onChange={setCol("day1Shift")} className={selectClass}>
                  <option value="">All</option>
                  {SHIFT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </th>
              <Fth value={colFilters.day2} onChange={setCol("day2")} />
              <th />
              <th className="px-3 py-1.5 font-normal">
                <select value={colFilters.day2Shift} onChange={setCol("day2Shift")} className={selectClass}>
                  <option value="">All</option>
                  {SHIFT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-1.5 font-normal">
                <input
                  type="number"
                  min="1"
                  value={colFilters.minOccurrences}
                  onChange={setCol("minOccurrences")}
                  placeholder="Min"
                  className="w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-1.5 py-1 text-xs normal-case tracking-normal text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {pageGroups.map((group) => (
              <EmployeeGroup
                key={group.emp_id}
                group={group}
                mode={mode}
                expanded={expandedIds.has(group.emp_id)}
                onToggle={() => toggleExpanded(group.emp_id)}
              />
            ))}
            {pageGroups.length === 0 &&
              Array.from({ length: PAGE_SIZE }).map((_, i) =>
                i === emptyMessageSlot ? (
                  <tr key="empty-message">
                    <td colSpan={colCount} className="px-3 py-1.5 text-center text-[color:var(--text-muted)]">
                      {mode === "either" && eitherLoading && !eitherData
                        ? "Loading…"
                        : filtered
                          ? "No rows match the column filters."
                          : mode === "either"
                            ? `No ${day1Name}/${day2Name} deviations found in range.`
                            : `No ${day1Name}/${day2Name} pattern found in range.`}
                    </td>
                  </tr>
                ) : (
                  <tr key={`empty-filler-${i}`}>
                    <td colSpan={colCount} className="px-3 py-1.5">
                      &nbsp;
                    </td>
                  </tr>
                )
              )}
            {/* Blank filler rows keep every page the same height, since the charts
                beside this table share its grid row and shouldn't resize with it.
                No border - there's no real row here to separate from the next one,
                so a line would just be a stray divider under empty space. */}
            {pageGroups.length > 0 &&
              Array.from({ length: fillerRows }).map((_, i) => (
                <tr key={`filler-${i}`}>
                  <td colSpan={colCount} className="px-3 py-1.5">
                    &nbsp;
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-none items-center justify-end gap-3 px-5 pt-1.5 pb-3 text-xs text-[color:var(--text-muted)]">
        <div className="flex items-center gap-2">
          <PageBtn disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </PageBtn>
          <span>
            Page {page} / {lastPage}
          </span>
          <PageBtn disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Next
          </PageBtn>
        </div>
      </div>
    </div>
  );
}

const selectClass =
  "w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-1.5 py-1 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]";

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="17" x2="14" y2="17" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19.5h16" />
    </svg>
  );
}

function Th({ children, title }) {
  return (
    <th className="px-3 py-1.5 font-medium" title={title}>
      {children}
    </th>
  );
}
function Fth({ value, onChange }) {
  return (
    <th className="px-3 py-1.5 font-normal">
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder="Filter"
        className="w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-1.5 py-1 text-xs normal-case tracking-normal text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
      />
    </th>
  );
}
function Td({ children, className = "", style, colSpan }) {
  return (
    <td className={`px-3 py-1.5 align-top ${className}`} style={style} colSpan={colSpan}>
      {children}
    </td>
  );
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

function EmployeeGroup({ group, mode, expanded, onToggle }) {
  // A single occurrence has nothing to drill into - show it inline on the
  // employee's row instead of making them click through a "1 occurrence,
  // click to expand" summary to see the one row behind it.
  if (group.total === 1) {
    const c = group.rows[0];
    return (
      <tr className="border-b border-[color:var(--border)] hover:bg-[color:var(--bg-surface-2)]">
        <Td>
          <div className="font-medium text-[color:var(--text-primary)]">{group.emp_name || group.emp_id}</div>
          <div className="text-xs text-[color:var(--text-muted)]">{group.emp_id}</div>
        </Td>
        <Td>
          <div className="text-[color:var(--text-primary)]">{group.department_name || group.department}</div>
        </Td>
        {mode === "either" && (
          <Td>
            <MatchBadge match={c.match} />
          </Td>
        )}
        <DayCells c={c} />
        <Td className="tabular font-semibold">{group.total}</Td>
      </tr>
    );
  }

  return (
    <>
      <tr
        className="cursor-pointer border-b border-[color:var(--border)] hover:bg-[color:var(--bg-surface-2)]"
        onClick={onToggle}
      >
        <Td>
          <span className="flex items-center gap-1.5">
            <ChevronIcon expanded={expanded} />
            <span>
              <div className="font-medium text-[color:var(--text-primary)]">{group.emp_name || group.emp_id}</div>
              <div className="text-xs text-[color:var(--text-muted)]">{group.emp_id}</div>
            </span>
          </span>
        </Td>
        <Td>
          <div className="text-[color:var(--text-primary)]">{group.department_name || group.department}</div>
        </Td>
        {mode === "either" && <Td className="text-[color:var(--text-muted)]">&ndash;</Td>}
        <Td colSpan={6} className="text-[color:var(--text-muted)]">
          {group.total} occurrences this range &mdash; click to {expanded ? "collapse" : "expand"}
        </Td>
        <Td className="tabular font-semibold">{group.total}</Td>
      </tr>
      {expanded && group.rows.map((c) => <OccurrenceRow key={`${c.day1?.date ?? ""}-${c.day2?.date ?? ""}-${c.match ?? "both"}`} c={c} mode={mode} />)}
    </>
  );
}

function DayCells({ c }) {
  return (
    <>
      {c.day1 ? (
        <>
          <Td className="tabular">{formatDateDMY(c.day1.date)}</Td>
          <Td className="tabular" style={{ color: "var(--early)" }}>
            {minutesToClock(c.day1.first_in_min)}
          </Td>
          <Td>
            <ShiftBadge code={c.day1.shift_code} bucket={c.day1.assigned_bucket} />
          </Td>
        </>
      ) : (
        <>
          <Td className="text-[color:var(--text-muted)]">&ndash;</Td>
          <Td className="text-[color:var(--text-muted)]">&ndash;</Td>
          <Td className="text-[color:var(--text-muted)]">&ndash;</Td>
        </>
      )}
      {c.day2 ? (
        <>
          <Td className="tabular">{formatDateDMY(c.day2.date)}</Td>
          <Td className="tabular" style={{ color: "var(--late)" }}>
            {minutesToClock(c.day2.first_in_min)}
          </Td>
          <Td>
            <ShiftBadge code={c.day2.shift_code} bucket={c.day2.assigned_bucket} />
          </Td>
        </>
      ) : (
        <>
          <Td className="text-[color:var(--text-muted)]">&ndash;</Td>
          <Td className="text-[color:var(--text-muted)]">&ndash;</Td>
          <Td className="text-[color:var(--text-muted)]">&ndash;</Td>
        </>
      )}
    </>
  );
}

function OccurrenceRow({ c, mode }) {
  return (
    <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-surface-2)]">
      <Td />
      <Td />
      {mode === "either" && (
        <Td>
          <MatchBadge match={c.match} />
        </Td>
      )}
      <DayCells c={c} />
      <Td />
    </tr>
  );
}
function PageBtn({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-[color:var(--border-strong)] px-2 py-1 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
