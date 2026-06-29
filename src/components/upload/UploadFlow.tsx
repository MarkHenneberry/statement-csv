"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  TransactionRow,
  PROCESSING_STEPS,
  blankRow,
  computeBalanceCheck,
  resolveBalanceStatus,
  countFlaggedRows,
  countLowConfidence,
  countRowWarningSeverity,
  createMockStatement,
  type BalanceMode,
} from "@/lib/upload";
import { conversionPresentation } from "@/lib/conversion-state";
import { dispatchQuotaUpdated } from "@/lib/client-events";
import { SCANNED_PDF_WARNING } from "@/lib/review-messages";
import type {
  ParseStatementResponse,
  StatementKind,
  LayoutFamily,
  CreditCardParseStats,
  LayoutParseStats,
} from "@/lib/parser";
import type { StatementValidation } from "@/lib/statement-model";
import { buttonClasses } from "@/components/Button";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { ProcessingSteps } from "@/components/upload/ProcessingSteps";
import {
  StatementSummary,
  type BalanceStatus,
} from "@/components/upload/StatementSummary";
import { TransactionPreviewTable } from "@/components/upload/TransactionPreviewTable";
import { BalanceCheckPanel } from "@/components/upload/BalanceCheckPanel";
import { TransactionExportButtons } from "@/components/upload/TransactionExportButtons";
import { UploadWarning } from "@/components/upload/UploadWarning";
import { ParserDiagnosticsPanel } from "@/components/upload/ParserDiagnosticsPanel";
import { buildParserDiagnostics, shouldShowDiagnostics } from "@/lib/parser-diagnostics";
import type { AiAssistOutcome } from "@/lib/ai-assist";

type Status = "upload" | "processing" | "preview" | "error";

// Mirrors GET /api/preview-status (safe metadata only).
type PreviewStatus = {
  mode: "paid" | "preview";
  signedIn: boolean;
  previewPageLimit?: number;
  previewWindowHours?: number;
  previewPagesRemaining?: number;
  paidPagesRemaining?: number;
  monthlyPageAllowance?: number;
};

type RowPatch = Partial<Omit<TransactionRow, "id">>;

type PreviewMeta = {
  source: "real-parser" | "mock-fallback";
  statementKind: StatementKind;
  layoutFamily: LayoutFamily;
  fileName: string;
  pageCount: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  parserWarnings: string[];
  previewLimited: boolean;
  pagesProcessed: number | null;
  meaningfulPagesDetected?: number;
  skippedMeaningfulPagesCount?: number;
  previewLimitedReason?: string;
  runtimeEnv?: string;
  creditCardStats?: CreditCardParseStats;
  parseStats?: LayoutParseStats;
  validation?: StatementValidation;
  aiAssist?: AiAssistOutcome;
  /** Page-credit billing summary (safe metadata) for this conversion. */
  billing?: ParseStatementResponse["billing"];
};

// Safe diagnostics may be shown in production behind an explicit opt-in flag so we
// can diagnose deployment-specific behavior (e.g. the vision render path) without
// exposing any statement content. NEXT_PUBLIC_ is inlined at build time.
const showDiagnostics = shouldShowDiagnostics({
  nodeEnv: process.env.NODE_ENV,
  showFlag: process.env.NEXT_PUBLIC_SHOW_DEBUG_DIAGNOSTICS,
});

function balanceModeForKind(kind: StatementKind): BalanceMode {
  return kind === "credit-card" ? "credit-card" : "bank-account";
}

export function UploadFlow() {
  const [status, setStatus] = useState<Status>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [meta, setMeta] = useState<PreviewMeta | null>(null);
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [billingError, setBillingError] =
    useState<ParseStatementResponse["billingError"] | null>(null);
  const [previewBlock, setPreviewBlock] =
    useState<ParseStatementResponse["previewBlock"] | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null);

  // Server-side preview/paid quota for the upload screen. Read-only and best-effort:
  // the parse route enforces the real quota regardless of what this returns.
  function refreshPreviewStatus() {
    fetch("/api/preview-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PreviewStatus | null) => {
        if (d) setPreviewStatus(d);
      })
      .catch(() => {});
  }
  useEffect(() => {
    refreshPreviewStatus();
  }, []);

  // Advance the processing animation but never auto-jump to the preview — the
  // fetch result is what moves us forward (it sits on the last step until done).
  useEffect(() => {
    if (status !== "processing") return;
    if (activeStep >= PROCESSING_STEPS.length - 1) return;
    const t = setTimeout(() => setActiveStep((s) => s + 1), 600);
    return () => clearTimeout(t);
  }, [status, activeStep]);

  const check = useMemo(
    () =>
      meta
        ? computeBalanceCheck(
            meta.openingBalance,
            meta.closingBalance,
            rows,
            balanceModeForKind(meta.statementKind),
          )
        : null,
    [meta, rows],
  );

  function handleSelect(picked: File) {
    setFileError(null);
    setFile(picked);
  }

  function handleReject(reason: string) {
    setFile(null);
    setFileError(reason);
  }

  function applyResult(data: ParseStatementResponse) {
    setRows(data.rows);
    setMeta({
      source: data.source,
      statementKind: data.statementKind,
      layoutFamily: data.layoutFamily,
      fileName: data.fileName || file?.name || "statement.pdf",
      pageCount: data.pageCount,
      openingBalance: data.openingBalance !== null ? Number(data.openingBalance) : null,
      closingBalance: data.closingBalance !== null ? Number(data.closingBalance) : null,
      parserWarnings: data.warnings,
      previewLimited: data.previewLimited ?? false,
      pagesProcessed: data.pagesProcessed ?? null,
      meaningfulPagesDetected: data.meaningfulPagesDetected,
      skippedMeaningfulPagesCount: data.skippedMeaningfulPagesCount,
      previewLimitedReason: data.previewLimitedReason,
      runtimeEnv: data.runtimeEnv,
      creditCardStats: data.creditCardStats,
      parseStats: data.parseStats,
      validation: data.validation,
      aiAssist: data.aiAssist,
      billing: data.billing,
    });
    setStatus("preview");
  }

  async function runParse() {
    if (!file) return;
    setStatus("processing");
    setActiveStep(0);
    setErrorMessage(null);
    setBillingError(null);
    setPreviewBlock(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse-statement", { method: "POST", body: form });
      const data = (await res.json()) as ParseStatementResponse;
      if (!data.ok) {
        // Quota gate (free preview used / upgrade) — route the user, don't dead-end.
        if (data.billingError) setBillingError(data.billingError);
        if (data.previewBlock) setPreviewBlock(data.previewBlock);
        setErrorMessage(
          data.warnings[0] ??
            "We couldn't convert this statement. You can load the sample preview instead.",
        );
        setStatus("error");
        // A block doesn't change usage, but the header may be showing a stale count
        // that this block just revealed — re-sync it from the server.
        refreshPreviewStatus();
        dispatchQuotaUpdated();
        return;
      }
      applyResult(data);
      // Reflect consumed preview pages / paid credits on the upload screen + header.
      refreshPreviewStatus();
      dispatchQuotaUpdated();
    } catch {
      // Network/parse failure. Offer the sample so the flow is never a dead end.
      setErrorMessage(
        "We couldn't reach the converter. You can load the sample preview instead, or try again.",
      );
      setStatus("error");
    }
  }

  function loadSample() {
    // Mock fallback / dev helper — clearly labelled as sample data in the UI.
    const stmt = createMockStatement(file?.name ?? "sample-statement.pdf");
    setRows(stmt.rows);
    setMeta({
      source: "mock-fallback",
      statementKind: "bank-account",
      layoutFamily: "bank-account-table",
      fileName: stmt.fileName,
      pageCount: stmt.pagesUsed,
      openingBalance: stmt.openingBalance,
      closingBalance: stmt.closingBalance,
      parserWarnings: [],
      previewLimited: false,
      pagesProcessed: stmt.pagesUsed,
    });
    setErrorMessage(null);
    setStatus("preview");
  }

  function resetAll() {
    setStatus("upload");
    setFile(null);
    setFileError(null);
    setErrorMessage(null);
    setBillingError(null);
    setPreviewBlock(null);
    setMeta(null);
    setRows([]);
    setActiveStep(0);
    refreshPreviewStatus();
  }

  function updateRow(id: string, patch: RowPatch) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function deleteRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  function addRow() {
    setRows((rs) => [...rs, blankRow()]);
  }

  // After a successful review-export charge, fold the fresh totals back into the
  // billing summary so the credit note updates and a second export won't re-charge.
  function markCharged(result: { chargedPages: number; pagesRemaining: number | null }) {
    setMeta((m) =>
      m && m.billing
        ? {
            ...m,
            billing: {
              ...m.billing,
              charged: true,
              chargedPages: result.chargedPages,
              pagesRemaining: result.pagesRemaining,
            },
          }
        : m,
    );
  }

  if (status === "processing") {
    return <ProcessingSteps activeStep={activeStep} fileName={file?.name} />;
  }

  if (status === "error") {
    // Quota/billing gates get their own routing (create account / upgrade) instead
    // of "try again". A free-preview block offers Create account (signed-out only)
    // + View plans; a paid block offers View plans.
    const needsAuth = billingError === "AUTH_REQUIRED";
    const previewExhausted = billingError === "PREVIEW_LIMIT";
    const needsPlan = billingError === "PLAN_REQUIRED" || billingError === "INSUFFICIENT_PAGE_CREDITS";
    // For an exhausted preview, a signed-out visitor is offered Create account first.
    const showCreateAccount = (needsAuth || previewExhausted) && previewBlock?.signedIn !== true;
    const showViewPlans = needsPlan || previewExhausted;
    const title = previewExhausted
      ? "Free preview used"
      : needsAuth
        ? "Sign in to convert a statement"
        : needsPlan
          ? "A plan is needed to convert"
          : "We couldn't convert this statement";
    const isGate = Boolean(billingError);
    // Consistent, concise, app-standard buttons. Create account is primary when it
    // shows (signed-out preview block); otherwise View plans / Try again is primary.
    // whitespace-nowrap keeps labels on one line; the row wraps as a whole on small
    // screens instead of individual buttons turning into tall cards.
    const viewPlansVariant = showCreateAccount && !needsAuth ? "secondary" : "primary";
    return (
      <div className="mx-auto max-w-2xl">
        <UploadWarning variant={isGate ? "info" : "error"} title={title}>
          {errorMessage}
        </UploadWarning>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {needsAuth && !previewExhausted ? (
            <Link href="/login" className={buttonClasses("primary", "whitespace-nowrap")}>
              Sign in
            </Link>
          ) : null}
          {showCreateAccount ? (
            <Link
              href="/signup"
              className={buttonClasses(needsAuth ? "secondary" : "primary", "whitespace-nowrap")}
            >
              Create account
            </Link>
          ) : null}
          {showViewPlans ? (
            <Link href="/pricing" className={buttonClasses(viewPlansVariant, "whitespace-nowrap")}>
              View plans
            </Link>
          ) : null}
          {!isGate ? (
            <button
              type="button"
              onClick={runParse}
              className={buttonClasses("primary", "whitespace-nowrap")}
            >
              Try again
            </button>
          ) : null}
          <button
            type="button"
            onClick={loadSample}
            className={buttonClasses("secondary", "whitespace-nowrap")}
          >
            Load sample
          </button>
          <button
            type="button"
            onClick={resetAll}
            className={buttonClasses("ghost", "whitespace-nowrap")}
          >
            Choose file
          </button>
        </div>
      </div>
    );
  }

  if (status === "preview" && meta && check) {
    const flaggedCount = countFlaggedRows(rows);
    const lowConfidenceCount = countLowConfidence(rows);
    // User-facing status reflects the FULL validation engine, not just the
    // arithmetic identity — a coincidentally-balancing parse that missed the
    // statement's summary activity must show "Needs review", never "Passed".
    const validationStatus = meta.validation?.status;
    const balanceStatus: BalanceStatus = resolveBalanceStatus(check, validationStatus);

    // Centralized conversion presentation state (verified / review-recommended /
    // needs-review / preview-limited / unsupported). Drives badge, banner, copy,
    // and export styling so confidence is communicated consistently.
    const { material: materialWarningCount, minor: minorWarningCount } =
      countRowWarningSeverity(rows);
    const unsupported = meta.parserWarnings.includes(SCANNED_PDF_WARNING);
    // No usable transaction table: at most one row and the conversion did not pass
    // (e.g. AI rejected a fake candidate and only a lone parser row remains). Don't
    // present that single bad row as a meaningful conversion.
    const noUsableTransactionTable =
      rows.length <= 1 && balanceStatus !== "passed" && !meta.previewLimited && !unsupported;
    const presentation = conversionPresentation({
      balanceStatus,
      confidence: meta.validation?.confidence ?? (balanceStatus === "passed" ? 1 : 0),
      rowCount: rows.length,
      materialWarningCount,
      minorWarningCount,
      summaryMatched: null,
      previewLimited: meta.previewLimited,
      unsupported,
      noUsableTransactionTable,
    });

    // Export gating + credit notes.
    //  - PAID verified: already charged, export freely.
    //  - PAID review: charge (idempotent) on the server before the file is produced.
    //  - PREVIEW (verified or review): pages are consumed at parse time, so export
    //    is free here and never triggers a server charge.
    // Mock/sample data has no billing record and is never charged.
    const billing = meta.source === "real-parser" ? meta.billing : undefined;
    const isPreview = billing?.mode === "preview";
    const exportNeedsCharge =
      billing?.mode === "paid" && billing.status === "review" && !billing.charged;
    const exportConversionId = billing?.conversionId ?? null;
    let creditNote: string | null = null;
    if (billing) {
      const n = (count: number, singular: string) => `${count} ${singular}${count === 1 ? "" : "s"}`;
      if (isPreview) {
        const remainLabel =
          billing.pagesRemaining === null
            ? ""
            : ` You have ${n(billing.pagesRemaining, "free preview page")} left in this window.`;
        if (billing.charged) {
          creditNote = `This free preview used ${n(billing.chargedPages, "preview page")}.${remainLabel}`;
        } else {
          creditNote = `This preview used 0 preview pages.${remainLabel}`;
        }
      } else {
        const remainLabel =
          billing.pagesRemaining === null
            ? ""
            : ` You have ${n(billing.pagesRemaining, "page credit")} remaining.`;
        if (billing.status === "verified" && billing.charged) {
          creditNote = `This conversion used ${n(billing.chargedPages, "page credit")}.${remainLabel}`;
        } else if (billing.status === "review" && billing.charged) {
          creditNote = `Export used ${n(billing.chargedPages, "page credit")}.${remainLabel}`;
        } else if (exportNeedsCharge) {
          const req = billing.requiredPages ?? meta.pageCount ?? 0;
          creditNote = `Exporting will use ${n(req, "page credit")} when you download.${remainLabel}`;
        }
      }
    }

    // Specific issues to list under the banner (preview truncation is NOT a parse
    // problem and is communicated by the preview-limited state, so exclude it).
    const reviewReasons: string[] = meta.parserWarnings.filter(
      (w) => w !== SCANNED_PDF_WARNING && !/free preview covers the first/i.test(w),
    );
    if (check.available && !check.passed) {
      reviewReasons.push(
        "The balance check did not match the statement's closing balance.",
      );
    }
    if (validationStatus === "needs-review") {
      for (const issue of meta.validation?.issues ?? []) {
        if (!reviewReasons.includes(issue)) reviewReasons.push(issue);
      }
    }
    if (lowConfidenceCount > 0) {
      reviewReasons.push(
        `${lowConfidenceCount} low-confidence ${
          lowConfidenceCount === 1 ? "row was" : "rows were"
        } found. Check the highlighted rows.`,
      );
    }

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
            Review your conversion
          </h1>
          <div className="flex items-center gap-2">
            {meta.source === "real-parser" ? (
              <button
                type="button"
                onClick={loadSample}
                className="text-xs font-medium text-slate-500 transition hover:text-slate-800"
              >
                Load sample preview
              </button>
            ) : null}
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <span aria-hidden="true">&larr;</span> Convert another statement
            </button>
          </div>
        </div>

        {meta.source === "mock-fallback" ? (
          <UploadWarning variant="info" title="Showing sample data" dense>
            This is example data, not your statement. Use it to explore the preview,
            editing, and CSV export.
          </UploadWarning>
        ) : null}

        {(() => {
          // State-driven result banner. Copy matches the conversion state so we
          // never imply a parse failure for a preview-limited result, nor green
          // "verified" wording when the conversion still needs review.
          const showReasons =
            (presentation.state === "needs-review" ||
              presentation.state === "review-recommended") &&
            reviewReasons.length > 0;
          return (
            <UploadWarning variant={presentation.bannerVariant} title={presentation.bannerTitle} dense>
              <p>{presentation.bannerBody}</p>
              {presentation.secondaryCopy ? (
                <p className="mt-1 text-xs opacity-90">{presentation.secondaryCopy}</p>
              ) : null}
              {rows.length === 0 && presentation.state !== "unsupported" ? (
                <p className="mt-1">
                  No transaction rows were found. You can add rows manually below, or load
                  the sample preview to see how a completed conversion looks.
                </p>
              ) : null}
              {showReasons ? (
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {reviewReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </UploadWarning>
          );
        })()}

        <StatementSummary
          source={meta.source}
          fileName={meta.fileName}
          pageCount={meta.pageCount}
          rowsFound={rows.length}
          openingBalance={meta.openingBalance}
          closingBalance={meta.closingBalance}
          balanceStatus={balanceStatus}
          parserWarningCount={meta.parserWarnings.length}
          rowWarningCount={flaggedCount}
          conversionBadge={{ label: presentation.badgeLabel, tone: presentation.badgeTone }}
        />

        {(() => {
          // Prominent export area above the table. Styling + heading come from the
          // conversion state: green/safe ONLY when verified; amber for review;
          // neutral for a preview-limited (partial) export. "Ready to export" is
          // never shown for needs-review or preview-limited.
          if (!presentation.showTopExport) return null;
          const tone = presentation.exportTone;
          const container =
            tone === "safe"
              ? "border-emerald-200 bg-emerald-50"
              : tone === "review"
                ? "border-amber-300 bg-amber-50"
                : "border-slate-200 bg-slate-50";
          const titleColor =
            tone === "safe" ? "text-emerald-800" : tone === "review" ? "text-amber-800" : "text-slate-800";
          const noteColor =
            tone === "safe" ? "text-emerald-700" : tone === "review" ? "text-amber-700" : "text-slate-600";
          const heading =
            tone === "safe" ? "Ready to export" : tone === "neutral" ? "Download preview" : "Review before export";
          return (
            <div
              className={`flex flex-col gap-2 rounded-lg border p-2.5 sm:flex-row sm:items-center sm:justify-between ${container}`}
            >
              <div className="max-w-xl">
                <p className={`text-sm font-semibold ${titleColor}`}>{heading}</p>
                <p className={`mt-0.5 text-xs ${noteColor}`}>{presentation.exportNote}</p>
                {creditNote ? (
                  <p className={`mt-0.5 text-xs ${noteColor}`}>{creditNote}</p>
                ) : null}
              </div>
              <TransactionExportButtons
                rows={rows}
                sourceFileName={meta.fileName}
                labelPrefix={presentation.exportLabelPrefix ?? undefined}
                conversionId={exportConversionId}
                requiresExportCharge={exportNeedsCharge}
                onCharged={markCharged}
              />
            </div>
          );
        })()}

        {/* Desktop: table on the left, a compact fixed-width balance panel on the
            right (kept beside the table from the `lg` breakpoint up). It only stacks
            below the table on smaller screens. min-w-0 lets the table's own
            overflow handling work inside the flex row. */}
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <TransactionPreviewTable
              rows={rows}
              onUpdate={updateRow}
              onDelete={deleteRow}
              onAdd={addRow}
              showCategory={false}
              // Balance stays out of the visible table (the panel beside it shows
              // the balance verification); it remains in the CSV/Excel export.
              showBalance={false}
            />
          </div>
          <div className="w-full lg:w-[230px] lg:flex-none">
            <BalanceCheckPanel check={check} validationStatus={validationStatus} />
          </div>
        </div>

        <p className="text-[11px] leading-snug text-slate-500">
          <span className="font-medium text-slate-600">Debit</span> means money out, such as
          purchases, withdrawals, fees, or charges.{" "}
          <span className="font-medium text-slate-600">Credit</span> means money in, such as
          deposits, payments, or refunds.
        </p>

        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-section p-2.5 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <p className="text-xs text-slate-600">
              Export the reviewed rows as a CSV or Excel file for spreadsheets, bookkeeping,
              or accounting software. Nothing is uploaded or stored.
            </p>
            {creditNote ? (
              <p className="mt-0.5 text-xs text-slate-500">{creditNote}</p>
            ) : null}
          </div>
          <TransactionExportButtons
            rows={rows}
            sourceFileName={meta.fileName}
            conversionId={exportConversionId}
            requiresExportCharge={exportNeedsCharge}
            onCharged={markCharged}
          />
        </div>

        {showDiagnostics ? (
          <ParserDiagnosticsPanel
            diagnostics={buildParserDiagnostics({
              source: meta.source,
              statementKind: meta.statementKind,
              layoutFamily: meta.layoutFamily,
              pageCount: meta.pageCount,
              environmentLabel: meta.runtimeEnv,
              conversionState: presentation.state,
              openingBalance: meta.openingBalance,
              closingBalance: meta.closingBalance,
              warnings: meta.parserWarnings,
              rows,
              balanceCheck: check,
              creditCardStats: meta.creditCardStats,
              parseStats: meta.parseStats,
              validation: meta.validation,
              aiAssist: meta.aiAssist,
              preview: {
                previewLimited: meta.previewLimited,
                pagesProcessed: meta.pagesProcessed,
                meaningfulPagesDetected: meta.meaningfulPagesDetected ?? null,
                skippedMeaningfulPagesCount: meta.skippedMeaningfulPagesCount ?? null,
                previewLimitedReason: meta.previewLimitedReason ?? null,
              },
            })}
          />
        ) : null}
      </div>
    );
  }

  // Default: upload screen.
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        Convert a bank statement
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-slate-600">
        Upload a digital PDF bank statement to preview the conversion.
      </p>

      {(() => {
        // Quota line: free-preview allowance for visitors/free users, or remaining
        // paid credits for subscribers. Server-enforced; this is display only.
        if (previewStatus?.mode === "paid") {
          return (
            <p className="mt-3 text-sm font-medium text-slate-600">
              {previewStatus.paidPagesRemaining ?? 0} of {previewStatus.monthlyPageAllowance ?? 0}{" "}
              page credits remaining this month.
            </p>
          );
        }
        const limit = previewStatus?.previewPageLimit ?? 6;
        const hours = previewStatus?.previewWindowHours ?? 12;
        const remaining = previewStatus?.previewPagesRemaining;
        return (
          <p className="mt-3 text-sm font-medium text-brand-700">
            Free preview: convert up to {limit} pages every {hours} hours without an account.
            {typeof remaining === "number" ? (
              <span className="font-normal text-slate-600">
                {" "}
                {remaining} preview {remaining === 1 ? "page" : "pages"} remaining in this window.
              </span>
            ) : null}
          </p>
        );
      })()}

      <div className="mt-8 space-y-4">
        <UploadDropzone file={file} onSelect={handleSelect} onReject={handleReject} />

        {fileError ? (
          <UploadWarning variant="error" title="That file can’t be used">
            {fileError}
          </UploadWarning>
        ) : null}

        <UploadWarning variant="info" title="Use a digital PDF for best results">
          {/* TODO(launch-blocker): OCR for scanned statements is not built yet. */}
          Best results come from digital PDFs downloaded directly from your bank. Scanned
          statements may require OCR support in a future version.
        </UploadWarning>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            Balance checks help catch missing or misread transactions before export.
          </p>
          <button
            type="button"
            onClick={runParse}
            disabled={!file}
            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Preview conversion
          </button>
        </div>
      </div>

      <p className="mt-8 text-center text-sm text-slate-500">
        Not sure how it works? Read the{" "}
        <Link href="/pdf-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
          conversion guide
        </Link>{" "}
        or the{" "}
        <Link href="/faq" className="font-medium text-brand-700 hover:underline">
          FAQ
        </Link>
        .
      </p>
    </div>
  );
}
