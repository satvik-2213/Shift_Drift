import { minutesToClock } from "../lib/format";

// Mirrors BUCKET_RANGE in server/shift_rules.py - shown as a hover hint only,
// not used for any calculation (the server already classified every row).
const BUCKET_WINDOWS = {
  A: "05:30–07:30",
  General: "07:31–12:00",
  B: "12:01–16:00",
  C: "20:00–23:00",
};

function ShiftBadge({ code, bucket }) {
  if (!code) return <span className="text-[color:var(--text-muted)]">&ndash;</span>;
  const window = BUCKET_WINDOWS[bucket];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-[color:var(--bg-surface-2)] px-2 py-0.5 text-xs font-medium text-[color:var(--text-secondary)]"
      title={window ? `Assigned shift ${bucket}: ${window}` : undefined}
    >
      {code}
    </span>
  );
}

export default function CombosTable({ data }) {
  if (!data) return null;
  const { total, combos } = data;

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[color:var(--border)] text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <Th>Employee</Th>
              <Th>Department</Th>
              <Th>Friday</Th>
              <Th>Clock-In</Th>
              <Th>Shift</Th>
              <Th>Monday</Th>
              <Th>Clock-In</Th>
              <Th>Shift</Th>
              <Th>Total weekends</Th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => (
              <tr key={`${c.friday.emp_id}-${c.friday.date}`} className="border-b border-[color:var(--border)] last:border-0">
                <Td>
                  <div className="font-medium text-[color:var(--text-primary)]">{c.friday.emp_name || c.friday.emp_id}</div>
                  <div className="text-xs text-[color:var(--text-muted)]">{c.friday.emp_id}</div>
                </Td>
                <Td>{c.friday.department}</Td>
                <Td className="tabular">{c.friday.date}</Td>
                <Td className="tabular" style={{ color: "var(--early)" }}>
                  {minutesToClock(c.friday.first_in_min)}
                </Td>
                <Td>
                  <ShiftBadge code={c.friday.shift_code} bucket={c.friday.assigned_bucket} />
                </Td>
                <Td className="tabular">{c.monday.date}</Td>
                <Td className="tabular" style={{ color: "var(--late)" }}>
                  {minutesToClock(c.monday.first_in_min)}
                </Td>
                <Td>
                  <ShiftBadge code={c.monday.shift_code} bucket={c.monday.assigned_bucket} />
                </Td>
                <Td className="tabular font-semibold">{c.weekend_count}</Td>
              </tr>
            ))}
            {combos.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[color:var(--text-muted)]">
                  No Friday-early &rarr; Monday-late combos in range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-[color:var(--text-muted)]">{total.toLocaleString()} total flags</div>
    </div>
  );
}

function Th({ children }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}
function Td({ children, className = "", style }) {
  return (
    <td className={`px-3 py-2 align-top ${className}`} style={style}>
      {children}
    </td>
  );
}
