import { minutesToClock } from "../lib/format";

const FLAG_COLOR = { Early: "var(--early)", "On-time": "var(--ontime)", Late: "var(--late)" };

export default function OutliersTable({ data, page, pageSize, onPageChange }) {
  if (!data) return null;
  const { total, rows } = data;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[22%]" />
            <col className="w-[15%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[color:var(--border)] text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <Th>Date</Th>
              <Th>Employee</Th>
              <Th>Designation</Th>
              <Th>Department</Th>
              <Th>Location</Th>
              <Th>Shift</Th>
              <Th>Clock-in</Th>
              <Th>Flag</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.emp_id}-${r.date}`} className="border-b border-[color:var(--border)] last:border-0">
                <Td className="tabular">{r.date}</Td>
                <Td>
                  <div className="font-medium text-[color:var(--text-primary)]">{r.emp_name || r.emp_id}</div>
                  <div className="text-xs text-[color:var(--text-muted)]">{r.emp_id}</div>
                </Td>
                <Td>{r.designation}</Td>
                <Td>{r.department}</Td>
                <Td>{r.location_id}</Td>
                <Td>{r.shift_code}</Td>
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
