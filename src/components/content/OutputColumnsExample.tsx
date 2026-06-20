// Reusable "what the output looks like" table. Pages can pass their own rows /
// title / caption so the example varies and pages do not duplicate content.

export type OutputRow = {
  date: string;
  description: string;
  debit: string;
  credit: string;
  amount: string;
  balance: string;
};

const defaultRows: OutputRow[] = [
  { date: "2024-05-02", description: "Payroll Deposit", debit: "", credit: "2,200.00", amount: "2,200.00", balance: "4,200.00" },
  { date: "2024-05-03", description: "Grocery Mart #214", debit: "84.20", credit: "", amount: "-84.20", balance: "4,115.80" },
  { date: "2024-05-05", description: "Coffee Roasters", debit: "5.75", credit: "", amount: "-5.75", balance: "4,110.05" },
  { date: "2024-05-07", description: "Hydro One Pre-Auth", debit: "142.50", credit: "", amount: "-142.50", balance: "3,967.55" },
  { date: "2024-05-09", description: "e-Transfer Received", debit: "", credit: "300.00", amount: "300.00", balance: "4,267.55" },
];

const columns: { key: keyof OutputRow; label: string; align?: "right" }[] = [
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "debit", label: "Debit", align: "right" },
  { key: "credit", label: "Credit", align: "right" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "balance", label: "Balance", align: "right" },
];

export function OutputColumnsExample({
  title = "Example output",
  caption = "Columns adapt to what your statement provides.",
  rows = defaultRows,
  className = "",
}: {
  title?: string;
  caption?: string;
  rows?: OutputRow[];
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white ${className}`}>
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className="text-slate-700">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-2 ${
                      c.align === "right" ? "text-right tabular-nums" : ""
                    } ${c.key === "amount" && row.amount.startsWith("-") ? "text-slate-700" : ""}`}
                  >
                    {row[c.key] || <span className="text-slate-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption ? (
        <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
