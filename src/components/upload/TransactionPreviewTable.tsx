"use client";

import {
  TransactionRow,
  deriveAmount,
  formatMoney,
  getRowWarnings,
} from "@/lib/upload";

type RowPatch = Partial<Omit<TransactionRow, "id">>;

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

const cellInput =
  "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-800 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-200";

function TextCell({
  value,
  onChange,
  ariaLabel,
  placeholder,
  title,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  // Hover text — useful for descriptions that are visually truncated.
  title?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className={`${cellInput} ${className}`}
    />
  );
}

function NumberCell({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      step="0.01"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(e) => onChange(parseNumber(e.target.value))}
      className={`${cellInput} text-right tabular-nums`}
    />
  );
}

export function TransactionPreviewTable({
  rows,
  onUpdate,
  onDelete,
  onAdd,
  showCategory = false,
}: {
  rows: TransactionRow[];
  onUpdate: (id: string, patch: RowPatch) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  // Category is optional (a Plus/Pro feature). Hidden by default so the default
  // review table stays compact and does not force horizontal scrolling.
  showCategory?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Extracted transactions
          </h3>
          <p className="text-xs text-slate-500">
            Edit any cell, delete rows, or add a missing transaction before export.
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 4a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 10 4Z" />
          </svg>
          Add row
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">No transactions</p>
          <p className="mt-1 text-sm text-slate-500">
            Every row has been removed. Add a row to rebuild the statement.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full ${showCategory ? "min-w-[800px]" : "min-w-[680px]"} table-fixed border-collapse text-sm`}>
            <colgroup>
              <col className="w-6" />
              {/* Date: stable width that always fits a full YYYY-MM-DD. */}
              <col className="w-[104px]" />
              {/* Description: the only flexible column — absorbs remaining width. */}
              <col />
              <col className="w-[96px]" />
              <col className="w-[96px]" />
              {/* Amount: fits "-$1,077.06" plus the read-only icon. */}
              <col className="w-[116px]" />
              {/* Balance: fits values like "302,242.50". */}
              <col className="w-[104px]" />
              {showCategory ? <col className="w-[120px]" /> : null}
              <col className="w-9" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-1.5 py-1.5" aria-label="Status" />
                <th className="px-1.5 py-1.5 font-medium">Date</th>
                <th className="px-1.5 py-1.5 font-medium">Description</th>
                <th className="px-1.5 py-1.5 text-right font-medium">Debit</th>
                <th className="px-1.5 py-1.5 text-right font-medium">Credit</th>
                <th className="px-1.5 py-1.5 text-right font-medium">
                  <span
                    className="inline-flex cursor-help items-center gap-1"
                    title="Calculated from debit/credit"
                  >
                    Amount
                    <svg className="h-3 w-3 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v.5a.75.75 0 0 0 1.5 0v-.5ZM10 9a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 9Z" clipRule="evenodd" />
                    </svg>
                  </span>
                </th>
                <th className="px-1.5 py-1.5 text-right font-medium">Balance</th>
                {showCategory ? <th className="px-1.5 py-1.5 font-medium">Category</th> : null}
                <th className="px-1.5 py-1.5" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const warnings = getRowWarnings(row);
                const flagged = warnings.length > 0;
                const amount = deriveAmount(row.debit, row.credit);
                return (
                  <tr
                    key={row.id}
                    className={flagged ? "bg-amber-50/60" : "hover:bg-slate-50/60"}
                  >
                    <td className="px-1.5 py-1 align-top">
                      {flagged ? (
                        <span
                          className="inline-flex h-5 w-5 items-center justify-center text-amber-500"
                          title={warnings.join(" ")}
                          aria-label={warnings.join(" ")}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path
                              fillRule="evenodd"
                              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-1 py-1 align-top">
                      <TextCell
                        ariaLabel="Date"
                        value={row.date}
                        placeholder="YYYY-MM-DD"
                        title={row.date}
                        className="tabular-nums"
                        onChange={(v) => onUpdate(row.id, { date: v })}
                      />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <TextCell
                        ariaLabel="Description"
                        value={row.description}
                        placeholder="Description"
                        title={row.description}
                        onChange={(v) => onUpdate(row.id, { description: v })}
                      />
                      {warnings.length > 0 ? (
                        // One compact line keeps flagged rows from growing tall.
                        <p className="px-2 pt-0.5 text-xs leading-snug text-amber-700">
                          {warnings.join(" · ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-1 py-1 align-top">
                      <NumberCell
                        ariaLabel="Debit"
                        value={row.debit}
                        onChange={(v) =>
                          // Entering a debit clears any credit so the two never disagree.
                          onUpdate(row.id, v !== null ? { debit: v, credit: null } : { debit: v })
                        }
                      />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <NumberCell
                        ariaLabel="Credit"
                        value={row.credit}
                        onChange={(v) =>
                          // Entering a credit clears any debit so the two never disagree.
                          onUpdate(row.id, v !== null ? { credit: v, debit: null } : { credit: v })
                        }
                      />
                    </td>
                    <td className="px-1.5 py-1 align-top">
                      <div
                        className="flex items-center justify-end gap-1 rounded-md bg-slate-50 px-2 py-1 text-sm tabular-nums text-slate-500"
                        title="Calculated from debit/credit"
                        aria-label={`Amount, calculated from debit and credit: ${formatMoney(amount)}`}
                      >
                        <svg className="h-3 w-3 flex-none text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M8 1a3 3 0 0 0-3 3v3H4.5A1.5 1.5 0 0 0 3 8.5v7A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 15.5 7H15V4a3 3 0 0 0-3-3H8Zm4 6V4a2 2 0 1 0-4 0v3h4Z" clipRule="evenodd" />
                        </svg>
                        {formatMoney(amount)}
                      </div>
                    </td>
                    <td className="px-1 py-1 align-top">
                      <NumberCell
                        ariaLabel="Balance"
                        value={row.balance}
                        onChange={(v) => onUpdate(row.id, { balance: v })}
                      />
                    </td>
                    {showCategory ? (
                      <td className="px-1 py-1 align-top">
                        <TextCell
                          ariaLabel="Category"
                          value={row.category}
                          placeholder="Category"
                          onChange={(v) => onUpdate(row.id, { category: v })}
                        />
                      </td>
                    ) : null}
                    <td className="px-1.5 py-1 text-right align-top">
                      <button
                        type="button"
                        onClick={() => onDelete(row.id)}
                        aria-label="Delete row"
                        className="rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M8.75 1a1 1 0 0 0-.95.69L7.56 2.5H4a.75.75 0 0 0 0 1.5h.293l.81 11.34A2 2 0 0 0 7.9 17h4.2a2 2 0 0 0 1.997-1.66L14.907 4H15.2a.75.75 0 0 0 0-1.5h-3.56l-.24-.81A1 1 0 0 0 10.45 1h-1.7Zm2.45 5.25a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5ZM8.3 6.25a.75.75 0 0 0-1.5 0l.25 6.5a.75.75 0 0 0 1.5-.058L8.3 6.25Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
