"use client";

import { useState } from "react";
import type { Column } from "write-excel-file/browser";
import { TransactionRow, deriveAmount, rowsToCsv } from "@/lib/upload";

/** Build a safe, filesystem-friendly base name from the uploaded file name. */
function exportBaseName(sourceName: string): string {
  const base = sourceName.replace(/\.pdf$/i, "").trim();
  const safe = base.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
  return safe || "statement";
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const baseBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function TransactionExportButtons({
  rows,
  sourceFileName,
  className = "",
  labelPrefix,
  includeCategory = false,
  conversionId,
  requiresExportCharge = false,
  onCharged,
}: {
  rows: TransactionRow[];
  sourceFileName: string;
  className?: string;
  /** Optional label qualifier, e.g. "preview" → "Download preview CSV". */
  labelPrefix?: string;
  /** Include the Category column (only when category suggestions are enabled). */
  includeCategory?: boolean;
  /** Conversion id, required when a review export must be charged server-side. */
  conversionId?: string | null;
  /**
   * True for a review-highlighted conversion that has not been charged yet. The
   * page credits are deducted on the server BEFORE the file is produced; verified
   * conversions are already charged and export freely (this stays false).
   */
  requiresExportCharge?: boolean;
  /** Called after a successful (or already-applied) charge with the fresh totals. */
  onCharged?: (result: { chargedPages: number; pagesRemaining: number | null }) => void;
}) {
  const [excelBusy, setExcelBusy] = useState(false);
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const disabled = rows.length === 0;
  const qualifier = labelPrefix ? `${labelPrefix} ` : "";

  // For review-highlighted conversions, deduct page credits on the server before
  // any file is generated. Idempotent server-side, so repeated clicks never double
  // charge. Returns true only when it is safe to proceed with the download.
  async function ensureCharged(): Promise<boolean> {
    if (!requiresExportCharge) return true;
    if (!conversionId) {
      setChargeError("This conversion can't be exported right now. Please re-run the conversion.");
      return false;
    }
    setCharging(true);
    setChargeError(null);
    try {
      const res = await fetch("/api/conversions/charge-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversionId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string; chargedPages?: number; pagesRemaining?: number | null }
        | null;
      if (res.ok && data?.ok) {
        onCharged?.({
          chargedPages: data.chargedPages ?? 0,
          pagesRemaining: data.pagesRemaining ?? null,
        });
        return true;
      }
      // Map the structured error to a short, non-technical message.
      if (data?.error === "AUTH_REQUIRED") {
        setChargeError("Please sign in again to export this conversion.");
      } else if (data?.error === "INSUFFICIENT_PAGE_CREDITS") {
        setChargeError("You don't have enough page credits to export this conversion.");
      } else {
        setChargeError("We couldn't process the export charge. Please try again.");
      }
      return false;
    } catch {
      setChargeError("We couldn't reach the server to export. Please try again.");
      return false;
    } finally {
      setCharging(false);
    }
  }

  async function handleCsv() {
    if (disabled || charging) return;
    if (!(await ensureCharged())) return;
    // Pure client-side export — no upload, no storage.
    const csv = rowsToCsv(rows, { includeCategory });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `${exportBaseName(sourceFileName)}.csv`);
  }

  async function handleExcel() {
    if (disabled || excelBusy || charging) return;
    if (!(await ensureCharged())) return;
    setExcelBusy(true);
    try {
      // Real .xlsx workbook generated entirely in the browser. No upload, no storage.
      const { default: writeXlsxFile } = await import("write-excel-file/browser");

      const textCell = (v: string) => (v ? { type: String, value: v } : null);
      const moneyCell = (v: number | null) =>
        v !== null ? { type: Number, value: v } : null;

      // Core columns match the visible table + the default CSV. Category is added
      // only when explicitly enabled. Confidence/internal fields are never exported.
      const columns: Column<TransactionRow>[] = [
        { header: "Date", cell: (r) => textCell(r.date) },
        { header: "Description", cell: (r) => textCell(r.description) },
        { header: "Debit", cell: (r) => moneyCell(r.debit) },
        { header: "Credit", cell: (r) => moneyCell(r.credit) },
        // Amount is derived from debit/credit, identical to the CSV export.
        { header: "Amount", cell: (r) => moneyCell(deriveAmount(r.debit, r.credit)) },
        { header: "Balance", cell: (r) => moneyCell(r.balance) },
        ...(includeCategory
          ? [{ header: "Category", cell: (r: TransactionRow) => textCell(r.category) }]
          : []),
      ];

      const output = writeXlsxFile(rows, { columns, sheet: "Transactions" });
      const blob = await output.toBlob();
      triggerDownload(blob, `${exportBaseName(sourceFileName)}.xlsx`);
    } finally {
      setExcelBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleCsv}
          disabled={disabled || charging}
          className={`${baseBtn} bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {charging ? "Processing…" : `Download ${qualifier}CSV`}
        </button>
        <button
          type="button"
          onClick={handleExcel}
          disabled={disabled || excelBusy || charging}
          className={`${baseBtn} bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400`}
        >
          <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {excelBusy ? "Preparing…" : `Download ${qualifier}Excel`}
        </button>
      </div>
      {chargeError ? (
        <p className="text-xs font-medium text-red-600" role="alert">
          {chargeError}
        </p>
      ) : null}
    </div>
  );
}
