import { compactNumber, WEEKDAY_NAMES } from "../lib/format";

// Employees with 3+ full-pattern occurrences in range - a one-off is noise,
// a repeat is the behavior actually worth flagging. Computed client-side
// from the combos already fetched for the table below, no extra query.
const REPEAT_THRESHOLD = 3;

function rateNum(numerator, denominator) {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function formatRate(n) {
  return n == null ? "0%" : `${n.toFixed(1)}%`;
}

function buildTiles(stats, combos) {
  const dayPair = combos ? `${WEEKDAY_NAMES[combos.early_weekday]} early → ${WEEKDAY_NAMES[combos.late_weekday]} late` : null;
  const repeatCounts = combos
    ? combos.combos.filter((c) => c.pair_count >= REPEAT_THRESHOLD)
    : [];
  const repeatEmployees = new Set(repeatCounts.map((c) => c.day1.emp_id));
  const worstCount = repeatCounts.reduce((max, c) => Math.max(max, c.pair_count), 0);

  const lateRate = stats ? rateNum(stats.late, stats.employee_days) : null;
  const earlyRate = stats ? rateNum(stats.early, stats.employee_days) : null;
  const ontimeRate = stats ? 100 - (earlyRate ?? 0) - (lateRate ?? 0) : null;

  return [
    {
      key: "employees",
      label: "Employees",
      value: stats ? compactNumber(stats.employees) : "-",
      gradient: "var(--tile-purple)",
    },
    {
      key: "employee_days",
      label: "Employee-days",
      value: stats ? compactNumber(stats.employee_days) : "-",
      sub: stats ? `Early ${formatRate(earlyRate)} · On-time ${formatRate(ontimeRate)} · Late ${formatRate(lateRate)}` : null,
      gradient: "var(--tile-purple)",
    },
    {
      key: "employees_affected",
      label: "Extension pattern",
      value: stats ? compactNumber(stats.combo_employees) : "-",
      sub: stats ? `${formatRate(rateNum(stats.combo_employees, stats.employees))} of employees · ${dayPair}` : null,
      gradient: "var(--tile-teal)",
    },
    {
      key: "repeat_offenders",
      label: `Repeat offenders (${REPEAT_THRESHOLD}+ times)`,
      value: combos ? compactNumber(repeatEmployees.size) : "-",
      sub: worstCount > 0 ? `Worst case: ${worstCount} times this range` : "None this range",
      gradient: "var(--tile-red)",
      clickable: true,
    },
  ];
}

export default function StatTiles({ stats, combos, onRepeatOffendersClick }) {
  const tiles = buildTiles(stats, combos);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => {
        const Tag = t.clickable ? "button" : "div";
        return (
          <Tag
            key={t.key}
            type={t.clickable ? "button" : undefined}
            onClick={t.clickable ? onRepeatOffendersClick : undefined}
            className={`rounded-2xl p-4 text-left shadow-[var(--shadow)] ${t.clickable ? "kpi-tile-clickable cursor-pointer" : ""}`}
            style={{ background: t.gradient }}
            title={t.clickable ? `Filter the table below to ${REPEAT_THRESHOLD}+ occurrences` : undefined}
          >
            <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-secondary)]">
              {t.label}
              {t.clickable && <span className="text-[color:var(--accent)]">&#8964;</span>}
            </div>
            <div className="mt-2 text-[28px] font-extrabold leading-none text-[color:var(--text-primary)]">
              {t.value}
            </div>
            {t.sub && <div className="mt-1 truncate text-[11px] text-[color:var(--text-muted)]">{t.sub}</div>}
          </Tag>
        );
      })}
    </div>
  );
}
