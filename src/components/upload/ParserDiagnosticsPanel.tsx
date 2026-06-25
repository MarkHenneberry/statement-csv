import type { ParserDiagnostics, ParserQuality } from "@/lib/parser-diagnostics";
import { estimateAiCost, formatUsd } from "@/lib/ai-cost";

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

      <div className="mt-4">
        <p className="text-xs font-medium text-slate-700">Environment &amp; renderer</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Metric label="Runtime env" value={d.environmentLabel ?? "—"} />
          <Metric label="Conversion state" value={d.conversionState ?? "—"} />
          {d.aiAssist ? (
            <>
              <Metric
                label="Renderer backend available"
                value={
                  d.aiAssist.rendererBackendAvailable === null
                    ? "—"
                    : yesNo(d.aiAssist.rendererBackendAvailable)
                }
              />
              <Metric label="Renderer backend" value={d.aiAssist.rendererBackendName ?? "—"} />
              <Metric label="Renderer probe reason" value={d.aiAssist.rendererProbeReason ?? "—"} />
            </>
          ) : null}
        </dl>
      </div>

      {d.validation ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-700">Statement validation (model)</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="Validation status" value={d.validation.status} />
            <Metric label="Confidence" value={d.validation.confidence.toFixed(2)} />
            <Metric
              label="Reconciliation difference"
              value={d.validation.difference === undefined ? "—" : d.validation.difference.toFixed(2)}
            />
            <Metric label="Issues" value={String(d.validation.issues.length)} />
          </dl>
          {d.validation.issues.length > 0 ? (
            <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-600">
              {d.validation.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {d.aiAssist ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-700">AI assist (development only)</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="AI status" value={d.aiAssist.status} />
            <Metric label="Eligible" value={yesNo(d.aiAssist.eligible)} />
            <Metric
              label="Eligibility reasons"
              value={d.aiAssist.aiEligibilityReasons.length ? d.aiAssist.aiEligibilityReasons.join(", ") : "—"}
            />
            <Metric label="Skipped reason" value={d.aiAssist.aiSkippedReason ?? "—"} />
            <Metric label="Configured" value={yesNo(d.aiAssist.configured)} />
            <Metric label="Enabled" value={yesNo(d.aiAssist.enabled)} />
            <Metric label="Attempted" value={yesNo(d.aiAssist.attempted)} />
            <Metric label="Call made" value={yesNo(d.aiAssist.called)} />
            <Metric label="Response received" value={yesNo(d.aiAssist.responseReceived)} />
            <Metric label="Result applied" value={yesNo(d.aiAssist.applied)} />
            <Metric label="Model" value={d.aiAssist.model ?? "—"} />
            <Metric
              label="Missing config"
              value={d.aiAssist.missingConfig.length ? d.aiAssist.missingConfig.join(", ") : "—"}
            />
            <Metric
              label="Error label"
              value={d.aiAssist.errorLabel ?? "—"}
            />
            <Metric
              label="Pre-AI difference"
              value={d.aiAssist.preDifference === null ? "—" : d.aiAssist.preDifference.toFixed(2)}
            />
            <Metric
              label="Post-AI difference"
              value={d.aiAssist.postDifference === null ? "—" : d.aiAssist.postDifference.toFixed(2)}
            />
            <Metric
              label="Improvement"
              value={d.aiAssist.improvement === null ? "—" : d.aiAssist.improvement.toFixed(2)}
            />
            <Metric label="Adopted candidate" value={d.aiAssist.adoptedCandidateSource} />
            <Metric label="Candidates compared" value={String(d.aiAssist.candidateComparisonCount)} />
            <Metric label="AI independent candidate built" value={yesNo(d.aiAssist.aiIndependentCandidateBuilt)} />
            <Metric label="AI repair-plan built" value={yesNo(d.aiAssist.aiRepairPlanBuilt)} />
            <Metric
              label="AI candidate difference"
              value={d.aiAssist.aiCandidateDifference === null ? "—" : d.aiAssist.aiCandidateDifference.toFixed(2)}
            />
            <Metric
              label="AI repair-plan difference"
              value={d.aiAssist.aiRepairPlanDifference === null ? "—" : d.aiAssist.aiRepairPlanDifference.toFixed(2)}
            />
            <Metric label="Candidate quality" value={d.aiAssist.aiCandidateQualityStatus} />
            <Metric label="Rejected for quality" value={yesNo(d.aiAssist.aiCandidateRejectedForQuality)} />
            <Metric label="AI improved but unreconciled" value={yesNo(d.aiAssist.aiImprovedButStillUnreconciled)} />
            <Metric label="Parser rows preserved over AI" value={yesNo(d.aiAssist.parserRowsPreservedOverAiRows)} />
            <Metric
              label="Quality reasons"
              value={d.aiAssist.aiCandidateQualityReasons.length ? d.aiAssist.aiCandidateQualityReasons.join(", ") : "—"}
            />
            <Metric label="Aggregate rows" value={String(d.aiAssist.aiAggregateRowsDetected)} />
            <Metric label="Placeholder rows" value={String(d.aiAssist.aiPlaceholderRowsDetected)} />
            <Metric
              label="Itemized rows"
              value={d.aiAssist.aiItemizedRowCount === null ? "—" : String(d.aiAssist.aiItemizedRowCount)}
            />
            <Metric
              label="Missing-date rate"
              value={d.aiAssist.aiMissingDateRate === null ? "—" : d.aiAssist.aiMissingDateRate.toFixed(2)}
            />
            <Metric
              label="Low-confidence row rate"
              value={d.aiAssist.aiLowConfidenceRowRate === null ? "—" : d.aiAssist.aiLowConfidenceRowRate.toFixed(2)}
            />
            <Metric
              label="Largest row share of debits"
              value={d.aiAssist.aiLargestRowShareOfDebits === null ? "—" : d.aiAssist.aiLargestRowShareOfDebits.toFixed(2)}
            />
            <Metric label="Vision evidence count" value={String(d.aiAssist.aiVisionEvidence.length)} />
            <Metric
              label="Vision evidence order"
              value={
                d.aiAssist.aiVisionEvidence.length
                  ? d.aiAssist.aiVisionEvidence.map((m) => `${m.kind}:p${m.page}`).join(", ")
                  : "—"
              }
            />
            <Metric
              label="Vision tx image included"
              value={yesNo(d.aiAssist.aiVisionEvidence.some((m) => m.kind === "table-header" || m.kind === "table-body" || m.kind === "final-rows"))}
            />
            <Metric
              label="Vision summary image included"
              value={yesNo(d.aiAssist.aiVisionEvidence.some((m) => m.kind === "summary" || m.kind === "totals"))}
            />
            <Metric
              label="Vision min image height"
              value={d.aiAssist.aiVisionEvidence.length ? String(Math.min(...d.aiAssist.aiVisionEvidence.map((m) => m.height))) : "—"}
            />
            <Metric
              label="AI selected section"
              value={d.aiAssist.aiSelectedSectionIndex === null ? "—" : String(d.aiAssist.aiSelectedSectionIndex)}
            />
            <Metric label="AI rejected reason" value={d.aiAssist.aiRejectedReason ?? "—"} />
            <Metric label="Fallback type" value={d.aiAssist.aiFallbackType} />
            <Metric label="AI call count" value={String(d.aiAssist.aiCallCount)} />
            <Metric label="Vision used" value={yesNo(d.aiAssist.aiVisionUsed)} />
            <Metric label="Rendered pages" value={String(d.aiAssist.aiRenderedPagesCount)} />
            <Metric label="Image crops" value={String(d.aiAssist.aiImageCropsCount)} />
            <Metric label="Full-page images" value={String(d.aiAssist.aiFullPageImagesCount)} />
            <Metric
              label="Total tokens"
              value={d.aiAssist.aiTotalTokenCount === null ? "—" : String(d.aiAssist.aiTotalTokenCount)}
            />
            <Metric label="Provider response id" value={d.aiAssist.aiProviderResponseId ?? "—"} />
            <Metric label="Render failed reason" value={d.aiAssist.aiRenderFailedReason ?? "—"} />
            <Metric
              label="AI call duration"
              value={d.aiAssist.aiCallDurationMs === null ? "—" : `${d.aiAssist.aiCallDurationMs} ms`}
            />
            <Metric label="Interest/fee repair" value={yesNo(d.aiAssist.interestFeeRepairApplied)} />
            <Metric label="Interest/fee rows added" value={String(d.aiAssist.interestFeeRowsAdded)} />
            {d.aiAssist.visionSelection ? (
              <>
                <Metric
                  label="Vision pages selected"
                  value={
                    d.aiAssist.visionSelection.selectedPageIndexes.length > 0
                      ? d.aiAssist.visionSelection.selectedPageIndexes.join(", ")
                      : "—"
                  }
                />
                <Metric
                  label="Vision region kinds"
                  value={
                    d.aiAssist.visionSelection.selectedRegionKinds.length > 0
                      ? d.aiAssist.visionSelection.selectedRegionKinds.join(", ")
                      : "—"
                  }
                />
                <Metric label="Vision regions" value={String(d.aiAssist.visionSelection.selectedRegionCount)} />
                <Metric
                  label="Tx-header pages detected"
                  value={String(d.aiAssist.visionSelection.transactionHeaderPagesDetected)}
                />
                <Metric
                  label="Summary pages detected"
                  value={String(d.aiAssist.visionSelection.summaryPagesDetected)}
                />
                <Metric
                  label="Excluded legal pages"
                  value={String(d.aiAssist.visionSelection.excludedLegalPagesCount)}
                />
                <Metric
                  label="Excluded warning/reward pages"
                  value={String(d.aiAssist.visionSelection.excludedWarningRewardPagesCount)}
                />
              </>
            ) : null}
          </dl>
        </div>
      ) : null}

      {d.aiAssist ? (
        (() => {
          const a = d.aiAssist;
          const ms = (v: number | null) => (v === null ? "—" : `${v} ms`);
          const num = (v: number | null) => (v === null ? "—" : String(v));
          const cost = estimateAiCost(a.model, a.aiInputTokenCount, a.aiOutputTokenCount, a.aiTotalTokenCount);
          return (
            <div className="mt-4">
              <p className="text-xs font-medium text-slate-700">Performance &amp; cost (development only)</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <Metric label="Render duration" value={ms(a.renderDurationMs)} />
                <Metric label="AI call duration" value={ms(a.aiCallDurationMs)} />
                <Metric label="Route duration" value={ms(a.routeDurationMs)} />
                <Metric label="Fallback type" value={a.aiFallbackType} />
                <Metric label="Vision used" value={yesNo(a.aiVisionUsed)} />
                <Metric label="AI call count" value={String(a.aiCallCount)} />
                <Metric label="Image crops" value={String(a.aiImageCropsCount)} />
                <Metric label="Full-page images" value={String(a.aiFullPageImagesCount)} />
                <Metric label="Input tokens" value={num(a.aiInputTokenCount)} />
                <Metric label="Output tokens" value={num(a.aiOutputTokenCount)} />
                <Metric label="Total tokens" value={num(a.aiTotalTokenCount)} />
                <Metric
                  label="Estimated cost"
                  value={cost.available && cost.usd !== null ? `${formatUsd(cost.usd)} (${cost.note})` : cost.note}
                />
              </dl>
            </div>
          );
        })()
      ) : null}

      {d.preview ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-700">Free preview (development only)</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="Preview limited" value={yesNo(d.preview.previewLimited)} />
            <Metric label="Pages processed" value={d.preview.pagesProcessed === null ? "—" : String(d.preview.pagesProcessed)} />
            <Metric
              label="Meaningful pages detected"
              value={d.preview.meaningfulPagesDetected === null ? "—" : String(d.preview.meaningfulPagesDetected)}
            />
            <Metric
              label="Skipped meaningful pages"
              value={d.preview.skippedMeaningfulPagesCount === null ? "—" : String(d.preview.skippedMeaningfulPagesCount)}
            />
            <Metric label="Preview-limited reason" value={d.preview.previewLimitedReason ?? "—"} />
          </dl>
        </div>
      ) : null}

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
            <Metric label="Detected profile" value={d.parseStats.detectedProfile} />
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
            <Metric label="Account sections detected" value={String(d.parseStats.accountSectionsDetected)} />
            <Metric label="Chosen account section" value={d.parseStats.chosenAccountSection ?? "—"} />
            <Metric label="Ignored account sections" value={String(d.parseStats.ignoredAccountSections)} />
            <Metric label="Tx table start found" value={yesNo(d.parseStats.transactionTableStartFound)} />
            <Metric label="Summary rows used (validation)" value={String(d.parseStats.summaryRowsUsedForValidation)} />
            <Metric label="Summary rows ignored as tx" value={String(d.parseStats.summaryRowsIgnoredAsTransactions)} />
            <Metric label="Balance-forward rows handled" value={String(d.parseStats.balanceForwardRowsHandled)} />
            <Metric label="Final running balance as closing" value={yesNo(d.parseStats.finalRunningBalanceUsedAsClosing)} />
            <Metric label="Out-of-period rows rejected" value={String(d.parseStats.outOfPeriodRowsRejected)} />
            <Metric label="Account-fee summary rows ignored" value={String(d.parseStats.accountFeeSummaryRowsIgnored)} />
            <Metric label="Subtotal rows ignored" value={String(d.parseStats.subtotalRowsIgnored)} />
            <Metric label="Summary/statistical rows rejected" value={String(d.parseStats.summaryStatisticalRowsRejected)} />
            <Metric label="Legal/info rows ignored after table" value={String(d.parseStats.legalInfoRowsIgnored)} />
            <Metric label="Payment/remittance rows ignored" value={String(d.parseStats.paymentRemittanceRowsIgnored)} />
            <Metric label="FX detail rows attached" value={String(d.parseStats.fxRowsAttached)} />
            <Metric label="Fee count/rate rows normalized" value={String(d.parseStats.feeCountRateRowsNormalized)} />
            <Metric label="Account section opening source" value={d.parseStats.accountSectionOpeningSource ?? "—"} />
            <Metric label="Section had opening & closing" value={yesNo(d.parseStats.selectedSectionHadOpeningClosing)} />
          </dl>

          <p className="mt-4 text-xs font-medium text-slate-700">Coordinate-aware table extraction</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="Chosen candidate source" value={d.parseStats.chosenCandidateSource} />
            <Metric label="Coordinate extraction available" value={yesNo(d.parseStats.coordinateExtractionAvailable)} />
            <Metric label="Table candidates found" value={String(d.parseStats.tableCandidatesFound)} />
            <Metric label="Chosen table type" value={d.parseStats.chosenTableType ?? "—"} />
            <Metric label="Header columns detected" value={String(d.parseStats.coordHeaderColumnsDetected)} />
            <Metric label="Column order detected" value={d.parseStats.coordColumnOrder ?? "—"} />
            <Metric label="Rows built from table" value={String(d.parseStats.coordRowsBuilt)} />
            <Metric label="Dateless rows promoted" value={String(d.parseStats.coordDatelessRowsPromoted)} />
            <Metric label="Wrapped descriptions joined" value={String(d.parseStats.coordWrappedDescriptionsJoined)} />
            <Metric label="FX detail lines attached" value={String(d.parseStats.coordFxDetailLinesAttached)} />
            <Metric label="Summary rows ignored (table)" value={String(d.parseStats.coordSummaryRowsIgnored)} />
            <Metric label="Footer/legal rows ignored (table)" value={String(d.parseStats.coordFooterLegalRowsIgnored)} />
            <Metric
              label="Final balance difference"
              value={d.parseStats.finalBalanceDifference === null ? "—" : d.parseStats.finalBalanceDifference.toFixed(2)}
            />
          </dl>

          <p className="mt-4 text-xs font-medium text-slate-700">
            Coordinate header probe{" "}
            <span className="font-normal text-slate-500">
              (why table detection did/didn&apos;t find a header — no raw text)
            </span>
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="Items present" value={yesNo(d.parseStats.coordHeaderProbe.coordinateItemsPresent)} />
            <Metric label="Visual lines" value={String(d.parseStats.coordHeaderProbe.visualLineCount)} />
            <Metric label="Max items / line" value={String(d.parseStats.coordHeaderProbe.maxItemsPerLine)} />
            <Metric label="Table regions found" value={String(d.parseStats.coordHeaderProbe.tableRegionsFound)} />
            <Metric label="Lines with header token" value={String(d.parseStats.coordHeaderProbe.linesWithAnyHeaderToken)} />
            <Metric label="Best distinct meanings / line" value={String(d.parseStats.coordHeaderProbe.bestDistinctMeaningsOnALine)} />
            <Metric label="Anchor but no value col" value={String(d.parseStats.coordHeaderProbe.linesWithAnchorButNoValue)} />
            <Metric label="Value but no anchor col" value={String(d.parseStats.coordHeaderProbe.linesWithValueButNoAnchor)} />
            <Metric label="Relaxed header matches" value={String(d.parseStats.coordHeaderProbe.relaxedHeaderMatches)} />
            <Metric label="Split/stacked headers merged" value={String(d.parseStats.coordHeaderProbe.splitHeaderCandidates)} />
            <Metric label="Headerless candidate available" value={yesNo(d.parseStats.coordHeaderProbe.headerlessCandidateAvailable)} />
            <Metric label="Stitched candidates tried" value={String(d.parseStats.coordHeaderProbe.stitchCandidatesTried)} />
            <Metric label="Regions stitched" value={String(d.parseStats.coordHeaderProbe.stitchRegionsStitched)} />
            <Metric label="Stitch rejections" value={String(d.parseStats.coordHeaderProbe.stitchRejectedCount)} />
            <Metric
              label="Stitch reject reasons"
              value={
                Object.entries(d.parseStats.coordHeaderProbe.stitchRejectReasons)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(", ") || "—"
              }
            />
            <Metric label="Relaxed-compat stitches" value={String(d.parseStats.coordHeaderProbe.stitchRelaxedCompatibilityUsed)} />
            <Metric label="Chosen candidate stitched" value={yesNo(d.parseStats.coordStitched)} />
            <Metric label="Chosen regions stitched" value={String(d.parseStats.coordRegionsStitched)} />
            <Metric label="CC rows rejected as non-tx" value={String(d.parseStats.coordCcRowsRejectedAsNonTx)} />
            <Metric label="CC zero-amount rows ignored" value={String(d.parseStats.coordCcZeroAmountRowsIgnored)} />
            <Metric label="Statement period detected" value={yesNo(d.parseStats.statementPeriodDetected)} />
            <Metric label="Date year source" value={d.parseStats.inferredDateYearSource} />
            <Metric label="Rows missing date" value={String(d.parseStats.rowsMissingDateAfterNormalization)} />
            <Metric label="Malformed dates" value={String(d.parseStats.malformedDatesAfterNormalization)} />
            <Metric label="CC optional columns ignored" value={String(d.parseStats.coordCcOptionalColumnsIgnored)} />
            <Metric label="Category column context" value={yesNo(d.parseStats.categoryColumnContextDetected)} />
            <Metric label="Ambiguous categories stripped" value={String(d.parseStats.ambiguousCategoriesStripped)} />
            <Metric label="Metadata categories captured" value={String(d.parseStats.metadataCategoriesCaptured)} />
            <Metric label="Rows date inherited" value={String(d.parseStats.rowsDateInherited)} />
            <Metric label="Rows still missing date" value={String(d.parseStats.rowsStillMissingDate)} />
            <Metric label="e-Transfer descriptions normalized" value={String(d.parseStats.eTransferDescriptionsNormalized)} />
            <Metric label="Raw reference fragments removed" value={String(d.parseStats.rawReferenceFragmentsRemoved)} />
            <Metric label="Formula/rate fee rows" value={String(d.parseStats.formulaRateRowsDetected)} />
            <Metric label="Fee rows → posted amount" value={String(d.parseStats.formulaRateRowsResolvedToPostedAmount)} />
            <Metric label="Fee rows → computed total" value={String(d.parseStats.formulaRateRowsUsedComputedTotal)} />
            <Metric label="Page-bottom rows recovered" value={String(d.parseStats.pageBottomRowsRecovered)} />
            <Metric label="Rows accepted without balance" value={String(d.parseStats.rowsAcceptedWithoutRunningBalance)} />
          </dl>

          {d.parseStats.candidateComparison.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-slate-500">
                    <th className="px-2 py-1 font-medium">Candidate</th>
                    <th className="px-2 py-1 text-right font-medium">Score</th>
                    <th className="px-2 py-1 text-right font-medium">Rows</th>
                    <th className="px-2 py-1 text-right font-medium">Credits</th>
                    <th className="px-2 py-1 text-right font-medium">Debits</th>
                    <th className="px-2 py-1 font-medium">Open/Close</th>
                    <th className="px-2 py-1 font-medium">Balance</th>
                    <th className="px-2 py-1 text-right font-medium">Diff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {d.parseStats.candidateComparison.map((c, ci) => (
                    <tr
                      key={`${c.name}-${ci}`}
                      className={c.name === d.parseStats!.candidate ? "bg-emerald-50" : ""}
                    >
                      <td className="px-2 py-1">{c.name}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.score}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.rowCount}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.totalCredits.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.totalDebits.toFixed(2)}</td>
                      <td className="px-2 py-1">{yesNo(c.openingDetected)}/{yesNo(c.closingDetected)}</td>
                      <td className="px-2 py-1">{c.balanceStatus}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {c.balanceDiff === null ? "—" : c.balanceDiff.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
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
