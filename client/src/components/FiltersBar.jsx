import { useEffect, useRef, useState } from "react";
import DatePickerField from "./DatePickerField";

const inputClass =
  "rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-2.5 py-1.5 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]";

const FIELD_KEYS = ["start", "end", "location", "department", "flag", "search"];
const AUTO_APPLY_DELAY = 500;

export default function FiltersBar({ filters, options, onChange, onExportOutliers, onExportCombos }) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const dirty = FIELD_KEYS.some((k) => draft[k] !== filters[k]);
  const apply = () => {
    if (dirty) onChange(draft);
  };
  const onEnter = (e) => e.key === "Enter" && apply();

  // Only search needs this: it fires one event per keystroke, so auto-apply
  // once it holds still for AUTO_APPLY_DELAY instead of on every character.
  // Dates (DatePickerField) and dropdowns call onChange directly - each is
  // already a single, explicit, complete action (a day click, an option
  // pick), nothing to debounce.
  useEffect(() => {
    if (draft.search === filters.search) return;
    const t = setTimeout(() => onChange({ ...draft, search: draft.search }), AUTO_APPLY_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.search]);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 shadow-[var(--shadow)]">
      <Field label="Start date">
        <DatePickerField value={draft.start} onChange={(v) => onChange({ ...draft, start: v })} />
      </Field>
      <Field label="End date">
        <DatePickerField value={draft.end} onChange={(v) => onChange({ ...draft, end: v })} />
      </Field>
      <Field label="Location">
        <select
          className={inputClass}
          value={draft.location}
          onChange={(e) => onChange({ ...draft, location: e.target.value, department: "" })}
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
            <option key={d.code} value={d.code}>
              {d.name || d.code}
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
      <ExportMenu onExportOutliers={onExportOutliers} onExportCombos={onExportCombos} />
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

function ExportMenu({ onExportOutliers, onExportCombos }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  return (
    <div className="relative ml-auto" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-[var(--shadow)] transition-opacity hover:opacity-90"
        style={{ background: "var(--accent-2)" }}
      >
        Export
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1.5 w-52 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-[var(--shadow)]">
          <ExportOption
            onClick={() => {
              onExportCombos();
              setOpen(false);
            }}
          >
            Weekend Extension Pattern
          </ExportOption>
          <ExportOption
            onClick={() => {
              onExportOutliers();
              setOpen(false);
            }}
          >
            Outliers table
          </ExportOption>
        </div>
      )}
    </div>
  );
}

function ExportOption({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3.5 py-2.5 text-left text-[13px] text-[color:var(--text-primary)] transition-colors hover:bg-[color:var(--bg-surface-2)]"
    >
      {children}
    </button>
  );
}
