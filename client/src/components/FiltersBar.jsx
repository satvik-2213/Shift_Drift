import { useEffect, useState } from "react";

const inputClass =
  "rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-2.5 py-1.5 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]";

const FIELD_KEYS = ["start", "end", "location", "department", "flag", "search"];
const AUTO_APPLY_DELAY = 500;

export default function FiltersBar({ filters, options, onChange, onExport }) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const dirty = FIELD_KEYS.some((k) => draft[k] !== filters[k]);
  const apply = () => {
    if (dirty) onChange(draft);
  };
  const onEnter = (e) => e.key === "Enter" && apply();

  // Dates and search can't tell "picked a final value" apart from "still
  // mid-interaction" from the onChange event alone - a native date input
  // fires the same event whether you clicked one day in the popup or are
  // stepping through its month/day/year segments one key at a time, and a
  // search box fires one per keystroke. So: auto-apply once the draft holds
  // still for AUTO_APPLY_DELAY - a single deliberate pick settles instantly
  // in practice, while still-changing input keeps pushing the timer back.
  // Dropdowns don't need this - selecting an option is always one complete
  // action - so they call `apply` directly in their own onChange instead.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(apply, AUTO_APPLY_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.start, draft.end, draft.search]);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 shadow-[var(--shadow)]">
      <Field label="Start date">
        <input type="date" className={inputClass} value={draft.start} onChange={set("start")} onKeyDown={onEnter} />
      </Field>
      <Field label="End date">
        <input type="date" className={inputClass} value={draft.end} onChange={set("end")} onKeyDown={onEnter} />
      </Field>
      <Field label="Location">
        <select
          className={inputClass}
          value={draft.location}
          onChange={(e) => onChange({ ...draft, location: e.target.value })}
        >
          <option value="">All locations</option>
          {options.locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Department">
        <select
          className={inputClass}
          value={draft.department}
          onChange={(e) => onChange({ ...draft, department: e.target.value })}
        >
          <option value="">All departments</option>
          {options.departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Flag">
        <select className={inputClass} value={draft.flag} onChange={(e) => onChange({ ...draft, flag: e.target.value })}>
          <option value="">Early + Late</option>
          <option value="Early">Early</option>
          <option value="On-time">On-time</option>
          <option value="Late">Late</option>
        </select>
      </Field>
      <Field label="Search">
        <input
          type="search"
          placeholder="Name or employee ID"
          className={`${inputClass} w-44`}
          value={draft.search}
          onChange={set("search")}
          onKeyDown={onEnter}
        />
      </Field>
      <button
        type="button"
        onClick={onExport}
        className="ml-auto rounded-lg border border-[color:var(--border-strong)] px-3.5 py-1.5 text-[13px] font-medium text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
      >
        Export
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}
