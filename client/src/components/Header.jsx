import logo from "../assets/laurus-logo-white.png";

const TABS = [
  { key: "shift-drift", label: "Shift Drift" },
  { key: "attrition", label: "Attrition Rates" },
];

export default function Header({ meta, onLogout, tab, onTabChange }) {
  return (
    <header
      className="flex flex-none flex-wrap items-center justify-between gap-4 rounded-b-lg px-6 py-2.5 shadow-[var(--shadow)]"
      style={{ background: "linear-gradient(90deg, var(--header-grad-1), var(--header-grad-2))" }}
    >
      <div className="flex items-center gap-4">
        <img src={logo} alt="Laurus Labs" className="h-8 w-auto flex-none" />
        <div className="h-6 w-px flex-none" style={{ background: "var(--header-divider)" }} />
        <nav className="flex items-center gap-1 text-base font-bold tracking-tight">
          {TABS.map((t, i) => (
            <span key={t.key} className="flex items-center gap-1">
              {i > 0 && <span className="mx-1 h-5 w-px flex-none" style={{ background: "var(--header-divider)" }} />}
              <button
                type="button"
                onClick={() => onTabChange(t.key)}
                className={`rounded-lg px-3 py-1.5 transition-colors ${tab === t.key ? "" : "hover:bg-white/10"}`}
                style={{
                  background: tab === t.key ? "var(--accent-2)" : undefined,
                  color: tab === t.key ? "var(--header-ink)" : "var(--header-ink-muted)",
                }}
              >
                {t.label}
              </button>
            </span>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onLogout}
          className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
          style={{ borderColor: "var(--header-ink-muted)", color: "var(--header-ink)" }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
