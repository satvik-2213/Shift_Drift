import { useState } from "react";

function truncate(s, n) {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const W = 460;
const H = 260;
const PAD_T = 6;
const PAD_B = 6;
const SIDE_PAD = 16;
const MAX_BARS = 8;

// Diverging from a shared center line, Early extending left and Late
// extending right - good for seeing at a glance which departments skew
// early vs. late, which the grouped-bar version doesn't show as directly
// (two separate same-direction bars don't read as a "lean" the way a
// diverging pair does).
export default function DepartmentChart({ byDepartment }) {
  const [hover, setHover] = useState(null); // index | null

  const rows = [...byDepartment]
    .filter((r) => r.department)
    .sort((a, b) => b.early + b.late - (a.early + a.late))
    .slice(0, MAX_BARS);

  const maxVal = Math.max(1, ...rows.map((r) => Math.max(r.early, r.late)));
  const plotH = H - PAD_T - PAD_B;
  const rowH = rows.length ? plotH / rows.length : plotH;
  const centerX = W / 2;
  const maxHalf = W / 2 - SIDE_PAD;
  const barH = Math.min(11, rowH * 0.3);

  if (rows.length === 0) {
    return <p className="text-sm text-[color:var(--text-muted)]">No department data in range.</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Diverging horizontal bar chart of early versus late counts by department"
        className="w-full flex-1 min-h-0"
      >
        <line x1={centerX} x2={centerX} y1={PAD_T} y2={H - PAD_B} stroke="var(--border-strong)" strokeWidth={1} />
        {rows.map((r, i) => {
          const rowTop = PAD_T + rowH * i;
          const titleY = rowTop + rowH * 0.38;
          const barY = rowTop + rowH * 0.5;
          const earlyW = (r.early / maxVal) * maxHalf;
          const lateW = (r.late / maxVal) * maxHalf;
          return (
            <g key={r.department} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={rowTop} width={W} height={rowH} fill="transparent" />
              <text x={centerX} y={titleY} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--text-primary)">
                {truncate(r.department_name || r.department, 28)}
              </text>
              <rect x={centerX - earlyW} y={barY} width={earlyW} height={barH} rx={3} fill="var(--early)" opacity={hover === null || hover === i ? 1 : 0.45}>
                <title>
                  {r.department_name || r.department} &middot; Early: {r.early.toLocaleString()}
                </title>
              </rect>
              <rect x={centerX} y={barY} width={lateW} height={barH} rx={3} fill="var(--late)" opacity={hover === null || hover === i ? 1 : 0.45}>
                <title>
                  {r.department_name || r.department} &middot; Late: {r.late.toLocaleString()}
                </title>
              </rect>
              {hover === i && (
                <>
                  <text x={centerX - earlyW - 4} y={barY + barH - 2} textAnchor="end" fontSize={9.5} fontWeight={600} fill="var(--early)">
                    {r.early}
                  </text>
                  <text x={centerX + lateW + 4} y={barY + barH - 2} textAnchor="start" fontSize={9.5} fontWeight={600} fill="var(--late)">
                    {r.late}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[color:var(--text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--early)" }} />
          Early
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--late)" }} />
          Late
        </span>
      </div>
    </div>
  );
}
