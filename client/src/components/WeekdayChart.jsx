import { WEEKDAY_NAMES } from "../lib/format";

const SEGMENTS = [
  { key: "early", label: "Early", color: "var(--early)" },
  { key: "ontime", label: "On-time", color: "var(--ontime)" },
  { key: "late", label: "Late", color: "var(--late)" },
];

const W = 520;
const H = 260;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 28;
const GAP = 2; // surface gap between stacked segments (dataviz skill: marks-and-anatomy)

export default function WeekdayChart({ byWeekday }) {
  const rows = [0, 1, 2, 3, 4, 5, 6].map(
    (wd) => byWeekday.find((r) => r.weekday === wd) ?? { weekday: wd, early: 0, ontime: 0, late: 0 }
  );
  const maxTotal = Math.max(1, ...rows.map((r) => r.early + r.ontime + r.late));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const bandW = plotW / rows.length;
  const barW = Math.min(24, bandW * 0.55);

  const yGrid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD_T + plotH * (1 - f),
    label: Math.round(maxTotal * f),
  }));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stacked bar chart of clock-in outcomes by weekday" className="block w-full">
        {yGrid.map((g) => (
          <g key={g.y}>
            <line x1={PAD_L} x2={W - PAD_R} y1={g.y} y2={g.y} stroke="var(--gridline)" strokeWidth={1} />
            <text x={2} y={g.y + 3} fontSize={9} fill="var(--text-muted)">
              {g.label}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = PAD_L + bandW * i + bandW / 2;
          let yCursor = PAD_T + plotH;
          const segs = SEGMENTS.map((s) => {
            const v = r[s.key] ?? 0;
            const segH = Math.max(0, (v / maxTotal) * plotH - (v > 0 ? GAP : 0));
            const y = yCursor - segH;
            yCursor = y - (v > 0 ? GAP : 0);
            return { ...s, v, y, segH };
          });
          return (
            <g key={r.weekday}>
              {segs.map((s, si) =>
                s.v > 0 ? (
                  <rect
                    key={s.key}
                    x={cx - barW / 2}
                    y={s.y}
                    width={barW}
                    height={s.segH}
                    rx={si === segs.length - 1 ? 4 : 0}
                    fill={s.color}
                  >
                    <title>
                      {WEEKDAY_NAMES[r.weekday]} &middot; {s.label}: {s.v.toLocaleString()}
                    </title>
                  </rect>
                ) : null
              )}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
                {WEEKDAY_NAMES[r.weekday]}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--text-secondary)]">
      {SEGMENTS.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
