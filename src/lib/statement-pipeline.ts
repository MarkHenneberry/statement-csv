// Explicit parser pipeline orchestrator.
//
// The system is modelled as stages, NOT a direct "PDF → CSV" jump:
//   PDF → extracted text/layout → ParsedStatement → validation/confidence → export
//
// Stage A (extract) is performed by the caller (server-only `extractPdfText`),
// which yields plain text + coordinate items. Stages B–I run here/below; Stage J
// (export) consumes ONLY `ParsedStatement.transactions`.

import { parseStatementText, type ParseResult } from "./parser.ts";
import {
  buildParsedStatement,
  parsedStatementToRows,
  type ParsedStatement,
  type BuildStatementMeta,
} from "./statement-model.ts";
import type { PdfTextItem } from "./coordinate-table.ts";
import type { TransactionRow } from "./upload.ts";

/** The pipeline stages, in order (kept in code so the architecture is explicit). */
export const PARSER_PIPELINE_STAGES = [
  "A. Extract document (plain text + coordinate items)",
  "B. Normalize text / layout",
  "C. Detect statement profile / type",
  "D. Split document into sections",
  "E. Parse metadata and balances",
  "F. Detect transaction tables (coordinate → text → fallback)",
  "G. Rebuild rows and columns",
  "H. Normalize transactions",
  "I. Validate (confidence + issues)",
  "J. Export from ParsedStatement.transactions",
] as const;

export type StatementInput = {
  /** Reconstructed plain text (Stage A). */
  text: string;
  /** Positioned text items when available (Stage A); enables coordinate tables. */
  items?: PdfTextItem[];
  meta?: BuildStatementMeta;
};

export type PipelineOutput = {
  statement: ParsedStatement;
  /** Low-level result (warnings + safe diagnostics) for the API/diagnostics layer. */
  result: ParseResult;
  /** Export/preview rows, derived from the model's transactions (never raw text). */
  rows: TransactionRow[];
};

/**
 * Run Stages C–I and return the canonical model plus export rows. Extraction
 * (Stage A) is the caller's responsibility so this stays pure and testable.
 */
export function parseStatement(input: StatementInput): PipelineOutput {
  // Stages B–G: extraction heuristics + table detection + row rebuilding.
  const result = parseStatementText(input.text, input.items);
  // Stages H–I: normalize into the domain model and validate/confidence-score.
  const statement = buildParsedStatement(result, input.meta ?? {});
  // Stage J source of truth: rows for export/preview come from the model.
  const rows = parsedStatementToRows(statement);
  return { statement, result, rows };
}
