export default function LoadingOverlay({ show }) {
  return (
    <div
      aria-hidden={!show}
      className={`pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-6 transition-opacity duration-200 ${
        show ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="flex items-center gap-2.5 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-surface)]/95 px-4 py-2 shadow-[var(--shadow)] backdrop-blur">
        <span
          className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-[color:var(--accent)] border-t-transparent"
          style={{ borderTopColor: "transparent" }}
        />
        <span className="text-xs font-medium text-[color:var(--text-secondary)]">Updating&hellip;</span>
      </div>
    </div>
  );
}
