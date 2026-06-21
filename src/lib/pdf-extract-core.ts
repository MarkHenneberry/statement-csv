// PDF text extraction core. Uses `unpdf`, a serverless build of pdf.js with no
// native dependencies. This module has no "server-only" guard so it can also be
// used by the local private-regression script; the guarded entry point is
// src/lib/pdf-extract.ts, which is what app code imports.

import { getDocumentProxy } from "unpdf";
import type { PdfTextItem } from "@/lib/coordinate-table";

export type ExtractedPdf = {
  pageCount: number | null;
  /** Reconstructed text per page, lines separated by "\n". */
  pages: string[];
  /** Total count of non-whitespace characters across all pages. */
  textLength: number;
  /**
   * Structured text items with positions, for the coordinate-aware table parser.
   * INTERNAL ONLY — never returned to the client, logged, or stored. The plain
   * `pages` text above remains the fallback path.
   */
  items: PdfTextItem[];
};

type TextItem = { str?: string; transform?: number[]; width?: number; height?: number };

/**
 * Rebuild lines from pdf.js text items by grouping items that share a baseline
 * (the y value in the text transform), then ordering each line left-to-right.
 * This preserves line structure far better than a naive token join.
 */
function itemsToLines(items: TextItem[]): string {
  type Line = { y: number; parts: { x: number; str: string }[] };
  const lines: Line[] = [];
  const tolerance = 2; // points

  for (const item of items) {
    const str = item.str ?? "";
    if (!str) continue;
    const transform = item.transform;
    if (!transform || transform.length < 6) continue;
    const x = transform[4];
    const y = transform[5];

    let line = lines.find((l) => Math.abs(l.y - y) <= tolerance);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, str });
  }

  // PDF y grows upward, so sort lines top-to-bottom by descending y.
  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((l) => l.length > 0)
    .join("\n");
}

/** Collect structured, positioned text items for one page (coordinate parser). */
function itemsToStructured(items: TextItem[], page: number): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const item of items) {
    const str = item.str ?? "";
    if (!str.trim()) continue;
    const transform = item.transform;
    if (!transform || transform.length < 6) continue;
    out.push({
      page,
      str,
      x: transform[4],
      y: transform[5],
      width: item.width ?? 0,
      height: item.height ?? 0,
    });
  }
  return out;
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  const pdf = await getDocumentProxy(bytes);
  const pageCount = pdf.numPages ?? null;
  const pages: string[] = [];
  const items: PdfTextItem[] = [];

  for (let i = 1; i <= (pageCount ?? 0); i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageItems = content.items as TextItem[];
    pages.push(itemsToLines(pageItems));
    items.push(...itemsToStructured(pageItems, i));
  }

  const textLength = pages.join("").replace(/\s/g, "").length;
  return { pageCount, pages, textLength, items };
}
