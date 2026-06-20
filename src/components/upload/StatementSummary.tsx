import { formatMoney } from "@/lib/upload";

export type BalanceStatus = "passed" | "review" | "limited";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

const balanceBadge: Record<BalanceStatus, { label: string; tone: string; dot: string }> = {
  passed: { label: "Passed", tone: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  review: { label: "Needs review", tone: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  limited: { label: "Limited", tone: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

export function StatementSummary({
  source,
  fileName,
  pageCount,
  rowsFound,
  openingBalance,
  closingBalance,
  balanceStatus,
  parserWarningCount,
  rowWarningCount,
}: {
  source: "real-parser" | "mock-fallback";
  fileName: string;
  pageCount: number | null;
  rowsFound: number;
  openingBalance: number | null;
  closingBalance: number | null;
  balanceStatus: BalanceStatus;
  parserWarningCount: number;
  rowWarningCount: number;
}) {
  const badge = balanceBadge[balanceStatus];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-600">
            Statement summary
          </p>
          <p className="mt-1 truncate text-lg font-semibold text-slate-900">
            {fileName}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${badge.tone}`}
        >
          <span className={`h-2 w-2 rounded-full ${badge.dot}`} />
          Balance check: {badge.label}
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          label="Source"
          value={source === "real-parser" ? "Real parser" : "Sample data"}
        />
        <Stat label="Pages detected" value={pageCount !== null ? String(pageCount) : "—"} />
        <Stat label="Rows found" value={String(rowsFound)} />
        <Stat label="Parser warnings" value={String(parserWarningCount)} />
        <Stat label="Opening balance" value={formatMoney(openingBalance)} />
        <Stat label="Closing balance" value={formatMoney(closingBalance)} />
        <Stat label="Balance check" value={badge.label} />
        <Stat label="Row warnings" value={String(rowWarningCount)} />
      </dl>
    </div>
  );
}
