import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getOutliers } from "../lib/api";

// Code-split - the (sizeable) table/column-filter UI is only ever needed once
// the accordion is opened, so its JS doesn't load with the rest of the app.
const OutliersTable = lazy(() => import("./OutliersTable"));

const PAGE_SIZE = 15;

const EMPTY_FILTERS = { date: "", employee: "", department: "", location: "", assigned: "", camein: "", clockin: "", flag: "" };

// Collapsed by default - the outliers query (a full scan over the whole
// selected range) only runs once this is actually opened, not on every
// filter change like the rest of the dashboard. Re-fetches while open if
// filters/page change, same as any other panel.
export default function OutliersAccordion({ filters, page, onPageChange, searchTerm, combosEmpty, onExport }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [colFilters, setColFilters] = useState(EMPTY_FILTERS);
  const filtersActive = Object.values(colFilters).some(Boolean);
  const [sort, setSort] = useState({ by: "date", dir: "desc" });
  const onSort = (by) => {
    setSort((s) => (s.by === by ? { by, dir: s.dir === "asc" ? "desc" : "asc" } : { by, dir: "asc" }));
    onPageChange(1);
  };
  const containerRef = useRef(null);
  const didAutoScrollRef = useRef(false);

  // The Employee column filter searches the whole result set server-side
  // (like the main FiltersBar search), not just the currently loaded page -
  // every other column filter stays a page-local quick-filter. Debounced so
  // typing doesn't fire a query per keystroke.
  const [employeeSearch, setEmployeeSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setEmployeeSearch(colFilters.employee.trim()), 400);
    return () => clearTimeout(t);
  }, [colFilters.employee]);
  const prevEmployeeSearchRef = useRef(employeeSearch);
  useEffect(() => {
    if (employeeSearch !== prevEmployeeSearchRef.current) {
      prevEmployeeSearchRef.current = employeeSearch;
      onPageChange(1);
    }
  }, [employeeSearch, onPageChange]);

  // Reset the one-time auto-scroll whenever the accordion is closed, so
  // re-opening it scrolls into view again instead of only on first use.
  useEffect(() => {
    if (!open) didAutoScrollRef.current = false;
  }, [open]);

  // A search with no Extension Pattern matches might still be a real
  // outlier day for that employee - auto-unfurl so they don't have to go
  // find the toggle themselves. Server-side search already scopes the whole
  // result set to the term, so page 1 (where this lands - the page/scroll
  // resets below) already *is* their first matching instance, sorted most
  // recent first. Keyed on searchTerm (not just the boolean) so searching a
  // second, different zero-match name re-opens it even if the user had
  // manually closed it after the first.
  useEffect(() => {
    if (searchTerm?.trim() && combosEmpty) {
      setOpen(true);
      onPageChange(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, combosEmpty]);

  // Once the first load after opening finishes, smoothly bring the unfurled
  // table into view - full-size charts stay above, untouched; this just
  // scrolls the page down to the table instead of squeezing everything onto
  // one screen. The user can always scroll back up to the charts afterwards.
  useEffect(() => {
    if (open && !loading && data && !didAutoScrollRef.current) {
      didAutoScrollRef.current = true;
      requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [open, loading, data]);

  useEffect(() => {
    if (!open || !filters) return;
    let cancelled = false;
    setLoading(true);
    getOutliers({
      start: filters.start,
      end: filters.end,
      location: filters.location,
      department: filters.department,
      flag: filters.flag,
      search: employeeSearch || filters.search,
      page,
      page_size: PAGE_SIZE,
      sort: sort.by,
      dir: sort.dir,
    })
      .then((d) => !cancelled && setData(d))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filters?.start, filters?.end, filters?.location, filters?.department, filters?.flag, filters?.search, employeeSearch, page, sort.by, sort.dir]);

  return (
    <div
      ref={containerRef}
      className="mx-5 mb-3 flex-none overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-[var(--shadow)] scroll-mt-5"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-2.5 text-left"
      >
        <h2 className="text-sm font-bold text-[color:var(--heading)]">Outliers</h2>
        <div className="flex flex-none items-center gap-3">
          {open && data && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFilters((s) => !s);
                }}
                className="flex items-center justify-center rounded-lg border p-1.5 transition-colors"
                style={{
                  borderColor: showFilters || filtersActive ? "var(--accent)" : "var(--border-strong)",
                  color: showFilters || filtersActive ? "var(--accent)" : "var(--text-secondary)",
                }}
                title="Filter columns"
              >
                <FilterIcon />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExport();
                }}
                className="flex items-center justify-center rounded-lg border border-[color:var(--border-strong)] p-1.5 text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                title="Download CSV"
              >
                <DownloadIcon />
              </button>
            </>
          )}
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 flex-none text-[color:var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>
      {open && (
        <div className="animate-accordion-in border-t border-[color:var(--border)] px-5 py-4">
          {loading && !data ? (
            <div className="flex items-center gap-2 py-3 text-sm text-[color:var(--text-muted)]">
              <span
                className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-[color:var(--accent)]"
                style={{ borderTopColor: "transparent" }}
              />
              Running query over {filters.start}&ndash;{filters.end}&hellip;
            </div>
          ) : (
            <Suspense fallback={null}>
              <OutliersTable
                data={data}
                page={page}
                pageSize={PAGE_SIZE}
                onPageChange={onPageChange}
                showFilters={showFilters}
                colFilters={colFilters}
                setColFilters={setColFilters}
                sort={sort}
                onSort={onSort}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
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

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19.5h16" />
    </svg>
  );
}
