import { BalanceCheck, formatMoney, resolveBalanceStatus } from "@/lib/upload";
import type { StatementValidationStatus } from "@/lib/statement-model";

function Line({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className={strong ? "font-medium text-slate-900" : "text-slate-600"}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          strong ? "font-semibold text-slate-900" : "text-slate-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function BalanceCheckPanel({
  check,
  validationStatus,
}: {
  check: BalanceCheck;
  /** The full validation status; overrides the bare arithmetic check when stronger. */
  validationStatus?: StatementValidationStatus;
}) {
  const { difference } = check;

  // Use the validation-aware status so this badge never reads "Passed" when the
  // engine determined the parse missed the statement's summary activity.
  const status = resolveBalanceStatus(check, validationStatus);
  const badge = {
    passed: { label: "Passed", tone: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
    review: { label: "Needs review", tone: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
    limited: { label: "Limited", tone: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  }[status];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">Balance checks</h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${badge.tone}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
          {badge.label}
        </span>
      </div>

      <div className="mt-4 divide-y divide-slate-100">
        <Line label="Opening balance" value={formatMoney(check.openingBalance)} />
        <Line label="Total credits" value={formatMoney(check.totalCredits)} />
        <Line label="Total debits" value={formatMoney(check.totalDebits)} />
        <Line
          label="Expected closing balance"
          value={formatMoney(check.expectedClosing)}
          strong
        />
        <Line
          label="Statement closing balance"
          value={formatMoney(check.statementClosing)}
        />
        <Line label="Difference" value={formatMoney(difference)} strong />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Balance checks help catch missing or misread transactions before export.
        {status === "limited"
          ? " Opening or closing balance was not found, so this check is limited — review the rows carefully."
          : status === "passed"
            ? " The extracted totals match the statement's closing balance, but please still review the rows."
            : difference !== null && difference !== 0
              ? " The totals do not match the statement's closing balance yet — review the rows for a missing or misread transaction."
              : " The parsed transactions do not match the statement's summary totals — the transaction table was likely missed. Review the rows before exporting."}
      </p>
    </div>
  );
}
