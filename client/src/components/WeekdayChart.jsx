import { useState } from "react";
import { WEEKDAY_NAMES } from "../lib/format";

// On-time is dropped from the plot on purpose: it's the overwhelming
// majority every day (hundreds vs. tens), so on a shared axis it flattens
// Early/Late to the floor and buries the actual signal. Early/Late is also
// what the KPI tiles and combos table already key off of; On-time's own
// rate still shows there. Weekday is a real sequence (Sun->Sat), so unlike
// the department breakdown, a line here is honest, not just decorative.
const SERIES = [
  { key: "early", label: "Early", color: "var(--early)" },
  { key: "late", label: "Late", color: "var(--late)" },
];

const W = 520;
const H = 260;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 16;
const PAD_B = 28;

export default function WeekdayChart({ byWeekday }) {
  const [hover, setHover] = useState(null); // { row, x } | null

  const rows = [0, 1, 2, 3, 4, 5, 6].map(
    (wd) => byWeekday.find((r) => r.weekday === wd) ?? { weekday: wd, early: 0, ontime: 0, late: 0 }
  );
  const maxVal = Math.max(1, ...rows.map((r) => Math.max(r.early, r.late)));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const bandW = plotW / rows.length;

  const xOf = (i) => PAD_L + bandW * i + bandW / 2;
  const yOf = (v) => PAD_T + plotH * (1 - v / maxVal);

  const yGrid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD_T + plotH * (1 - f),
    label: Math.round(maxVal * f),
  }));

  const points = (key) => rows.map((r, i) => `${xOf(i)},${yOf(r[key])}`).join(" ");

  // Direct-label only the single worst value per series (selective labeling,
  // not a number crammed on every point).
  const peak = (key) => rows.reduce((best, r) => (r[key] > best[key] ? r : best), rows[0]);
  const earlyPeak = peak("early");
  const latePeak = peak("late");

  return (
    <div className="relative flex h-full flex-col">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Line chart of early and late counts by weekday"
        className="w-full flex-1 min-h-0"
      >
        {yGrid.map((g) => (
          <g key={g.y}>
            <line x1={PAD_L} x2={W - PAD_R} y1={g.y} y2={g.y} stroke="var(--gridline)" strokeWidth={1} />
            <text x={2} y={g.y + 3} fontSize={9} fill="var(--text-muted)">
              {g.label}
            </text>
          </g>
        ))}
        {SERIES.map((s) => (
          <polyline
            key={s.key}
            points={points(s.key)}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {rows.map((r, i) => {
          const cx = xOf(i);
          return (
            <g key={r.weekday} onMouseEnter={() => setHover({ row: r, x: cx })} onMouseLeave={() => setHover(null)}>
              <rect x={cx - bandW / 2} y={PAD_T} width={bandW} height={plotH} fill="transparent" />
              {SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={cx}
                  cy={yOf(r[s.key])}
                  r={r.weekday === earlyPeak.weekday && s.key === "early" ? 4 : r.weekday === latePeak.weekday && s.key === "late" ? 4 : 3}
                  fill={s.color}
                  style={{ pointerEvents: "none" }}
                />
              ))}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
                {WEEKDAY_NAMES[r.weekday]}
              </text>
            </g>
          );
        })}
        {earlyPeak.early > 0 && (
          <text x={xOf(earlyPeak.weekday)} y={yOf(earlyPeak.early) - 8} textAnchor="middle" fontSize={10} fontWeight="600" fill="var(--early)">
            {earlyPeak.early}
          </text>
        )}
        {latePeak.late > 0 && (
          <text x={xOf(latePeak.weekday)} y={yOf(latePeak.late) - 8} textAnchor="middle" fontSize={10} fontWeight="600" fill="var(--late)">
            {latePeak.late}
          </text>
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-2 text-xs shadow-[var(--shadow)]"
          style={{
            left: `${(hover.x / W) * 100}%`,
            top: `${(yOf(Math.max(hover.row.early, hover.row.late)) / H) * 100}%`,
            transform: "translate(-50%, -100%) translateY(-8px)",
          }}
        >
          <div className="mb-1 font-semibold text-[color:var(--text-primary)]">{WEEKDAY_NAMES[hover.row.weekday]}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 text-[color:var(--text-secondary)]">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular font-medium text-[color:var(--text-primary)]">{(hover.row[s.key] ?? 0).toLocaleString()}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 text-[color:var(--text-secondary)]">
            <span>On-time</span>
            <span className="tabular font-medium text-[color:var(--text-primary)]">{(hover.row.ontime ?? 0).toLocaleString()}</span>
          </div>
        </div>
      )}
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--text-secondary)]">
      {SERIES.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
