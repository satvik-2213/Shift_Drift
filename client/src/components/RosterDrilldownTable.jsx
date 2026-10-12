import { useEffect, useMemo, useState } from "react";
import { formatDateDMY } from "../lib/format";
import { getHeadcountExits, getHeadcountJoins } from "../lib/api";

const PAGE_SIZE = 15;
const EMPTY_FILTERS = { designation: "", location: "", dateJoined: "", dateExited: "", status: "" };

// Exits/Joins drill-down behind the Workforce KPI tiles - same shape as
// OutliersTable/OutliersAccordion: server-side pagination + sort (so paging
// and ordering stay correct over the whole filtered result set, not just
// whatever page happens to be loaded) plus an employee search that scopes
// the whole result set, and page-local quick filters for the rest.
export default function RosterDrilldownTable({ kind, scope, onLoaded }) {
  const defaultSort = kind === "exits" ? "date_exited" : "date_joined";
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ by: defaultSort, dir: "desc" });
  const [showFilters, setShowFilters] = useState(false);
  const [colFilters, setColFilters] = useState(EMPTY_FILTERS);
  const [employeeSearchInput, setEmployeeSearchInput] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Switching between Exits/Joins should start each on its own natural sort,
  // not carry over whichever column the other was last sorted by.
  useEffect(() => {
    setSort({ by: defaultSort, dir: "desc" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    const t = setTimeout(() => setEmployeeSearch(employeeSearchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [employeeSearchInput]);

  useEffect(() => {
    setPage(1);
  }, [kind, scope?.start, scope?.end, scope?.location, scope?.department, scope?.block, employeeSearch, sort.by, sort.dir]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetcher = kind === "exits" ? getHeadcountExits : getHeadcountJoins;
    fetcher({
      start: scope.start,
      end: scope.end,
      location: scope.location,
      department: scope.department,
      block: scope.block,
      search: employeeSearch,
      page,
      page_size: PAGE_SIZE,
      sort: sort.by,
      dir: sort.dir,
    })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          // Fires once real rows are in the DOM (and the panel has its real
          // height), not when the panel first opens - scrolling right on
          // open targeted an empty/near-empty container, since this fetch
          // hadn't resolved yet.
          onLoaded?.();
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, scope?.start, scope?.end, scope?.location, scope?.department, scope?.block, employeeSearch, page, sort.by, sort.dir]);

  const onSort = (by) => {
    setSort((s) => (s.by === by ? { by, dir: s.dir === "asc" ? "desc" : "asc" } : { by, dir: "asc" }));
  };
  const setCol = (key) => (e) => setColFilters((f) => ({ ...f, [key]: e.target.value }));

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const f = colFilters;
    const active = Object.values(f).some(Boolean);
    if (!active) return data.rows;
    return data.rows.filter((r) => {
      const status = r.date_exited ? "Exited" : "Active";
      return (
        (!f.designation || (r.designation || "").toLowerCase().includes(f.designation.toLowerCase())) &&
        (!f.location || String(r.location_id || "").toLowerCase().includes(f.location.toLowerCase())) &&
        (!f.dateJoined || (r.date_joined && formatDateDMY(r.date_joined).toLowerCase().includes(f.dateJoined.toLowerCase()))) &&
        (!f.dateExited || (r.date_exited && formatDateDMY(r.date_exited).toLowerCase().includes(f.dateExited.toLowerCase()))) &&
        (!f.status || status === f.status)
      );
    });
  }, [data, colFilters]);

  if (!data) {
    return loading ? <p className="mt-3 text-sm text-[color:var(--text-muted)]">Loading&hellip;</p> : null;
  }

  const rows = filteredRows;
  const filtered = rows.length !== data.rows.length;
  const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <input
          type="search"
          placeholder="Search all pages (name or ID)"
          value={employeeSearchInput}
          onChange={(e) => setEmployeeSearchInput(e.target.value)}
          className="w-56 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-2 py-1 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
        />
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
      </div>
      <div className="max-h-[520px] overflow-auto rounded-xl border border-[color:var(--border)]">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 border-b border-[color:var(--border)] bg-[color:var(--bg-surface)] text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <SortTh sortKey="employee" sort={sort} onSort={onSort}>
                Employee
              </SortTh>
              <SortTh sortKey="designation" sort={sort} onSort={onSort}>
                Designation
              </SortTh>
              <SortTh sortKey="location" sort={sort} onSort={onSort}>
                Location
              </SortTh>
              <SortTh sortKey="date_joined" sort={sort} onSort={onSort}>
                Date joined
              </SortTh>
              <SortTh sortKey="date_exited" sort={sort} onSort={onSort}>
                Date exited
              </SortTh>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
            {showFilters && (
              <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-surface-2)]">
                <th />
                <Fth value={colFilters.designation} onChange={setCol("designation")} />
                <Fth value={colFilters.location} onChange={setCol("location")} />
                <Fth value={colFilters.dateJoined} onChange={setCol("dateJoined")} />
                <Fth value={colFilters.dateExited} onChange={setCol("dateExited")} />
                <th className="px-3 py-1.5 font-normal">
                  <select value={colFilters.status} onChange={setCol("status")} className={selectClass}>
                    <option value="">All</option>
                    <option value="Active">Active</option>
                    <option value="Exited">Exited</option>
                  </select>
                </th>
              </tr>
            )}
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
                  {filtered ? "No rows on this page match the column filters." : "No employees here."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-[color:var(--text-muted)]">
        <span>
          {data.total.toLocaleString()} total
          {filtered && ` · column filters apply to this page only (${rows.length}/${data.rows.length} shown)`}
        </span>
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

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="17" x2="14" y2="17" />
    </svg>
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
