import logo from "../assets/laurus-logo.png";

const TABS = [
  { key: "shift-drift", label: "Shift Drift" },
  { key: "attrition", label: "Attrition Rates" },
];

export default function Header({ meta, onLogout, tab, onTabChange }) {
  return (
    <header className="flex flex-none flex-wrap items-center justify-between gap-4 border-b border-[color:var(--border)] bg-[color:var(--bg-surface)] px-6 py-4">
      <div className="flex items-center gap-4">
        <img src={logo} alt="Laurus Labs" className="h-10 w-auto flex-none py-0.5" />
        <div className="h-8 w-px flex-none bg-[color:var(--border-strong)]" />
        <nav className="flex items-center gap-2 text-base font-bold tracking-tight">
          {TABS.map((t, i) => (
            <span key={t.key} className="flex items-center gap-2">
              {i > 0 && <span className="text-[color:var(--border-strong)]">|</span>}
              <button
                type="button"
                onClick={() => onTabChange(t.key)}
                className="transition-colors"
                style={{ color: tab === t.key ? "var(--accent)" : "var(--text-muted)" }}
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
          className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
