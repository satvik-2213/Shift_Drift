import { minutesToClock, formatDateDMY } from "../lib/format";

const FLAG_COLOR = { Early: "var(--early)", "On-time": "var(--ontime)", Late: "var(--late)" };

// Mirrors SHIFT_CODE_TO_BUCKET in server/shift_rules.py, inverted - so "Came
// in as" reads in the same shift-code format as "Assigned" (BS, not just B),
// instead of mixing a bucket name in one column with a code in the other.
// A time outside every bucket has no code to fall back to.
const BUCKET_TO_CODE = { General: "GS", A: "AS", B: "BS", C: "CS" };

// GS displayed as "Gen" in both shift columns - easier to tell apart from CS
// at a glance than two codes both ending in S.
const CODE_LABEL = { GS: "Gen" };
const shiftLabel = (code) => CODE_LABEL[code] ?? code;

function ShiftPill({ children, title }) {
  return (
    <span
      className="inline-block rounded-md bg-[color:var(--bg-surface-2)] px-2 py-0.5 text-xs font-medium text-[color:var(--text-secondary)]"
      title={title}
    >
      {children}
    </span>
  );
}

export default function OutliersTable({ data, page, pageSize, onPageChange }) {
  if (!data) return null;
  const { total, rows } = data;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[22%]" />
            <col className="w-[16%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[color:var(--border)] text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <Th>Date</Th>
              <Th>Employee</Th>
              <Th>Department</Th>
              <Th>Location</Th>
              <Th>Assigned</Th>
              <Th>Came in as</Th>
              <Th>Clock-in</Th>
              <Th>Flag</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.emp_id}-${r.date}`} className="border-b border-[color:var(--border)] last:border-0">
                <Td className="tabular">{formatDateDMY(r.date)}</Td>
                <Td>
                  <div className="font-medium text-[color:var(--text-primary)]">{r.emp_name || r.emp_id}</div>
                  <div className="text-xs text-[color:var(--text-muted)]">
                    {r.emp_id} &middot; {r.designation}
                  </div>
                </Td>
                <Td>
                  <div className="text-[color:var(--text-primary)]">{r.department_name || r.department}</div>
                  {r.department_name && <div className="text-xs text-[color:var(--text-muted)]">{r.department}</div>}
                </Td>
                <Td>{r.location_id}</Td>
                <Td>
                  <ShiftPill>{shiftLabel(r.shift_code)}</ShiftPill>
                </Td>
                <Td>
                  <ShiftPill
                    title={r.derived_bucket && r.derived_bucket !== r.assigned_bucket ? "Clocked in during a different shift's window" : undefined}
                  >
                    {shiftLabel(BUCKET_TO_CODE[r.derived_bucket] ?? r.derived_bucket)}
                  </ShiftPill>
                </Td>
                <Td className="tabular">{minutesToClock(r.first_in_min)}</Td>
                <Td>
                  <span className="font-semibold" style={{ color: FLAG_COLOR[r.flag] ?? "var(--text-primary)" }}>
                    {r.flag}
                  </span>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[color:var(--text-muted)]">
                  No rows in range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-[color:var(--text-muted)]">
        <span>{total.toLocaleString()} total rows</span>
        <div className="flex items-center gap-2">
          <PageBtn disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Prev
          </PageBtn>
          <span>
            Page {page} / {lastPage}
          </span>
          <PageBtn disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>
            Next
          </PageBtn>
        </div>
      </div>
    </div>
  );
}

function Th({ children }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
function PageBtn({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-[color:var(--border-strong)] px-2 py-1 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
