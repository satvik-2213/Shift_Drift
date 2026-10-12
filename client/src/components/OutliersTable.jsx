import { useMemo } from "react";
import { minutesToClock, formatDateDMY } from "../lib/format";

const FLAG_COLOR = { Early: "var(--early)", "On-time": "var(--ontime)", Late: "var(--late)" };

// Mirrors SHIFT_CODE_TO_BUCKET in server/shift_rules.py, inverted - so "Came
// in as" reads in the same shift-code format as "Assigned" (BS, not just B),
// instead of mixing a bucket name in one column with a code in the other.
// A time outside every bucket has no code to fall back to.
const BUCKET_TO_CODE = { General: "GS", A: "AS", B: "BS", C: "CS" };

// GS displayed as "Gen" in both shift columns - easier to tell apart from CS
// at a glance than two codes both ending in S.
const CODE_LABEL = { GS: "Gen" };
const shiftLabel = (code) => CODE_LABEL[code] ?? code;
const SHIFT_CODES = ["GS", "AS", "BS", "CS"];

function ShiftPill({ children, title }) {
  return (
    <span
      className="inline-block rounded-md bg-[color:var(--bg-surface-2)] px-2 py-0.5 text-xs font-medium text-[color:var(--text-secondary)]"
      title={title}
    >
      {children}
    </span>
  );
}

export default function OutliersTable({ data, page, pageSize, onPageChange, showFilters, colFilters, setColFilters, sort, onSort }) {
  const setCol = (key) => (e) => setColFilters((f) => ({ ...f, [key]: e.target.value }));

  const departmentOptions = useMemo(() => {
    if (!data) return [];
    const seen = new Map();
    data.rows.forEach((r) => {
      if (r.department && !seen.has(r.department)) seen.set(r.department, r.department_name || r.department);
    });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const f = colFilters;
    const active = Object.values(f).some(Boolean);
    if (!active) return data.rows;
    return data.rows.filter((r) => {
      const camein = BUCKET_TO_CODE[r.derived_bucket] ?? r.derived_bucket ?? "";
      return (
        (!f.date || formatDateDMY(r.date).toLowerCase().includes(f.date.toLowerCase())) &&
        (!f.employee || `${r.emp_name || ""} ${r.emp_id || ""} ${r.designation || ""}`.toLowerCase().includes(f.employee.toLowerCase())) &&
        (!f.department || r.department === f.department) &&
        (!f.location || String(r.location_id || "").toLowerCase().includes(f.location.toLowerCase())) &&
        (!f.assigned || r.shift_code === f.assigned) &&
        (!f.camein || camein === f.camein) &&
        (!f.clockin || minutesToClock(r.first_in_min).toLowerCase().includes(f.clockin.toLowerCase())) &&
        (!f.flag || r.flag === f.flag)
      );
    });
  }, [data, colFilters]);

  if (!data) return null;
  const { total } = data;
  const rows = filteredRows;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const filtered = rows.length !== data.rows.length;

  return (
    <div>
      {/* No height cap - the whole table (all PAGE_SIZE rows) renders at its
          natural height so opening Outliers reveals it in full by scrolling
          the page down to it, not by scrolling inside a clipped box. */}
      <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[22%]" />
            <col className="w-[16%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 border-b border-[color:var(--border)] bg-[color:var(--bg-surface)] text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <SortTh sortKey="date" sort={sort} onSort={onSort}>Date</SortTh>
              <SortTh sortKey="employee" sort={sort} onSort={onSort}>Employee</SortTh>
              <SortTh sortKey="department" sort={sort} onSort={onSort}>Department</SortTh>
              <SortTh sortKey="location" sort={sort} onSort={onSort}>Location</SortTh>
              <SortTh sortKey="assigned" sort={sort} onSort={onSort}>Assigned</SortTh>
              <SortTh sortKey="camein" sort={sort} onSort={onSort}>Came in as</SortTh>
              <SortTh sortKey="clockin" sort={sort} onSort={onSort}>Clock-in</SortTh>
              <SortTh sortKey="flag" sort={sort} onSort={onSort}>Flag</SortTh>
            </tr>
            {showFilters && (
              <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-surface-2)]">
                <Fth value={colFilters.date} onChange={setCol("date")} placeholder="Filter" />
                <Fth value={colFilters.employee} onChange={setCol("employee")} placeholder="Search all pages" />
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
                <Fth value={colFilters.location} onChange={setCol("location")} placeholder="Filter" />
                <th className="px-3 py-1.5 font-normal">
                  <select value={colFilters.assigned} onChange={setCol("assigned")} className={selectClass}>
                    <option value="">All</option>
                    {SHIFT_CODES.map((c) => (
                      <option key={c} value={c}>
                        {shiftLabel(c)}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="px-3 py-1.5 font-normal">
                  <select value={colFilters.camein} onChange={setCol("camein")} className={selectClass}>
                    <option value="">All</option>
                    {SHIFT_CODES.map((c) => (
                      <option key={c} value={c}>
                        {shiftLabel(c)}
                      </option>
                    ))}
                  </select>
                </th>
                <Fth value={colFilters.clockin} onChange={setCol("clockin")} placeholder="Filter" />
                <th className="px-3 py-1.5 font-normal">
                  <select value={colFilters.flag} onChange={setCol("flag")} className={selectClass}>
                    <option value="">All</option>
                    <option value="Early">Early</option>
                    <option value="On-time">On-time</option>
                    <option value="Late">Late</option>
                  </select>
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.emp_id}-${r.date}`} className="border-b border-[color:var(--border)] last:border-0">
                <Td className="tabular">{formatDateDMY(r.date)}</Td>
                <Td>
                  <div className="font-medium text-[color:var(--text-primary)]">{r.emp_name || r.emp_id}</div>
                  <div className="text-xs text-[color:var(--text-muted)]">
                    {r.emp_id} &middot; {r.designation}
                  </div>
                </Td>
                <Td>
                  <div className="text-[color:var(--text-primary)]">{r.department_name || r.department}</div>
                </Td>
                <Td>{r.location_id}</Td>
                <Td>
                  <ShiftPill>{shiftLabel(r.shift_code)}</ShiftPill>
                </Td>
                <Td>
                  <ShiftPill
                    title={r.derived_bucket && r.derived_bucket !== r.assigned_bucket ? "Clocked in during a different shift's window" : undefined}
                  >
                    {shiftLabel(BUCKET_TO_CODE[r.derived_bucket] ?? r.derived_bucket)}
                  </ShiftPill>
                </Td>
                <Td className="tabular">{minutesToClock(r.first_in_min)}</Td>
                <Td>
                  <span className="font-semibold" style={{ color: FLAG_COLOR[r.flag] ?? "var(--text-primary)" }}>
                    {r.flag}
                  </span>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[color:var(--text-muted)]">
                  {filtered ? "No rows on this page match the column filters." : "No rows in range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-[color:var(--text-muted)]">
        <span>
          {total.toLocaleString()} total rows
          {filtered && ` · column filters apply to this page only (${rows.length}/${data.rows.length} shown)`}
        </span>
        <div className="flex items-center gap-2">
          <PageBtn disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Prev
          </PageBtn>
          <span>
            Page {page} / {lastPage}
          </span>
          <PageBtn disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>
            Next
          </PageBtn>
        </div>
      </div>
    </div>
  );
}

const selectClass =
  "w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-1.5 py-1 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]";

function SortTh({ children, sortKey, sort, onSort }) {
  const active = sort?.by === sortKey;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-[color:var(--text-primary)]"
        style={{ color: active ? "var(--accent)" : "inherit" }}
      >
        {children}
        <span className="text-[9px]" aria-hidden="true">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}
function Fth({ value, onChange, placeholder }) {
  return (
    <th className="px-3 py-1.5 font-normal">
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-1.5 py-1 text-xs normal-case tracking-normal text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
      />
    </th>
  );
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
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
