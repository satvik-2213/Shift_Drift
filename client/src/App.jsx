import { useEffect, useState } from "react";
import Header from "./components/Header";
import FiltersBar from "./components/FiltersBar";
import StatTiles from "./components/StatTiles";
import WeekdayChart from "./components/WeekdayChart";
import DepartmentChart from "./components/DepartmentChart";
import OutliersTable from "./components/OutliersTable";
import CombosTable from "./components/CombosTable";
import LoadingOverlay from "./components/LoadingOverlay";
import Login from "./components/Login";
import { getMeta, getFilters, getOutliers, getCombos, getStats, getSession, logout, outliersCsvUrl } from "./lib/api";

const PAGE_SIZE = 50;

function daysAgo(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const [authed, setAuthed] = useState(null); // null = checking, false = show login, true = show app

  const [meta, setMeta] = useState(null);
  const [options, setOptions] = useState({ departments: [], locations: [] });
  const [filters, setFilters] = useState(null); // null until meta-derived defaults are ready
  const [page, setPage] = useState(1);

  const [stats, setStats] = useState(null);
  const [outliers, setOutliers] = useState(null);
  const [combos, setCombos] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadInitialData = async () => {
    try {
      const [m, f] = await Promise.all([getMeta(), getFilters()]);
      setMeta(m);
      setOptions(f);
      const end = m.last_import_date ?? new Date().toISOString().slice(0, 10);
      const start = m.earliest_date && daysAgo(end, 7) < m.earliest_date ? m.earliest_date : daysAgo(end, 7);
      setFilters({ start, end, location: "", department: "", flag: "", search: "" });
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    (async () => {
      const { authenticated } = await getSession();
      setAuthed(authenticated);
      if (authenticated) await loadInitialData();
    })();
  }, []);

  const handleLoggedIn = async () => {
    setAuthed(true);
    await loadInitialData();
  };

  const handleLogout = async () => {
    await logout();
    setAuthed(false);
    setFilters(null);
    setMeta(null);
  };

  useEffect(() => {
    if (!filters) return;
    setPage(1);
  }, [filters?.start, filters?.end, filters?.location, filters?.department, filters?.flag, filters?.search]);

  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const common = {
      start: filters.start,
      end: filters.end,
      location: filters.location,
      department: filters.department,
    };
    Promise.all([
      getStats(common),
      getOutliers({ ...common, flag: filters.flag, search: filters.search, page, page_size: PAGE_SIZE }),
      getCombos({ ...common, search: filters.search }),
    ])
      .then(([s, o, c]) => {
        if (cancelled) return;
        setStats(s);
        setOutliers(o);
        setCombos(c);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.start, filters?.end, filters?.location, filters?.department, filters?.flag, filters?.search, page]);

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
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-6">
      <LoadingOverlay show={loading} />
      <Header meta={meta} onLogout={handleLogout} />
      <FiltersBar
        filters={filters}
        options={options}
        onChange={setFilters}
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
      {error && <div className="rounded-lg bg-[color:var(--bg-surface-3)] px-4 py-2 text-sm text-[color:var(--late)]">{error}</div>}
      <div className={`flex flex-col gap-5 transition-opacity duration-200 ${loading ? "opacity-60" : "opacity-100"}`}>
        <StatTiles stats={stats} />
        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Panel title="Clock-in outcomes by weekday">{stats && <WeekdayChart byWeekday={stats.by_weekday} />}</Panel>
          <Panel title="Early / Late by department">{stats && <DepartmentChart byDepartment={stats.by_department} />}</Panel>
        </section>
        <Panel title="Friday-early &rarr; Monday-late combos">
          <CombosTable data={combos} />
        </Panel>
        <Panel title="Outliers">
          <OutliersTable data={outliers} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-5 shadow-[var(--shadow)]">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-[color:var(--text-primary)]">{title}</h2>
        {subtitle && <span className="text-xs text-[color:var(--text-muted)]">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}
