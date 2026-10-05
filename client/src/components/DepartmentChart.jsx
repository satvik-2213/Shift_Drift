const SERIES = [
  { key: "early", label: "Early", color: "var(--early)" },
  { key: "late", label: "Late", color: "var(--late)" },
];

const W = 460;
const H = 260;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 46;
const GAP = 2;
const MAX_BARS = 10;

export default function DepartmentChart({ byDepartment }) {
  const rows = [...byDepartment]
    .filter((r) => r.department)
    .sort((a, b) => b.early + b.late - (a.early + a.late))
    .slice(0, MAX_BARS);

  const maxVal = Math.max(1, ...rows.map((r) => Math.max(r.early, r.late)));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const bandW = rows.length ? plotW / rows.length : plotW;
  const barW = Math.min(16, (bandW - GAP) / 2 - GAP);

  const yGrid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD_T + plotH * (1 - f),
    label: Math.round(maxVal * f),
  }));

  if (rows.length === 0) {
    return <p className="text-sm text-[color:var(--text-muted)]">No department data in range.</p>;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Grouped bar chart of early and late counts by department" className="block w-full">
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
          return (
            <g key={r.department}>
              {SERIES.map((s, si) => {
                const v = r[s.key] ?? 0;
                const barH = (v / maxVal) * plotH;
                const x = cx - barW - GAP / 2 + si * (barW + GAP);
                return (
                  <rect key={s.key} x={x} y={PAD_T + plotH - barH} width={barW} height={barH} rx={3} fill={s.color}>
                    <title>
                      {r.department} &middot; {s.label}: {v.toLocaleString()}
                    </title>
                  </rect>
                );
              })}
              <text
                x={cx}
                y={H - PAD_B + 14}
                textAnchor="end"
                fontSize={9}
                fill="var(--text-secondary)"
                transform={`rotate(-35 ${cx} ${H - PAD_B + 14})`}
              >
                {r.department}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--text-secondary)]">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
