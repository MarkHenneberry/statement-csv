// Server-only PDF text extraction. Uses `unpdf`, a serverless build of pdf.js
// with no native dependencies, so it runs in a Next.js Node runtime route.
//
// This module must never be imported by client components.
//
// TODO(launch-blocker): verify in the deployment target that uploaded bytes are
// only held in memory for the duration of the request and never written to disk
// or a temp file by the runtime. Deletion-after-conversion must be confirmed
// before launch.

import "server-only";
import { getDocumentProxy } from "unpdf";

export type ExtractedPdf = {
  pageCount: number | null;
  /** Reconstructed text per page, lines separated by "\n". */
  pages: string[];
  /** Total count of non-whitespace characters across all pages. */
  textLength: number;
};

type TextItem = { str?: string; transform?: number[] };

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

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  const pdf = await getDocumentProxy(bytes);
  const pageCount = pdf.numPages ?? null;
  const pages: string[] = [];

  for (let i = 1; i <= (pageCount ?? 0); i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items as TextItem[]));
  }

  const textLength = pages.join("").replace(/\s/g, "").length;
  return { pageCount, pages, textLength };
}
