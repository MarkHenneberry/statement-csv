import { formatMoney } from "@/lib/upload";

export type BalanceStatus = "passed" | "review" | "limited";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

const balanceBadge: Record<BalanceStatus, { label: string; tone: string; dot: string }> = {
  passed: { label: "Passed", tone: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  review: { label: "Needs review", tone: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  limited: { label: "Limited", tone: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

export type ConversionBadgeTone = "green" | "amber" | "red" | "neutral";

const conversionBadgeTone: Record<ConversionBadgeTone, { tone: string; dot: string }> = {
  green: { tone: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  amber: { tone: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  red: { tone: "bg-red-50 text-red-700", dot: "bg-red-500" },
  neutral: { tone: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
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
  conversionBadge,
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
  /** Prominent conversion-state badge (verified / review / preview / unsupported). */
  conversionBadge?: { label: string; tone: ConversionBadgeTone };
}) {
  const badge = balanceBadge[balanceStatus];
  const stateBadge = conversionBadge
    ? { ...conversionBadgeTone[conversionBadge.tone], label: conversionBadge.label }
    : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-brand-600">
            Statement summary
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
            {fileName}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            stateBadge ? stateBadge.tone : badge.tone
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${stateBadge ? stateBadge.dot : badge.dot}`} />
          {stateBadge ? stateBadge.label : `Balance check: ${badge.label}`}
        </span>
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
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
