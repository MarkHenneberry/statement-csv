"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  TransactionRow,
  PROCESSING_STEPS,
  blankRow,
  computeBalanceCheck,
  countFlaggedRows,
  countLowConfidence,
  createMockStatement,
  type BalanceMode,
} from "@/lib/upload";
import type {
  ParseStatementResponse,
  StatementKind,
  CreditCardParseStats,
} from "@/lib/parser";
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
import { buildParserDiagnostics } from "@/lib/parser-diagnostics";

type Status = "upload" | "processing" | "preview" | "error";

type RowPatch = Partial<Omit<TransactionRow, "id">>;

type PreviewMeta = {
  source: "real-parser" | "mock-fallback";
  statementKind: StatementKind;
  fileName: string;
  pageCount: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  parserWarnings: string[];
  creditCardStats?: CreditCardParseStats;
};

const isDev = process.env.NODE_ENV !== "production";

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
      fileName: data.fileName || file?.name || "statement.pdf",
      pageCount: data.pageCount,
      openingBalance: data.openingBalance !== null ? Number(data.openingBalance) : null,
      closingBalance: data.closingBalance !== null ? Number(data.closingBalance) : null,
      parserWarnings: data.warnings,
      creditCardStats: data.creditCardStats,
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
      fileName: stmt.fileName,
      pageCount: stmt.pagesUsed,
      openingBalance: stmt.openingBalance,
      closingBalance: stmt.closingBalance,
      parserWarnings: [],
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
    const balanceStatus: BalanceStatus = !check.available
      ? "limited"
      : check.passed
        ? "passed"
        : "review";

    const reviewReasons: string[] = [...meta.parserWarnings];
    if (check.available && !check.passed) {
      reviewReasons.push(
        "The balance check did not match the statement's closing balance.",
      );
    }
    if (lowConfidenceCount > 0) {
      reviewReasons.push(
        `${lowConfidenceCount} low-confidence ${
          lowConfidenceCount === 1 ? "row was" : "rows were"
        } found — check the highlighted rows.`,
      );
    }
    const needsReview = reviewReasons.length > 0 || rows.length === 0;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Review your conversion
          </h1>
          <div className="flex items-center gap-4">
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
              className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              &larr; Convert another statement
            </button>
          </div>
        </div>

        {meta.source === "mock-fallback" ? (
          <UploadWarning variant="info" title="Showing sample data">
            This is example data, not your statement. Use it to explore the preview,
            editing, and CSV export.
          </UploadWarning>
        ) : null}

        {needsReview ? (
          <UploadWarning variant="warning" title="This conversion needs review">
            {rows.length === 0 ? (
              <p>
                No transaction rows were found. You can add rows manually below, or load
                the sample preview to see how a completed conversion looks.
              </p>
            ) : null}
            {reviewReasons.length > 0 ? (
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {reviewReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </UploadWarning>
        ) : (
          <UploadWarning variant="success" title="Balance check passed">
            The extracted totals match the statement&apos;s closing balance. Please still
            review the rows — we do not claim perfect accuracy.
          </UploadWarning>
        )}

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
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TransactionPreviewTable
              rows={rows}
              onUpdate={updateRow}
              onDelete={deleteRow}
              onAdd={addRow}
            />
          </div>
          <div className="lg:col-span-1">
            <BalanceCheckPanel check={check} />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-sm text-slate-600">
            Export the reviewed rows as a CSV or Excel file for spreadsheets, bookkeeping,
            or accounting software. Nothing is uploaded or stored.
          </p>
          <TransactionExportButtons rows={rows} sourceFileName={meta.fileName} />
        </div>

        {isDev ? (
          <ParserDiagnosticsPanel
            diagnostics={buildParserDiagnostics({
              source: meta.source,
              statementKind: meta.statementKind,
              pageCount: meta.pageCount,
              openingBalance: meta.openingBalance,
              closingBalance: meta.closingBalance,
              warnings: meta.parserWarnings,
              rows,
              balanceCheck: check,
              creditCardStats: meta.creditCardStats,
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
