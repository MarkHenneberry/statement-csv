import { NextResponse } from "next/server";
import { validateFile } from "@/lib/upload";
import { extractPdfText } from "@/lib/pdf-extract";
import {
  parseStatementText,
  SCANNED_PDF_WARNING,
  type ParseStatementResponse,
} from "@/lib/parser";

// PDF parsing needs the Node runtime (unpdf / pdf.js is not Edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Below this much extractable text we assume the PDF is scanned/image-only.
const MIN_TEXT_LENGTH = 24;

function moneyString(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function errorResponse(fileName: string, warning: string, status = 400) {
  const body: ParseStatementResponse = {
    ok: false,
    source: "real-parser",
    fileName,
    pageCount: null,
    statementKind: "unknown",
    layoutFamily: "unknown",
    rows: [],
    openingBalance: null,
    closingBalance: null,
    warnings: [warning],
  };
  return NextResponse.json(body, { status });
}

// PRIVACY: this handler must never persist the file or extracted text, and must
// never log statement text, rows, balances, account numbers, or descriptions.
// Only generic, non-sensitive messages may be logged.
// TODO(launch-blocker): finalize a production logging policy (structured logs,
// no PII, request ids only) and confirm the host does not retain request bodies.
export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("", "The upload could not be read. Please try again.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse("", "No PDF file was received.");
  }

  const fileName = file.name || "statement.pdf";
  const validation = validateFile(file);
  if (!validation.ok) {
    return errorResponse(fileName, validation.reason);
  }

  let extracted;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    extracted = await extractPdfText(bytes);
    // `bytes` and `extracted` go out of scope when the request ends; nothing is
    // written to disk or a database. No caching of the file or its text.
  } catch {
    // Do not surface internal error details (may echo file contents).
    return errorResponse(
      fileName,
      "We couldn't read this PDF. It may be corrupted or password protected.",
      422,
    );
  }

  // Little or no extractable text => almost certainly scanned/image-only.
  if (extracted.textLength < MIN_TEXT_LENGTH) {
    const body: ParseStatementResponse = {
      ok: true,
      source: "real-parser",
      fileName,
      pageCount: extracted.pageCount,
      statementKind: "unknown",
      layoutFamily: "unknown",
      rows: [],
      openingBalance: null,
      closingBalance: null,
      warnings: [SCANNED_PDF_WARNING],
    };
    return NextResponse.json(body);
  }

  const parsed = parseStatementText(extracted.pages.join("\n"));

  // PRIVACY: extracted text is used only to produce the structured rows above.
  // It is never returned to the client, logged, or stored. No raw text preview.
  const body: ParseStatementResponse = {
    ok: true,
    source: "real-parser",
    fileName,
    pageCount: extracted.pageCount,
    statementKind: parsed.statementKind,
    layoutFamily: parsed.layoutFamily,
    rows: parsed.rows,
    openingBalance: moneyString(parsed.openingBalance),
    closingBalance: moneyString(parsed.closingBalance),
    warnings: parsed.warnings,
    creditCardStats: parsed.creditCardStats,
    parseStats: parsed.parseStats,
  };

  return NextResponse.json(body);
}
