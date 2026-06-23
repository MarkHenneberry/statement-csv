// Developer-only parser diagnostics.
//
// These helpers produce SAFE, aggregate metrics about a parse result — counts
// and statuses only. They never expose raw statement text, transaction
// descriptions, amounts, balances, or account numbers.
//
// This is for local developer testing only. It is NOT a public accuracy claim,
// and the parser remains an unvalidated MVP prototype.
// TODO(launch-blocker): parser accuracy must be validated against real bank
// statements before launch. These metrics help that testing; they do not
// replace it.

import type { TransactionRow, BalanceCheck, BalanceMode } from "@/lib/upload";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/upload";
import {
  SCANNED_PDF_WARNING,
  type StatementKind,
  type LayoutFamily,
  type CreditCardParseStats,
  type LayoutParseStats,
} from "@/lib/parser";
import type { StatementValidation } from "@/lib/statement-model";
import type { AiAssistOutcome } from "@/lib/ai-assist";

export type ParserQuality = "good" | "needs-review" | "poor";
export type DiagnosticsBalanceStatus = "passed" | "needs-review" | "limited";

export type ParserDiagnostics = {
  source: "real-parser" | "mock-fallback";
  statementKind: StatementKind;
  layoutFamily: LayoutFamily;
  balanceMode: BalanceMode;
  pageCount: number | null;
  totalRows: number;
  parserWarningCount: number;
  lowConfidenceCount: number;
  rowsMissingDate: number;
  rowsMissingDescription: number;
  rowsMissingDebitCredit: number;
  balanceStatus: DiagnosticsBalanceStatus;
  openingDetected: boolean;
  closingDetected: boolean;
  extractableTextDetected: boolean;
  warnings: string[];
  creditCardStats?: CreditCardParseStats;
  parseStats?: LayoutParseStats;
  /** Canonical model validation (status / confidence / issues). */
  validation?: StatementValidation;
  /** AI-assist outcome (status/config/diagnostics; aggregate-only). */
  aiAssist?: AiAssistOutcome;
  quality: ParserQuality;
  qualityLabel: string;
  qualityReason: string;
};

// Warning count at or above this is treated as a poor-quality signal.
const HIGH_WARNING_COUNT = 4;

export function buildParserDiagnostics(input: {
  source: "real-parser" | "mock-fallback";
  statementKind: StatementKind;
  layoutFamily: LayoutFamily;
  pageCount: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  warnings: string[];
  rows: TransactionRow[];
  balanceCheck: BalanceCheck;
  creditCardStats?: CreditCardParseStats;
  parseStats?: LayoutParseStats;
  validation?: StatementValidation;
  aiAssist?: AiAssistOutcome;
}): ParserDiagnostics {
  const {
    source,
    statementKind,
    layoutFamily,
    pageCount,
    openingBalance,
    closingBalance,
    warnings,
    rows,
    balanceCheck,
    creditCardStats,
    parseStats,
    validation,
    aiAssist,
  } = input;

  const totalRows = rows.length;
  const lowConfidenceCount = rows.filter(
    (r) => r.confidence < LOW_CONFIDENCE_THRESHOLD,
  ).length;
  const rowsMissingDate = rows.filter((r) => !r.date.trim()).length;
  const rowsMissingDescription = rows.filter((r) => !r.description.trim()).length;
  const rowsMissingDebitCredit = rows.filter(
    (r) => r.debit === null && r.credit === null,
  ).length;

  const balanceStatus: DiagnosticsBalanceStatus = !balanceCheck.available
    ? "limited"
    : balanceCheck.passed
      ? "passed"
      : "needs-review";

  const openingDetected = openingBalance !== null;
  const closingDetected = closingBalance !== null;
  const parserWarningCount = warnings.length;

  // Sample data is not real extracted text, so "extractable text" is N/A => true.
  const scanned = warnings.includes(SCANNED_PDF_WARNING);
  const extractableTextDetected = source === "mock-fallback" ? true : !scanned;

  let quality: ParserQuality;
  let qualityReason: string;
  if (totalRows === 0 || scanned || parserWarningCount >= HIGH_WARNING_COUNT) {
    quality = "poor";
    qualityReason = scanned
      ? "No extractable text (likely scanned/image-only)."
      : totalRows === 0
        ? "No transaction rows were detected."
        : "A high number of parser warnings was produced.";
  } else if (layoutFamily === "unknown") {
    // Unknown layout family — surface as Needs Review rather than pretending.
    quality = "needs-review";
    qualityReason = "Layout family could not be confidently identified.";
  } else if (
    openingDetected &&
    closingDetected &&
    balanceStatus === "passed" &&
    lowConfidenceCount === 0 &&
    parserWarningCount === 0
  ) {
    quality = "good";
    qualityReason = "Rows found, balances detected, balance check passed, no warnings.";
  } else {
    quality = "needs-review";
    qualityReason =
      !openingDetected || !closingDetected
        ? "Rows found, but opening or closing balance was not detected."
        : lowConfidenceCount > 0
          ? "Rows found, but some rows are low-confidence."
          : "Rows found, but the balance check did not pass cleanly.";
  }

  const qualityLabel = { good: "Good", "needs-review": "Needs review", poor: "Poor" }[
    quality
  ];

  return {
    source,
    statementKind,
    layoutFamily,
    balanceMode: balanceCheck.mode,
    pageCount,
    totalRows,
    parserWarningCount,
    lowConfidenceCount,
    rowsMissingDate,
    rowsMissingDescription,
    rowsMissingDebitCredit,
    balanceStatus,
    openingDetected,
    closingDetected,
    extractableTextDetected,
    warnings,
    creditCardStats,
    parseStats,
    validation,
    aiAssist,
    quality,
    qualityLabel,
    qualityReason,
  };
}
