import { compactNumber } from "../lib/format";

const TILES = [
  { key: "employees", label: "Employees" },
  { key: "employee_days", label: "Employee-days" },
  { key: "early", label: "Early", color: "var(--early)" },
  { key: "late", label: "Late", color: "var(--late)" },
  { key: "combo_flags", label: "Weekend-extension flags", color: "var(--late)" },
  { key: "combo_employees", label: "Employees doing it", color: "var(--late)" },
];

export default function StatTiles({ stats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {TILES.map((t) => (
        <div
          key={t.key}
          className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 shadow-[var(--shadow)]"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">{t.label}</div>
          <div className="mt-1 text-2xl font-semibold" style={{ color: t.color ?? "var(--text-primary)" }}>
            {stats ? compactNumber(stats[t.key]) : "-"}
          </div>
        </div>
      ))}
    </div>
  );
}
