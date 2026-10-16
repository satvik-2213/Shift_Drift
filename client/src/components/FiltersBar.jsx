import { useEffect, useState } from "react";
import DatePickerField from "./DatePickerField";
import { getFilters } from "../lib/api";
import { WEEKDAY_NAMES } from "../lib/format";

const inputClass =
  "rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-2.5 py-1.5 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]";

const FIELD_KEYS = ["start", "end", "location", "department", "block", "flag", "search", "earlyDay", "lateDay"];
const BLOCKS = ["DS15", "DS1"];
const WEEKDAY_FIELDS = new Set(["earlyDay", "lateDay"]);

export default function FiltersBar({
  filters,
  options,
  onChange,
  showOutlierControls = true,
  showEmployeeLookup = false,
  showBlockFilter = false,
  employeeSearchTerm = "",
  onEmployeeSearchTermChange,
  onEmployeeSearch,
  employeeSearching = false,
  allowedLocations = null, // null = unrestricted; array = restricted to these location_id(s)
}) {
  const locked = allowedLocations && allowedLocations.length === 1 ? allowedLocations[0] : null;
  const restrictedChoice = allowedLocations && allowedLocations.length > 1 ? allowedLocations : null;
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  // Location and department are mutually scoped - picking one narrows the
  // other's option list (some locations only use a handful of the 189
  // departments, and plenty of departments exist at only one or two
  // branches). This reacts to the *draft* selection immediately, same as
  // before, but is now independent of the Search button below: only the
  // actual data query (stats/combos/headcount/outliers, owned by App) waits
  // for that button - narrowing the dropdowns themselves should not.
  const [localOptions, setLocalOptions] = useState(options);
  useEffect(() => setLocalOptions(options), [options]);
  useEffect(() => {
    let cancelled = false;
    getFilters({ location: draft.location, department: draft.department }).then((f) => {
      if (!cancelled) setLocalOptions(f);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.location, draft.department]);

  const set = (key) => (e) => {
    const value = WEEKDAY_FIELDS.has(key) ? Number(e.target.value) : e.target.value;
    setDraft((d) => {
      // Block (DS15/DS1) only ever applies at RND - clear it the moment the
      // location moves away from RND so a stale selection doesn't keep
      // silently filtering data once its own control disappears.
      if (key === "location" && value !== "RND" && d.block) return { ...d, location: value, block: "" };
      return { ...d, [key]: value };
    });
  };
  const dirty = FIELD_KEYS.some((k) => draft[k] !== filters[k]);
  const apply = () => {
    if (dirty) onChange(draft);
  };
  const onEnter = (e) => e.key === "Enter" && apply();

  return (
    <div className="mx-5 mt-3 flex flex-none flex-wrap items-end justify-between gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-3 shadow-[var(--shadow)]">
      <div className="flex items-end gap-2">
        <Field label="Start date">
          <DatePickerField value={draft.start} onChange={(v) => setDraft((d) => ({ ...d, start: v }))} />
        </Field>
        <Field label="End date">
          <DatePickerField value={draft.end} onChange={(v) => setDraft((d) => ({ ...d, end: v }))} />
        </Field>
      </div>
      <Field label="Location">
        <select
          className={`${inputClass} w-36 ${locked ? "cursor-not-allowed opacity-60" : ""}`}
          value={locked || draft.location}
          onChange={set("location")}
          disabled={!!locked}
          title={locked ? "Your account is restricted to this location" : restrictedChoice ? "Your account is restricted to these locations" : undefined}
        >
          {locked ? (
            <option value={locked}>{locked}</option>
          ) : restrictedChoice ? (
            <>
              <option value="">All my locations</option>
              {restrictedChoice.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </>
          ) : (
            <>
              <option value="">All locations</option>
              {localOptions.locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </>
          )}
        </select>
      </Field>
      <Field label="Department">
        <select className={`${inputClass} w-36`} value={draft.department} onChange={set("department")}>
          <option value="">All departments</option>
          {localOptions.departments.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name || d.code}
            </option>
          ))}
        </select>
      </Field>
      {showBlockFilter && (
        <Field label="Block">
          <select className={inputClass} value={draft.block} onChange={set("block")} title="EMPMAST GROUPCODE 860/861">
            <option value="">All blocks</option>
            {BLOCKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>
      )}
      {showOutlierControls && (
        <>
          <div className="flex items-end gap-2">
            <Field label="Early day">
              <select className={inputClass} value={draft.earlyDay} onChange={set("earlyDay")} title="First day of the flagged pattern (clocked in early)">
                {WEEKDAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Late day">
              <select className={inputClass} value={draft.lateDay} onChange={set("lateDay")} title="Paired day of the flagged pattern (clocked in late)">
                {WEEKDAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Flag">
            <select className={inputClass} value={draft.flag} onChange={set("flag")}>
              <option value="">Early + Late</option>
              <option value="Early">Early</option>
              <option value="On-time">On-time</option>
              <option value="Late">Late</option>
              <option value="all">All</option>
            </select>
          </Field>
          <Field label="Search">
            <input
              type="search"
              placeholder="Name or employee ID"
              className={`${inputClass} w-36`}
              value={draft.search}
              onChange={set("search")}
              onKeyDown={onEnter}
            />
          </Field>
        </>
      )}
      <button
        type="button"
        onClick={apply}
        className="rounded-lg px-4 py-1.5 text-[13px] font-semibold text-white shadow-[var(--shadow)] transition-opacity hover:opacity-90"
        style={{ background: "var(--accent)" }}
        title="Run search with the selected filters"
      >
        Search
      </button>
      {showEmployeeLookup && (
        <Field label="Employee lookup">
          <div className="flex gap-1.5">
            <input
              type="search"
              placeholder="Employee ID or name"
              className={`${inputClass} w-48`}
              value={employeeSearchTerm}
              onChange={(e) => onEmployeeSearchTermChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onEmployeeSearch()}
            />
            <button
              type="button"
              onClick={onEmployeeSearch}
              disabled={employeeSearching || !employeeSearchTerm.trim()}
              className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white shadow-[var(--shadow)] transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--accent-2)" }}
            >
              {employeeSearching ? "…" : "Go"}
            </button>
          </div>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

