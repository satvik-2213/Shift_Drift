import { useEffect, useState } from "react";
import Header from "./components/Header";
import FiltersBar from "./components/FiltersBar";
import StatTiles from "./components/StatTiles";
import WeekdayChart from "./components/WeekdayChart";
import DepartmentChart from "./components/DepartmentChart";
import OutliersAccordion from "./components/OutliersAccordion";
import CombosTable from "./components/CombosTable";
import LoadingOverlay from "./components/LoadingOverlay";
import Login from "./components/Login";
import WorkforcePanel from "./components/WorkforcePanel";
import {
  getMeta,
  getFilters,
  getCombos,
  getStats,
  getHeadcount,
  getSession,
  logout,
  outliersCsvUrl,
  combosCsvUrl,
  searchEmployees,
  ApiError,
} from "./lib/api";

function daysAgo(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// The same-length window immediately preceding [start, end], used so the KPI
// tiles can show a period-over-period delta without the user picking a
// comparison range themselves.
function previousPeriod(start, end) {
  const lengthMs = new Date(end) - new Date(start);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd.getTime() - lengthMs);
  return { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) };
}

export default function App() {
  const [authed, setAuthed] = useState(null); // null = checking, false = show login, true = show app
  // role/location come from /api/login and /api/session - a "employee"
  // session is pinned server-side to `location` for every query regardless
  // of what the client sends (see app.py's _effective_location), so the UI
  // just needs to reflect that lock, not enforce it itself.
  const [session, setSession] = useState({ role: null, location: null });
  const [tab, setTab] = useState("shift-drift");

  const [meta, setMeta] = useState(null);
  const [options, setOptions] = useState({ departments: [], locations: [] });
  const [filters, setFilters] = useState(null); // null until meta-derived defaults are ready
  const [page, setPage] = useState(1);

  const [stats, setStats] = useState(null);
  const [combos, setCombos] = useState(null);
  const [headcount, setHeadcount] = useState(null);
  const [prevHeadcount, setPrevHeadcount] = useState(null);
  // Headcount split by EMPMAST.GROUPCODE block (DS15/DS1), independent of
  // the block filter dropdown above - that dropdown scopes the trend chart
  // and exits/joins drilldown to one block at a time, but this tile row
  // always shows both side by side.
  const [blockHeadcounts, setBlockHeadcounts] = useState(null);
  const [error, setError] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [headcountLoading, setHeadcountLoading] = useState(false);
  // Scoped per tab, not just OR'd together - each tab only cares about its
  // own fetch. Letting either flag dim BOTH tabs was the original bug
  // (searching while on Attrition dimmed the whole page for a Shift Drift
  // fetch nobody could see); tying the fetch itself to the active tab was a
  // worse fix that made switching back to Shift Drift re-fetch from scratch
  // every time instead of showing the data already sitting in state.
  const loading = tab === "attrition" ? headcountLoading : dataLoading;

  // "Either day" is fetched lazily by CombosTable itself (see there) - this
  // just tracks which mode is active, so the CSV export can reflect it too.
  const [comboMode, setComboMode] = useState("both");
  // Bumped on every "Repeat offenders" tile click - CombosTable watches this
  // (not a boolean) so clicking it again while already filtered still
  // re-applies/re-reveals the filter instead of silently no-op'ing.
  const [repeatOffendersSignal, setRepeatOffendersSignal] = useState(0);

  // Employee lookup (Attrition tab) - lives here, not WorkforcePanel, so the
  // search box itself can sit in FiltersBar beside Location/Department while
  // the results table still renders inside the panel below.
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState("");
  const [employeeResults, setEmployeeResults] = useState(null);
  const [employeeSearching, setEmployeeSearching] = useState(false);
  const [employeeSearchError, setEmployeeSearchError] = useState(null);

  const runEmployeeSearch = async () => {
    if (!employeeSearchTerm.trim()) return;
    setEmployeeSearching(true);
    setEmployeeSearchError(null);
    try {
      const { rows } = await searchEmployees(employeeSearchTerm.trim());
      setEmployeeResults(rows);
    } catch (e) {
      setEmployeeSearchError(e instanceof ApiError ? e.message : "Search failed");
    } finally {
      setEmployeeSearching(false);
    }
  };

  // A restricted session's `location` from /api/login or /api/session is
  // always an array (one location is the common case, but a manager
  // covering several units gets several - see app.py's _effective_location,
  // which also does the real enforcement; this is only the UI's starting
  // point). One allowed location -> default straight to it (same as
  // before). More than one -> default to "" ("all of mine" - the server
  // falls back to the full allowed set for an empty/out-of-scope request),
  // letting FiltersBar's Location dropdown offer narrowing to just one.
  const defaultLocationFor = (role, locations) => {
    if (role !== "employee" || !locations) return "";
    return locations.length === 1 ? locations[0] : "";
  };

  const loadInitialData = async (role, locations) => {
    try {
      const [m, f] = await Promise.all([getMeta(), getFilters()]);
      setMeta(m);
      setOptions(f);
      const end = m.last_import_date ?? new Date().toISOString().slice(0, 10);
      const start = m.earliest_date && daysAgo(end, 7) < m.earliest_date ? m.earliest_date : daysAgo(end, 7);
      setFilters({
        start, end, location: defaultLocationFor(role, locations),
        department: "", block: "", flag: "", search: "", earlyDay: 5, lateDay: 1,
      });
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    (async () => {
      const { authenticated, role, location } = await getSession();
      setAuthed(authenticated);
      if (authenticated) {
        setSession({ role, location });
        await loadInitialData(role, location);
      }
    })();
  }, []);

  const handleLoggedIn = async ({ role, location }) => {
    setSession({ role, location });
    setAuthed(true);
    await loadInitialData(role, location);
  };

  const handleLogout = async () => {
    await logout();
    setAuthed(false);
    setSession({ role: null, location: null });
    setFilters(null);
    setMeta(null);
  };

  useEffect(() => {
    if (!filters) return;
    setPage(1);
  }, [
    filters?.start,
    filters?.end,
    filters?.location,
    filters?.department,
    filters?.flag,
    filters?.search,
    filters?.earlyDay,
    filters?.lateDay,
  ]);

  // Fetches on every filter change regardless of which tab is active - not
  // gated to "shift-drift" the way the headcount effect below is gated to
  // "attrition", because that gating previously made switching back to this
  // tab re-fetch from scratch every time (tab was a dependency, so merely
  // switching tabs re-ran the whole effect) instead of showing the data
  // already sitting in state. Fetching regardless of tab means it's also
  // already warm by the time someone switches back. The `loading` flag
  // above is what keeps this fetch from dimming the Attrition tab instead.
  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    setDataLoading(true);
    setError(null);
    const common = {
      start: filters.start,
      end: filters.end,
      location: filters.location,
      department: filters.department,
    };
    const comboDays = { early_weekday: filters.earlyDay, late_weekday: filters.lateDay };
    Promise.all([
      getStats({ ...common, ...comboDays }),
      getCombos({ ...common, ...comboDays, search: filters.search }),
    ])
      .then(([s, c]) => {
        if (cancelled) return;
        setStats(s);
        setCombos(c);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setDataLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.start, filters?.end, filters?.location, filters?.department, filters?.search, filters?.earlyDay, filters?.lateDay]);

  // Headcount/attrition is its own tab with its own "Search" affordance - no
  // reason to pay for exits/joins/headcount queries every time someone
  // searches the Shift Drift tab when they may never open Attrition Rates.
  // Fetches on first switch into the tab, and again whenever the filter
  // scope changes while already on it.
  useEffect(() => {
    if (!filters || tab !== "attrition") return;
    let cancelled = false;
    setHeadcountLoading(true);
    setError(null);
    const common = { location: filters.location, department: filters.department, block: filters.block };
    const prevRange = previousPeriod(filters.start, filters.end);
    Promise.all([
      getHeadcount({ ...common, start: filters.start, end: filters.end }),
      getHeadcount({ ...common, ...prevRange }).catch(() => null),
    ])
      .then(([h, ph]) => {
        if (cancelled) return;
        setHeadcount(h);
        setPrevHeadcount(ph);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setHeadcountLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tab, filters?.start, filters?.end, filters?.location, filters?.department, filters?.block]);

  useEffect(() => {
    if (!filters || tab !== "attrition") return;
    let cancelled = false;
    const common = {
      start: filters.start,
      end: filters.end,
      location: filters.location,
      department: filters.department,
    };
    Promise.all([
      getHeadcount({ ...common, block: "DS15" }).catch(() => null),
      getHeadcount({ ...common, block: "DS1" }).catch(() => null),
    ]).then(([ds15, ds1]) => {
      if (!cancelled) setBlockHeadcounts({ DS15: ds15, DS1: ds1 });
    });
    return () => {
      cancelled = true;
    };
  }, [tab, filters?.start, filters?.end, filters?.location, filters?.department]);

  if (authed === null) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-[color:var(--text-muted)]" />;
  }

  if (authed === false) {
    return <Login onLoggedIn={handleLoggedIn} />;
  }

  if (!filters) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[color:var(--text-muted)]">
        {error ? `Failed to load: ${error}` : "Loading..."}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <LoadingOverlay show={loading} />
      <Header meta={meta} onLogout={handleLogout} tab={tab} onTabChange={setTab} />
      <FiltersBar
        filters={filters}
        options={options}
        onChange={setFilters}
        showOutlierControls={tab === "shift-drift"}
        showEmployeeLookup={tab === "attrition"}
        // DS1/DS15 disabled for now, per request - was tab === "attrition" && filters.location === "RND"
        showBlockFilter={false}
        allowedLocations={session.role === "employee" ? session.location : null}
        employeeSearchTerm={employeeSearchTerm}
        onEmployeeSearchTermChange={setEmployeeSearchTerm}
        onEmployeeSearch={runEmployeeSearch}
        employeeSearching={employeeSearching}
      />
      {error && (
        <div className="mx-5 mt-3 flex-none rounded-lg bg-[color:var(--bg-surface-3)] px-4 py-2 text-sm text-[color:var(--late)]">{error}</div>
      )}

      <div className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${loading ? "opacity-60" : "opacity-100"}`}>
        {tab === "attrition" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <WorkforcePanel
              headcount={headcount}
              prevHeadcount={prevHeadcount}
              blockHeadcounts={blockHeadcounts}
              scope={{ start: filters.start, end: filters.end, location: filters.location, department: filters.department, block: filters.block }}
              employeeResults={employeeResults}
              employeeSearchError={employeeSearchError}
            />
          </div>
        ) : (
          <>
            {/* Extension Pattern (~65%) gets the lion's share of width;
                the two charts share the remaining ~35%, stacked so each gets
                real height to stretch into instead of being squeezed sideways. */}
            <div className="grid min-h-0 flex-1 grid-cols-[1.9fr_1fr] gap-3 px-5 pt-4 pb-3">
              <div className="flex min-h-0 flex-col gap-3">
                <StatTiles
                  stats={stats}
                  combos={combos}
                  onRepeatOffendersClick={() => setRepeatOffendersSignal((n) => n + 1)}
                />
                <CombosTable
                  data={combos}
                  filters={filters}
                  mode={comboMode}
                  onModeChange={setComboMode}
                  focusRepeatOffenders={repeatOffendersSignal}
                  onExport={() =>
                    window.open(
                      combosCsvUrl({
                        start: filters.start,
                        end: filters.end,
                        location: filters.location,
                        department: filters.department,
                        search: filters.search,
                        early_weekday: filters.earlyDay,
                        late_weekday: filters.lateDay,
                        mode: comboMode,
                      }),
                      "_blank"
                    )
                  }
                  className="min-h-0 flex-1"
                />
              </div>
              <div className="flex min-h-0 flex-col gap-3">
                <Panel title="Clock-in outcomes by weekday" className="min-h-0 flex-1">
                  {stats && <WeekdayChart byWeekday={stats.by_weekday} />}
                </Panel>
                <Panel title="Early / Late by department" className="min-h-0 flex-1">
                  {stats && <DepartmentChart byDepartment={stats.by_department} />}
                </Panel>
              </div>
            </div>

            <OutliersAccordion
              filters={filters}
              page={page}
              onPageChange={setPage}
              searchTerm={filters.search}
              combosEmpty={Boolean(filters.search?.trim()) && combos != null && combos.combos.length === 0}
              onExport={() =>
                window.open(
                  outliersCsvUrl({
                    start: filters.start,
                    end: filters.end,
                    location: filters.location,
                    department: filters.department,
                    flag: filters.flag,
                    search: filters.search,
                  }),
                  "_blank"
                )
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children, className = "", scroll = false }) {
  return (
    <div
      className={`flex flex-col rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-[var(--shadow)] ${className}`}
    >
      <div className="flex flex-none items-baseline justify-between gap-2 px-5 pt-4 pb-3">
        <h2 className="text-sm font-bold text-[color:var(--heading)]">{title}</h2>
        {subtitle && <span className="text-xs text-[color:var(--text-muted)]">{subtitle}</span>}
      </div>
      <div className={`min-h-0 flex-1 px-5 pb-4 ${scroll ? "overflow-y-auto" : "flex flex-col"}`}>{children}</div>
    </div>
  );
}
