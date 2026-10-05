import logo from "../assets/laurus-logo.png";
import { formatDateDMY } from "../lib/format";

export default function Header({ meta, onLogout }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <img src={logo} alt="Laurus Labs" className="h-9 w-auto flex-none" />
        <div className="h-8 w-px flex-none bg-[color:var(--border-strong)]" />
        <h1 className="text-base font-bold tracking-tight text-[color:var(--text-primary)]">Shift Drift Dashboard</h1>
      </div>
      <div className="flex items-center gap-3">
        {meta && (
          <div className="text-right text-xs text-[color:var(--text-muted)]">
            <div>
              Data: {formatDateDMY(meta.earliest_date)} &ndash; {formatDateDMY(meta.last_import_date)}
            </div>
            <div>{meta.total_rows?.toLocaleString()} rows</div>
          </div>
        )}
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
