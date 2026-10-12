import { useRef, useState } from "react";
import { formatPeriodLabel } from "../lib/format";

const W = 560;
const H = 260;
const PAD_L = 40;
const PAD_R = 36;
const PAD_T = 16;
const PAD_B = 28;

// One grouped bar chart, all four bars together per period - but on TWO
// axes, not one. Opening/Closing headcount run in the thousands while
// Exits/Joins run in the tens-to-low-hundreds; on a single shared axis the
// Exits/Joins bars were unreadably tiny. Headcount bars read off the left
// axis, Exits/Joins bars off the right - same approach as the dual-axis
// line chart this replaced, just with bars instead of lines.
const SERIES = [
  { key: "headcount_start", label: "Opening", color: "var(--accent)", axis: "left" },
  { key: "exits", label: "Exits", color: "var(--late)", axis: "right" },
  { key: "joins", label: "Joins", color: "var(--ontime)", axis: "right" },
  { key: "headcount_end", label: "Closing", color: "var(--accent-2)", axis: "left" },
];

// Resolves var(--xxx) references in a serialized SVG string against the
// live document's computed theme, so an exported PNG keeps the chart's
// actual (light/dark-aware) colors instead of CSS custom properties that
// mean nothing once the SVG is rasterized outside the page's DOM.
function resolveCssVars(svgString) {
  const styles = getComputedStyle(document.documentElement);
  return svgString.replace(/var\((--[a-zA-Z0-9-]+)\)/g, (match, varName) => {
    const val = styles.getPropertyValue(varName).trim();
    return val || match;
  });
}

function downloadChartPng(svgEl, filename) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const serialized = resolveCssVars(new XMLSerializer().serializeToString(clone));
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const scale = 2; // retina-ish output
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-surface").trim() || "#ffffff";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    });
  };
  img.src = url;
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19.5h16" />
    </svg>
  );
}

export default function AttritionTrendChart({ periods, exportFilename = "attrition_trend" }) {
  const [hover, setHover] = useState(null); // { p, x } | null
  const svgRef = useRef(null);

  const leftKeys = SERIES.filter((s) => s.axis === "left").map((s) => s.key);
  const rightKeys = SERIES.filter((s) => s.axis === "right").map((s) => s.key);
  const leftMax = Math.max(1, ...periods.flatMap((p) => leftKeys.map((k) => p[k])));
  const rightMax = Math.max(1, ...periods.flatMap((p) => rightKeys.map((k) => p[k])));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const bandW = plotW / Math.max(1, periods.length);

  const xOf = (i) => PAD_L + bandW * i;
  const yOfAxis = (v, axis) => PAD_T + plotH * (1 - v / (axis === "right" ? rightMax : leftMax));

  const yGrid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD_T + plotH * (1 - f),
    leftLabel: Math.round(leftMax * f),
    rightLabel: Math.round(rightMax * f),
  }));

  const groupW = bandW * 0.78;
  const groupPad = (bandW - groupW) / 2;
  const barGap = 2;
  const barW = (groupW - barGap * (SERIES.length - 1)) / SERIES.length;

  return (
    <div className="relative flex h-72 flex-col">
      <div className="mb-2 flex flex-none items-center justify-end">
        <button
          type="button"
          onClick={() => downloadChartPng(svgRef.current, `${exportFilename}.png`)}
          className="flex items-center justify-center rounded-lg border border-[color:var(--border-strong)] p-1.5 text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          title="Download chart as PNG"
        >
          <DownloadIcon />
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Bar chart: opening/closing headcount on the left axis, exits/joins on the right axis, by period"
        className="w-full flex-1 min-h-0"
      >
        <rect x={0} y={0} width={W} height={H} fill="var(--bg-surface)" />
        <text x={PAD_L} y={PAD_T - 5} textAnchor="start" fontSize={8.5} fontWeight={600} fill="var(--text-muted)">
          Headcount
        </text>
        <text x={W - PAD_R} y={PAD_T - 5} textAnchor="end" fontSize={8.5} fontWeight={600} fill="var(--text-muted)">
          Exits / Joins
        </text>
        {yGrid.map((g) => (
          <g key={g.y}>
            <line x1={PAD_L} x2={W - PAD_R} y1={g.y} y2={g.y} stroke="var(--gridline)" strokeWidth={1} />
            <text x={2} y={g.y + 3} fontSize={9} fill="var(--text-muted)">
              {g.leftLabel}
            </text>
            <text x={W - PAD_R + 4} y={g.y + 3} fontSize={9} fill="var(--text-muted)">
              {g.rightLabel}
            </text>
          </g>
        ))}
        {periods.map((p, i) => {
          const groupX = xOf(i) + groupPad;
          return (
            <g key={p.period} onMouseEnter={() => setHover({ p, x: xOf(i) + bandW / 2 })} onMouseLeave={() => setHover(null)}>
              <rect x={xOf(i)} y={PAD_T} width={bandW} height={plotH} fill="transparent" />
              {SERIES.map((s, si) => {
                const barX = groupX + si * (barW + barGap);
                const barY = yOfAxis(p[s.key], s.axis);
                const barH = PAD_T + plotH - barY;
                return (
                  <g key={s.key}>
                    <rect x={barX} y={barY} width={barW} height={Math.max(0, barH)} fill={s.color} rx={1.5} />
                    <text x={barX + barW / 2} y={barY - 3} textAnchor="middle" fontSize={6.5} fontWeight={600} fill={s.color}>
                      {p[s.key]}
                    </text>
                  </g>
                );
              })}
              <text x={xOf(i) + bandW / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--text-secondary)">
                {formatPeriodLabel(p.period)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-2 text-xs shadow-[var(--shadow)]"
          style={{
            left: `${(hover.x / W) * 100}%`,
            top: `${(PAD_T / H) * 100}%`,
            transform: "translate(-50%, -100%) translateY(-8px)",
          }}
        >
          <div className="mb-1 font-semibold text-[color:var(--text-primary)]">{formatPeriodLabel(hover.p.period)}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 text-[color:var(--text-secondary)]">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular font-medium text-[color:var(--text-primary)]">{hover.p[s.key]}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 text-[color:var(--text-secondary)]">
            <span>Attrition rate</span>
            <span className="tabular font-medium" style={{ color: "var(--late)" }}>
              {hover.p.attrition_rate}%
            </span>
          </div>
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--text-secondary)]">
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
