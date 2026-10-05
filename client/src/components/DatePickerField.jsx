import { useEffect, useRef, useState } from "react";
import { formatDateDMY } from "../lib/format";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parse(value) {
  const [y, m, d] = value.split("-").map(Number);
  return { y, m: m - 1, d };
}

// Replaces a native <input type="date"> - that fires the same onChange event
// whether the user clicked one specific day or just browsed the picker's
// month view (some browsers auto-advance the day when the month changes),
// so there is no reliable way to tell "a day was deliberately picked" apart
// from "still browsing" using the native element. Here, WE render the grid:
// the prev/next month arrows only change which month is displayed (no
// onChange call at all), and onChange fires only from an explicit click on
// a day cell.
export default function DatePickerField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const committed = parse(value);
  const [viewY, setViewY] = useState(committed.y);
  const [viewM, setViewM] = useState(committed.m);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const p = parse(value);
    setViewY(p.y);
    setViewM(p.m);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const changeMonth = (delta) => {
    let m = viewM + delta;
    let y = viewY;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewM(m);
    setViewY(y);
  };

  const pickDay = (d) => {
    onChange(toDateStr(viewY, viewM, d));
    setOpen(false);
  };

  const firstOfMonth = new Date(viewY, viewM, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstOfMonth; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-2.5 py-1.5 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
      >
        {formatDateDMY(value)}
        <CalendarIcon />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1.5 w-64 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-3 shadow-[var(--shadow)]">
          <div className="mb-2 flex items-center justify-between">
            <NavBtn onClick={() => changeMonth(-1)} label="Previous month">
              &lsaquo;
            </NavBtn>
            <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">
              {MONTH_LABELS[viewM]} {viewY}
            </span>
            <NavBtn onClick={() => changeMonth(1)} label="Next month">
              &rsaquo;
            </NavBtn>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-[color:var(--text-muted)]">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="py-1 font-medium">
                {w}
              </div>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <div key={`pad-${i}`} />;
              const isSelected = viewY === committed.y && viewM === committed.m && d === committed.d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pickDay(d)}
                  className={`rounded-md py-1 text-[12px] transition-colors ${
                    isSelected
                      ? "font-bold text-white"
                      : "text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface-2)]"
                  }`}
                  style={isSelected ? { background: "var(--accent)" } : undefined}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NavBtn({ children, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-md text-base text-[color:var(--text-secondary)] transition-colors hover:bg-[color:var(--bg-surface-2)] hover:text-[color:var(--accent)]"
    >
      {children}
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 flex-none text-[color:var(--text-muted)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
