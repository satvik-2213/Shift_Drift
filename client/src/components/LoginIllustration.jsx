// Decorative split-screen panel for the login page - geometric motif (four
// themed diamonds around a center mark) echoing the shape language of
// Laurus's other internal tools, built from inline SVG/CSS (no stock art),
// themed around shift/attendance/transport instead of documents.

const ICONS = {
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6.5-8 12-8 12s-8-5.5-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 20v-1.8a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.2V20" />
      <circle cx="9.8" cy="8.4" r="3.4" />
      <path d="M21 20v-1.8a3.6 3.6 0 0 0-2.6-3.46" />
      <path d="M14.8 4.1a3.4 3.4 0 0 1 0 6.6" />
    </svg>
  ),
};

const DIAMONDS = [
  { icon: "clock", color: "var(--brand-1)", pos: "top-0 left-1/2 -translate-x-1/2" },
  { icon: "calendar", color: "var(--brand-2)", pos: "top-1/2 right-0 -translate-y-1/2" },
  { icon: "users", color: "var(--brand-3)", pos: "bottom-0 left-1/2 -translate-x-1/2" },
  { icon: "pin", color: "var(--brand-1)", pos: "top-1/2 left-0 -translate-y-1/2" },
];

const DOTS = [
  { top: "8%", left: "12%", size: 10, color: "var(--brand-2)", opacity: 0.5 },
  { top: "18%", left: "78%", size: 14, color: "var(--brand-1)", opacity: 0.35 },
  { top: "42%", left: "6%", size: 8, color: "var(--brand-3)", opacity: 0.45 },
  { top: "72%", left: "85%", size: 12, color: "var(--brand-2)", opacity: 0.4 },
  { top: "85%", left: "22%", size: 9, color: "var(--brand-1)", opacity: 0.3 },
  { top: "30%", left: "92%", size: 7, color: "var(--brand-3)", opacity: 0.4 },
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

      <div className="relative h-72 w-72">
        {DIAMONDS.map((d) => (
          <div
            key={d.icon}
            className={`absolute flex h-32 w-32 rotate-45 items-center justify-center rounded-2xl shadow-sm ${d.pos}`}
            style={{ background: d.color, opacity: 0.16 }}
          />
        ))}
        {DIAMONDS.map((d) => (
          <div key={`${d.icon}-icon`} className={`absolute flex h-32 w-32 items-center justify-center ${d.pos}`}>
            <span className="h-7 w-7" style={{ color: d.color }}>
              {ICONS[d.icon]}
            </span>
          </div>
        ))}
        <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-[color:var(--bg-surface)] shadow-[var(--shadow)]">
          <span className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: "var(--brand-1)" }}>
            Shift
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: "var(--brand-2)" }}>
            Drift
          </span>
        </div>
      </div>

      <p className="absolute bottom-16 text-sm font-semibold tracking-wide text-[color:var(--text-secondary)]">
        Attendance Pattern Detection
      </p>
    </div>
  );
}
