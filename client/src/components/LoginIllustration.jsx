// Decorative split-screen panel for the login page - a single cohesive SVG
// illustration (an ID/attendance card being clocked in and verified)
// instead of the old composed-div diamond motif, themed around TAS's own
// colors (client/src/index.css's --brand-1/2/3, sampled from the real logo).

const FEATURES = [
  { text: "Shift & punch-in tracking", color: "var(--brand-1)" },
  { text: "Headcount & attrition insights", color: "var(--brand-2)" },
  { text: "One-click exports for HR reports", color: "var(--brand-3)" },
];

const DOTS = [
  { top: "8%", left: "12%", size: 10, color: "var(--brand-2)", opacity: 0.5 },
  { top: "18%", left: "80%", size: 14, color: "var(--brand-1)", opacity: 0.3 },
  { top: "42%", left: "6%", size: 8, color: "var(--brand-3)", opacity: 0.45 },
  { top: "74%", left: "86%", size: 12, color: "var(--brand-2)", opacity: 0.35 },
  { top: "86%", left: "20%", size: 9, color: "var(--brand-1)", opacity: 0.3 },
  { top: "28%", left: "92%", size: 7, color: "var(--brand-3)", opacity: 0.4 },
];

export default function LoginIllustration() {
  return (
    <div className="relative hidden h-full w-full overflow-hidden lg:flex lg:items-center lg:justify-center">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 600px at 10% 10%, rgba(66,20,95,0.10), transparent 60%), radial-gradient(800px 560px at 90% 20%, rgba(0,178,169,0.12), transparent 55%), radial-gradient(760px 520px at 50% 95%, rgba(105,190,40,0.10), transparent 55%)",
        }}
      />
      {DOTS.map((d, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{ top: d.top, left: d.left, width: d.size, height: d.size, background: d.color, opacity: d.opacity }}
        />
      ))}

      <div className="relative flex flex-col items-center gap-8">
        <svg viewBox="0 0 320 300" className="h-72 w-72 drop-shadow-sm" role="img" aria-label="Attendance card being checked in and verified">
          {/* ID / attendance card, slightly tilted */}
          <g transform="rotate(-6 160 170)">
            <rect x="55" y="105" width="210" height="130" rx="18" fill="var(--bg-surface)" stroke="var(--border-strong)" strokeWidth="1.5" />
            <rect x="55" y="105" width="210" height="34" rx="18" fill="var(--brand-1)" />
            <rect x="55" y="121" width="210" height="18" fill="var(--brand-1)" />
            <text x="160" y="129" textAnchor="middle" fontSize="19" fontWeight="800" letterSpacing="4" fill="#ffffff">
              TAS
            </text>

            {/* avatar */}
            <circle cx="98" cy="178" r="24" fill="var(--bg-surface-2)" stroke="var(--brand-1)" strokeWidth="2" />
            <circle cx="98" cy="171" r="8.5" fill="var(--brand-1)" opacity="0.55" />
            <path d="M80 194c3-10 11-15 18-15s15 5 18 15" fill="var(--brand-1)" opacity="0.55" />

            {/* name / id lines */}
            <rect x="136" y="162" width="100" height="9" rx="4.5" fill="var(--border-strong)" />
            <rect x="136" y="180" width="68" height="7" rx="3.5" fill="var(--gridline)" />
            <rect x="74" y="213" width="162" height="7" rx="3.5" fill="var(--bg-surface-3)" />
          </g>

          {/* clock, overlapping the card's top-right corner */}
          <g>
            <circle cx="238" cy="96" r="38" fill="var(--bg-surface)" stroke="var(--brand-1)" strokeWidth="3" />
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i * 30 * Math.PI) / 180;
              const x1 = 238 + 30 * Math.sin(angle);
              const y1 = 96 - 30 * Math.cos(angle);
              const x2 = 238 + 34 * Math.sin(angle);
              const y2 = 96 - 34 * Math.cos(angle);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" />;
            })}
            <line x1="238" y1="96" x2="238" y2="76" stroke="var(--brand-1)" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="238" y1="96" x2="255" y2="104" stroke="var(--brand-2)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="238" cy="96" r="3.5" fill="var(--brand-1)" />
          </g>

          {/* verified / checked-in badge, overlapping the card's bottom-left corner */}
          <g>
            <circle cx="82" cy="233" r="27" fill="var(--brand-3)" />
            <circle cx="82" cy="233" r="27" fill="none" stroke="var(--bg-surface)" strokeWidth="3" />
            <path d="M70 233l8 8 16-17" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>

        <div className="flex flex-col items-center gap-2">
          <span className="text-4xl font-extrabold uppercase tracking-[0.12em]">
            <span style={{ color: "var(--brand-1)" }}>TA</span>
            <span style={{ color: "var(--brand-2)" }}>S</span>
          </span>
          <span className="h-1 w-14 rounded-full" style={{ background: "var(--brand-3)" }} />
          <p className="text-sm font-semibold tracking-wide text-[color:var(--text-secondary)]">Time &amp; Attendance System</p>
        </div>

        <div className="flex flex-col gap-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)]/70 px-6 py-4 shadow-[var(--shadow)] backdrop-blur-sm">
          {FEATURES.map((f) => (
            <div key={f.text} className="flex items-center gap-2.5 text-sm font-medium text-[color:var(--text-secondary)]">
              <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: f.color }} />
              {f.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
