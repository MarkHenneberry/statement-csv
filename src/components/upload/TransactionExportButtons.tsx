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
  "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-base font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function TransactionExportButtons({
  rows,
  sourceFileName,
  className = "",
  labelPrefix,
}: {
  rows: TransactionRow[];
  sourceFileName: string;
  className?: string;
  /** Optional label qualifier, e.g. "preview" → "Download preview CSV". */
  labelPrefix?: string;
}) {
  const [excelBusy, setExcelBusy] = useState(false);
  const disabled = rows.length === 0;
  const qualifier = labelPrefix ? `${labelPrefix} ` : "";

  function handleCsv() {
    // Pure client-side export — no upload, no storage.
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `${exportBaseName(sourceFileName)}.csv`);
  }

  async function handleExcel() {
    if (disabled || excelBusy) return;
    setExcelBusy(true);
    try {
      // Real .xlsx workbook generated entirely in the browser. No upload, no storage.
      const { default: writeXlsxFile } = await import("write-excel-file/browser");

      const textCell = (v: string) => (v ? { type: String, value: v } : null);
      const moneyCell = (v: number | null) =>
        v !== null ? { type: Number, value: v } : null;

      const columns: Column<TransactionRow>[] = [
        { header: "Date", cell: (r) => textCell(r.date) },
        { header: "Description", cell: (r) => textCell(r.description) },
        { header: "Debit", cell: (r) => moneyCell(r.debit) },
        { header: "Credit", cell: (r) => moneyCell(r.credit) },
        // Amount is derived from debit/credit, identical to the CSV export.
        { header: "Amount", cell: (r) => moneyCell(deriveAmount(r.debit, r.credit)) },
        { header: "Balance", cell: (r) => moneyCell(r.balance) },
        { header: "Category", cell: (r) => textCell(r.category) },
      ];

      const output = writeXlsxFile(rows, { columns, sheet: "Transactions" });
      const blob = await output.toBlob();
      triggerDownload(blob, `${exportBaseName(sourceFileName)}.xlsx`);
    } finally {
      setExcelBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-3 sm:flex-row ${className}`}>
      <button
        type="button"
        onClick={handleCsv}
        disabled={disabled}
        className={`${baseBtn} bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600`}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download {qualifier}CSV
      </button>
      <button
        type="button"
        onClick={handleExcel}
        disabled={disabled || excelBusy}
        className={`${baseBtn} bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400`}
      >
        <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        {excelBusy ? "Preparing…" : `Download ${qualifier}Excel`}
      </button>
    </div>
  );
}
