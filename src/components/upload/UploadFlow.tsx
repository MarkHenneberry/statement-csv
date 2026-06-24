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
import { SCANNED_PDF_WARNING } from "@/lib/review-messages";
import type {
  ParseStatementResponse,
  StatementKind,
  LayoutFamily,
  CreditCardParseStats,
  LayoutParseStats,
} from "@/lib/parser";
import type { StatementValidation } from "@/lib/statement-model";
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
    });
    setStatus("preview");
  }

  async function runParse() {
    if (!file) return;
    setStatus("processing");
    setActiveStep(0);
    setErrorMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse-statement", { method: "POST", body: form });
      const data = (await res.json()) as ParseStatementResponse;
      if (!data.ok) {
        setErrorMessage(
          data.warnings[0] ??
            "We couldn't convert this statement. You can load the sample preview instead.",
        );
        setStatus("error");
        return;
      }
      applyResult(data);
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
    setMeta(null);
    setRows([]);
    setActiveStep(0);
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

  if (status === "processing") {
    return <ProcessingSteps activeStep={activeStep} fileName={file?.name} />;
  }

  if (status === "error") {
    return (
      <div className="mx-auto max-w-xl">
        <UploadWarning variant="error" title="We couldn't convert this statement">
          {errorMessage}
        </UploadWarning>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={runParse}
            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={loadSample}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Load sample preview
          </button>
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center justify-center rounded-lg px-5 py-3 text-base font-medium text-slate-600 transition hover:text-slate-900"
          >
            Choose another file
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
    const presentation = conversionPresentation({
      balanceStatus,
      confidence: meta.validation?.confidence ?? (balanceStatus === "passed" ? 1 : 0),
      rowCount: rows.length,
      materialWarningCount,
      minorWarningCount,
      summaryMatched: null,
      previewLimited: meta.previewLimited,
      unsupported,
    });

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
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Review your conversion
          </h1>
          <div className="flex items-center gap-2">
            {meta.source === "real-parser" ? (
              <button
                type="button"
                onClick={loadSample}
                className="text-sm font-medium text-slate-500 transition hover:text-slate-800"
              >
                Load sample preview
              </button>
            ) : null}
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <span aria-hidden="true">&larr;</span> Convert another statement
            </button>
          </div>
        </div>

        {meta.source === "mock-fallback" ? (
          <UploadWarning variant="info" title="Showing sample data">
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
            <UploadWarning variant={presentation.bannerVariant} title={presentation.bannerTitle}>
              <p>{presentation.bannerBody}</p>
              {presentation.secondaryCopy ? (
                <p className="mt-1 text-sm opacity-90">{presentation.secondaryCopy}</p>
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
              className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${container}`}
            >
              <div className="max-w-xl">
                <p className={`text-sm font-semibold ${titleColor}`}>{heading}</p>
                <p className={`mt-0.5 text-sm ${noteColor}`}>{presentation.exportNote}</p>
              </div>
              <TransactionExportButtons
                rows={rows}
                sourceFileName={meta.fileName}
                labelPrefix={presentation.exportLabelPrefix ?? undefined}
              />
            </div>
          );
        })()}

        {/* Table gets priority width; the balance panel is a compact sidebar that
            stacks below on smaller screens. */}
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="lg:col-span-3">
            <TransactionPreviewTable
              rows={rows}
              onUpdate={updateRow}
              onDelete={deleteRow}
              onAdd={addRow}
              showCategory={false}
            />
          </div>
          <div className="lg:col-span-1">
            <BalanceCheckPanel check={check} validationStatus={validationStatus} />
          </div>
        </div>

        <p className="text-xs leading-relaxed text-slate-500">
          <span className="font-medium text-slate-600">Debit</span> means money out, such as
          purchases, withdrawals, fees, or charges.{" "}
          <span className="font-medium text-slate-600">Credit</span> means money in, such as
          deposits, payments, or refunds.
        </p>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm text-slate-600">
            Export the reviewed rows as a CSV or Excel file for spreadsheets, bookkeeping,
            or accounting software. Nothing is uploaded or stored.
          </p>
          <TransactionExportButtons rows={rows} sourceFileName={meta.fileName} />
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
