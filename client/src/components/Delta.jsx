// Signed change badge for a stat tile, comparing the current value against
// the same-length period immediately preceding it. `goodDirection` says which
// way is an improvement so the arrow gets the right color; pass null for
// tiles where more/less isn't inherently good or bad (plain headcounts).
export default function Delta({ value, suffix = "%", goodDirection = null }) {
  if (value == null || !Number.isFinite(value)) return null;

  const isFlat = Math.abs(value) < (suffix === "pp" ? 0.05 : 0.5);
  const isUp = value > 0;

  let color = "var(--text-muted)";
  if (!isFlat && goodDirection) {
    const isGood = goodDirection === "up" ? isUp : !isUp;
    color = isGood ? "var(--ontime)" : "var(--late)";
  }

  const arrow = isFlat ? "→" : isUp ? "▲" : "▼";
  const text = `${isUp ? "+" : ""}${value.toFixed(1)}${suffix}`;

  return (
    <span className="tabular inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color }}>
      <span aria-hidden="true">{arrow}</span>
      {text}
    </span>
  );
}
