import type { ParserDiagnostics, ParserQuality } from "@/lib/parser-diagnostics";

// Developer-only diagnostics. Render only when NODE_ENV !== "production"
// (the caller is responsible for that gate). Shows safe aggregate metrics — no
// raw statement text, descriptions, amounts, balances, or account numbers.

const qualityTone: Record<ParserQuality, string> = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "needs-review": "bg-amber-50 text-amber-800 ring-amber-200",
  poor: "bg-red-50 text-red-700 ring-red-200",
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

const balanceLabel = {
  passed: "Passed",
  "needs-review": "Needs review",
  limited: "Limited",
} as const;

const kindLabel = {
  "credit-card": "Credit card",
  "bank-account": "Bank account",
  unknown: "Unknown",
} as const;

const familyLabel = {
  "credit-card-table": "Credit-card table",
  "bank-account-table": "Bank-account table",
  unknown: "Unknown",
} as const;

export function ParserDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: ParserDiagnostics;
}) {
  const d = diagnostics;
  return (
    <section className="rounded-2xl border border-dashed border-slate-400 bg-slate-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Parser diagnostics{" "}
            <span className="font-normal text-slate-500">(development only)</span>
          </h2>
          <p className="text-xs text-slate-500">
            Safe aggregate metrics for testing. Not a public accuracy claim.
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${qualityTone[d.quality]}`}
        >
          Quality: {d.qualityLabel}
        </span>
      </div>

      <p className="mt-3 text-xs text-slate-600">{d.qualityReason}</p>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Metric label="Source" value={d.source === "real-parser" ? "Real parser" : "Sample data"} />
        <Metric label="Statement kind" value={kindLabel[d.statementKind]} />
        <Metric label="Layout family" value={familyLabel[d.layoutFamily]} />
        <Metric label="Balance mode" value={d.balanceMode === "credit-card" ? "Credit card" : "Bank account"} />
        <Metric label="Page count" value={d.pageCount !== null ? String(d.pageCount) : "—"} />
        <Metric label="Total rows" value={String(d.totalRows)} />
        <Metric label="Parser warnings" value={String(d.parserWarningCount)} />
        <Metric label="Low-confidence rows" value={String(d.lowConfidenceCount)} />
        <Metric label="Rows missing date" value={String(d.rowsMissingDate)} />
        <Metric label="Rows missing description" value={String(d.rowsMissingDescription)} />
        <Metric label="Rows missing debit/credit" value={String(d.rowsMissingDebitCredit)} />
        <Metric label="Balance status" value={balanceLabel[d.balanceStatus]} />
        <Metric label="Opening detected" value={yesNo(d.openingDetected)} />
        <Metric label="Closing detected" value={yesNo(d.closingDetected)} />
        <Metric label="Extractable text" value={yesNo(d.extractableTextDetected)} />
      </dl>

      {d.parseStats ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-700">Layout parse</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="Chosen candidate" value={d.parseStats.candidate} />
            <Metric label="Candidate score" value={String(d.parseStats.candidateScore)} />
            <Metric label="Candidates tried" value={String(d.parseStats.candidatesTried)} />
            <Metric label="Credit-card table" value={yesNo(d.parseStats.creditCardTableDetected)} />
            <Metric label="Bank-account table" value={yesNo(d.parseStats.bankAccountTableDetected)} />
            <Metric label="Sections detected" value={String(d.parseStats.transactionSectionsDetected)} />
            <Metric label="Rows attempted" value={String(d.parseStats.rowsAttempted)} />
            <Metric label="Rows completed" value={String(d.parseStats.rowsCompleted)} />
            <Metric label="Amount column rows" value={String(d.parseStats.amountColumnRows)} />
            <Metric label="Debit column rows" value={String(d.parseStats.debitColumnRows)} />
            <Metric label="Credit column rows" value={String(d.parseStats.creditColumnRows)} />
            <Metric label="Balance column rows" value={String(d.parseStats.balanceColumnRows)} />
            <Metric label="Ignored summary rows" value={String(d.parseStats.ignoredSummaryRows)} />
            <Metric label="Ignored spend-report rows" value={String(d.parseStats.ignoredSpendReportRows)} />
          </dl>
        </div>
      ) : null}

      {d.creditCardStats ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-700">Credit-card parse</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Metric
              label="Tx section detected"
              value={yesNo(d.creditCardStats.transactionSectionDetected)}
            />
            <Metric label="Same-line date rows" value={String(d.creditCardStats.sameLineDateRows)} />
            <Metric label="Split-line date rows" value={String(d.creditCardStats.splitLineDateRows)} />
            <Metric label="Amount lines" value={String(d.creditCardStats.amountLinesDetected)} />
            <Metric label="Reference lines ignored" value={String(d.creditCardStats.referenceLinesIgnored)} />
            <Metric label="Blocks attempted" value={String(d.creditCardStats.blocksAttempted)} />
            <Metric label="Blocks completed" value={String(d.creditCardStats.blocksCompleted)} />
            <Metric label="Stop phrases seen" value={String(d.creditCardStats.stopPhraseSeen)} />
            <Metric label="Stop phrases ignored" value={String(d.creditCardStats.stopPhraseIgnored)} />
            <Metric label="Rows after ignored stop" value={String(d.creditCardStats.rowsAfterIgnoredStop)} />
            <Metric label="Stop reason used" value={d.creditCardStats.stopReason ?? "—"} />
            <Metric
              label="Last tx date"
              value={d.creditCardStats.lastTransactionDate ?? "—"}
            />
            <Metric
              label="Last tx index"
              value={
                d.creditCardStats.lastTransactionIndex !== null
                  ? String(d.creditCardStats.lastTransactionIndex)
                  : "—"
              }
            />
          </dl>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-xs font-medium text-slate-700">
          Parser warnings ({d.warnings.length})
        </p>
        {d.warnings.length > 0 ? (
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-600">
            {d.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-500">None.</p>
        )}
      </div>

      <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
        Raw statement text is never shown here. Screenshots of these aggregate metrics
        are safe; raw text is not, so it is not exposed even in development.
      </p>
    </section>
  );
}
