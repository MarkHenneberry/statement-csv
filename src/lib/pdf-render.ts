// PDF → image rendering + targeted crop selection for the AI VISION fallback.
//
// Used ONLY when the deterministic parser fails / is low-confidence and AI vision
// fallback is enabled. The region SELECTION logic is pure and testable; the actual
// page rendering is best-effort: it dynamically imports a canvas-based renderer and
// degrades gracefully (no images) when one is not available in the deployment, so
// the build and tests never depend on native canvas. When rendering is unavailable
// the AI fallback still runs as a single call using text/layout evidence only.
//
// PRIVACY: rendered image bytes are sent to the model only (that is the feature)
// and are NEVER logged, returned to the client, or written to disk. Targeted crops
// of summary/table/totals regions are preferred so legal/footer/ads/contact blocks
// are excluded by construction.

// Money/date detection for per-page transaction-density classification (pure, safe —
// operates on already-extracted page text and returns COUNTS only, never text).
import { extractMoneyValues, findDate } from "./parser.ts";

export type VisionRegionKind =
  | "summary"
  | "table-header"
  | "table-body"
  | "final-rows"
  | "totals"
  | "low-confidence";

// Region kinds we NEVER crop/send (privacy + token control). Selection only ever
// emits the useful kinds above, so these are excluded by construction.
export const EXCLUDED_REGION_KINDS = [
  "footer",
  "legal",
  "blank",
  "ads",
  "contact-info",
  "disclosure",
] as const;

// "upper"/"lower" are overlapping HALVES used to chunk a long transaction table
// into two readable, header-bearing sections.
export type VisionBand = "top" | "middle" | "bottom" | "full" | "upper" | "lower";

export type VisionRegion = {
  id: string;
  kind: VisionRegionKind;
  page: number;
  band: VisionBand;
};

export type VisionImage = {
  id: string;
  kind: VisionRegionKind | "full-page";
  page: number;
  /** The vertical band this image was cropped from (for diagnostics). */
  band: VisionBand;
  /** true = a targeted crop; false = a (downscaled) full relevant page fallback. */
  crop: boolean;
  /** data: URL of the rendered PNG. Never logged. */
  dataUrl: string;
};

/** SAFE per-image metadata for diagnostics (no pixels, no text, no base64). */
export type VisionImageMeta = {
  id: string;
  kind: VisionImage["kind"];
  page: number;
  band: VisionBand;
  crop: boolean;
  width: number;
  height: number;
  byteSize: number;
};

export type VisionRenderResult = {
  available: boolean;
  images: VisionImage[];
  renderedPages: number;
  crops: number;
  fullPages: number;
  /** Safe label when no images were produced (e.g. "render-backend-unavailable"). */
  failureReason: string | null;
  /** Safe aggregate metadata for each produced image, in send order. */
  meta: VisionImageMeta[];
};

export type SelectRegionsInput = {
  pageCount: number;
  hasLowConfidence: boolean;
  /** Page hints related to the validation failure (1-based), if known. */
  failurePages?: number[];
  /** Pages where a transaction-table header was detected (1-based). PRIORITIZED. */
  transactionHeaderPages?: number[];
  /** Pages that look like account-summary pages (opening/closing/totals). */
  summaryPages?: number[];
  /** Pages that are legal/info/disclosure (never targeted). */
  legalPages?: number[];
  maxRegions?: number;
};

/**
 * Choose the regions to render for the vision fallback. When transaction-table
 * header pages are known they are PRIORITIZED (the real tables may appear after
 * one or more summary/legal pages), and legal pages are never targeted. Falls back
 * to page-1/last-page heuristics when no header pages are detected. Always includes
 * a summary region for opening/closing. Pure + deterministic; never targets
 * footer/legal/blank/ads/contact regions.
 */
export function selectVisionRegions(input: SelectRegionsInput): VisionRegion[] {
  const pages = Math.max(1, input.pageCount || 1);
  const last = pages;
  const legal = new Set(input.legalPages ?? []);
  const txPages = (input.transactionHeaderPages ?? []).filter((p) => p >= 1 && p <= pages && !legal.has(p));
  const max = input.maxRegions ?? (txPages.length > 0 ? 8 : 6);
  const regions: VisionRegion[] = [];
  const add = (kind: VisionRegionKind, page: number, band: VisionBand) => {
    if (page < 1 || page > pages || legal.has(page)) return;
    regions.push({ id: `${kind}-p${page}-${band}`, kind, page, band });
  };

  if (txPages.length > 0) {
    // TRANSACTION TABLE FIRST and ONLY. The itemized table is the thing we need the
    // model to read, so every image is a transaction-table chunk. Summary/totals
    // are NOT sent as images (the model can misread them as transaction rows); they
    // are supplied as TEXT anchors in the evidence/Blinders packet instead. Each
    // transaction page is chunked into two overlapping, header-bearing halves so the
    // rows render large enough to read (a single full-page image makes dense rows
    // tiny after the model downscales it).
    for (const p of txPages.slice(0, 4)) {
      add("table-header", p, "upper"); // top half (includes the column header)
      add("table-body", p, "lower"); // bottom half (overlaps the top half)
    }
    // Only an explicitly current-period fee/interest page (already classified as a
    // transaction page) is included; summary/totals/legal/rewards pages are not.
    for (const p of input.failurePages ?? []) add("table-body", p, "full");
  } else {
    // No header pages detected: page-1 + last-page heuristic (chunked).
    add("table-header", 1, "upper");
    add("table-body", 1, "lower");
    add("final-rows", last, "bottom");
  }

  // De-dupe by id and cap (token control: targeted, not the whole document).
  const seen = new Set<string>();
  const unique = regions.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  // FULL-PAGE FALLBACK: when no targeted crop regions could be selected (e.g. an
  // unrecognized table-header layout, or every page carried footer/legal text and
  // got excluded), render FULL-PAGE images of the likely transaction pages so the
  // model still has VISUAL evidence — never a zero-image full-reconstruction call.
  // Prefer detected transaction pages; else all non-legal pages; else all pages.
  if (unique.length === 0) {
    const allPages = Array.from({ length: pages }, (_, i) => i + 1);
    const txAll = (input.transactionHeaderPages ?? []).filter((p) => p >= 1 && p <= pages);
    let candidates = txAll;
    if (candidates.length === 0) {
      const nonLegal = allPages.filter((p) => !legal.has(p));
      candidates = nonLegal.length > 0 ? nonLegal : allPages;
    }
    const FULL_PAGE_FALLBACK_CAP = 5;
    return candidates.slice(0, FULL_PAGE_FALLBACK_CAP).map((p) => ({
      id: `full-page-p${p}-full`,
      kind: "table-body" as VisionRegionKind,
      page: p,
      band: "full" as VisionBand,
    }));
  }

  return unique.slice(0, max);
}

export type VisionPageAnalysis = {
  transactionHeaderPages: number[];
  summaryPages: number[];
  legalPages: number[];
  warningRewardPages: number[];
};

// Generic (not bank-specific) page-classification cues.
const TX_HEADER_RE =
  /\btransactions?\b|(?:\btran(?:s|saction)?\.?\s*date\b[\s\S]{0,40}\bpost(?:ing)?\.?\s*date\b)|(?:description[\s\S]{0,40}amount)|reference (?:number|no)/i;
const SUMMARY_PAGE_RE =
  /previous (?:account |statement )?balance|new balance|total (?:credits?|debits?|payments?|purchases?)|minimum payment|payment due/i;
const LEGAL_PAGE_RE =
  /important (?:information|account information)|how to (?:reach|contact)|trade ?-?marks?|disclosure|cardholder agreement|terms and conditions|protecting your/i;
const WARNING_REWARD_RE =
  /rewards?|points|interest rate chart|annual interest rate|message cent(?:re|er)/i;

/**
 * Classify each preview page (1-based) by its textual cues so vision selection can
 * PRIORITIZE transaction-table pages and EXCLUDE legal/warning pages. Operates on
 * already-extracted page text; returns indexes only (no text is retained/returned).
 */
export function analyzeVisionPages(perPageText: string[]): VisionPageAnalysis {
  const transactionHeaderPages: number[] = [];
  const summaryPages: number[] = [];
  const legalPages: number[] = [];
  const warningRewardPages: number[] = [];
  perPageText.forEach((text, i) => {
    const page = i + 1;
    const hasTx = TX_HEADER_RE.test(text);
    const hasSummary = SUMMARY_PAGE_RE.test(text);
    const hasLegal = LEGAL_PAGE_RE.test(text);
    const hasWarn = WARNING_REWARD_RE.test(text);
    if (hasTx) transactionHeaderPages.push(page);
    if (hasSummary) summaryPages.push(page);
    // A page is "legal/warning" (excludable) ONLY when it carries neither a
    // transaction table NOR summary balances. Summary pages often also contain
    // legal/marketing/rewards text, but we still need their opening/closing/totals
    // region — so they must never be excluded.
    if (!hasTx && !hasSummary && hasLegal) legalPages.push(page);
    if (!hasTx && !hasSummary && hasWarn) warningRewardPages.push(page);
  });
  return { transactionHeaderPages, summaryPages, legalPages, warningRewardPages };
}

// ----- Evidence PLAN: rendered page images as the default AI fallback evidence -----
//
// Strategy: when the parser fails, give the model rendered IMAGES of the pages it
// needs to reconstruct the table — full pages by default, not tiny crops. Small
// statements send all renderable pages (when there is any uncertainty); large ones
// send transaction-bearing + summary-anchor pages with a reasonable cap. Transaction
// DENSITY beats footer/legal classification, so a page with rows + a footer is kept.

export type AiEvidenceMode =
  | "full-pages"
  | "transaction-pages"
  | "region-crops"
  | "mixed"
  | "text-only"
  | "none";

export type AiEvidenceCoverageLevel = "all-pages" | "transaction-and-anchors" | "partial" | "none";

export type EvidencePlanDiag = {
  aiEvidenceMode: AiEvidenceMode;
  aiEvidenceCoverageLevel: AiEvidenceCoverageLevel;
  /** 0..1: selected meaningful pages / total meaningful pages. */
  aiEvidenceCompletenessScore: number;
  selectedEvidencePages: number[];
  selectedEvidencePageCount: number;
  /** selected pages / total pages. */
  pageCoverageRatio: number;
  allPagesFallbackUsed: boolean;
  fullPageFallbackUsed: boolean;
  transactionPagesSelected: number[];
  summaryAnchorPagesSelected: number[];
  pagesSkippedCount: number;
  pagesSkippedReasonCounts: Record<string, number>;
};

const SMALL_PDF_MAX_PAGES = 6;
const EVIDENCE_PAGE_CAP = 12;
const BLANK_PAGE_MAX_CHARS = 40;
const SUMMARY_ANCHOR_RE =
  /previous (?:account |statement )?balance|new balance|opening balance|closing balance|balance forward|amount due|minimum payment|payment due|total (?:credits?|debits?|payments?|purchases?|deposits?|withdrawals?|cheques?|fees?|interest)/i;

/** Per-page transaction-density signals (counts only — no text retained). */
function pageTransactionSignals(text: string): { moneyLines: number; dateLines: number; hasHeader: boolean } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let moneyLines = 0;
  let dateLines = 0;
  for (const l of lines) {
    if (extractMoneyValues(l).length >= 1) moneyLines += 1;
    if (findDate(l) !== null) dateLines += 1;
  }
  return { moneyLines, dateLines, hasHeader: TX_HEADER_RE.test(text) };
}

/**
 * Plan which pages to render as evidence and how complete that evidence is.
 * Returns full-page regions (the renderer turns these into full-page images) plus a
 * safe diagnostic packet. Pure + deterministic; operates on already-extracted page
 * text and returns indexes/counts only.
 */
export function planVisionEvidence(input: {
  pageCount: number;
  perPageText: string[];
  maxImages?: number;
}): { regions: VisionRegion[]; diag: EvidencePlanDiag } {
  const perPage = input.perPageText;
  const pageCount = Math.max(1, input.pageCount || perPage.length || 1);
  const cap = input.maxImages ?? EVIDENCE_PAGE_CAP;

  type Cls = { page: number; txBearing: boolean; anchor: boolean; irrelevant: boolean; reason: string };
  const cls: Cls[] = perPage.slice(0, pageCount).map((text, i) => {
    const page = i + 1;
    const sig = pageTransactionSignals(text);
    // Transaction DENSITY wins: a header, OR many money lines, OR dated money rows.
    const txBearing = sig.hasHeader || sig.moneyLines >= 4 || (sig.dateLines >= 2 && sig.moneyLines >= 2);
    const anchor = SUMMARY_ANCHOR_RE.test(text);
    const blank = text.replace(/\s+/g, "").length <= BLANK_PAGE_MAX_CHARS;
    let irrelevant = false;
    let reason = "selected";
    if (txBearing || anchor) {
      irrelevant = false;
    } else if (blank) {
      irrelevant = true;
      reason = "blank";
    } else if (LEGAL_PAGE_RE.test(text)) {
      irrelevant = true;
      reason = "legal-only";
    } else if (WARNING_REWARD_RE.test(text)) {
      irrelevant = true;
      reason = "rewards-or-warning-only";
    } else {
      irrelevant = true;
      reason = "no-transaction-or-anchor-evidence";
    }
    return { page, txBearing, anchor, irrelevant, reason };
  });

  const txPages = cls.filter((c) => c.txBearing).map((c) => c.page);
  const anchorPages = cls.filter((c) => c.anchor && !c.txBearing).map((c) => c.page);
  const meaningful = cls.filter((c) => !c.irrelevant).map((c) => c.page);
  const allPages = Array.from({ length: pageCount }, (_, i) => i + 1);

  let selected: number[];
  let mode: AiEvidenceMode;
  let coverageLevel: AiEvidenceCoverageLevel;
  let allPagesFallbackUsed = false;

  if (pageCount <= SMALL_PDF_MAX_PAGES) {
    // Small PDF: prefer ALL pages. When transaction pages are not confidently
    // detected, there is uncertainty → send the whole rendered document rather than
    // risk missing rows. When they ARE detected, still include every non-irrelevant
    // page (footer/legal text never excludes a page that has rows or anchors).
    const uncertain = txPages.length === 0;
    selected = uncertain ? allPages : meaningful.length > 0 ? meaningful : allPages;
    mode = "full-pages";
    allPagesFallbackUsed = uncertain || selected.length === pageCount;
    coverageLevel = selected.length === pageCount ? "all-pages" : "transaction-and-anchors";
  } else {
    // Large PDF: all transaction-bearing pages + the summary/anchor pages needed for
    // validation, capped for token control.
    const wanted = [...new Set([...txPages, ...anchorPages])].sort((a, b) => a - b);
    selected = wanted.length > 0 ? wanted : meaningful.length > 0 ? meaningful : allPages;
    mode = "transaction-pages";
    coverageLevel = "transaction-and-anchors";
  }

  let capped = false;
  if (selected.length > cap) {
    selected = selected.slice(0, cap);
    capped = true;
  }
  if (selected.length === 0) {
    selected = allPages.slice(0, cap);
    mode = "full-pages";
    coverageLevel = "all-pages";
    allPagesFallbackUsed = true;
  }

  const totalMeaningful = Math.max(1, meaningful.length);
  const selectedMeaningful = selected.filter((p) => meaningful.includes(p)).length;
  const completeness = Math.min(1, selectedMeaningful / totalMeaningful);
  if (capped && completeness < 1) coverageLevel = "partial";

  const skipped = cls.filter((c) => !selected.includes(c.page));
  const pagesSkippedReasonCounts: Record<string, number> = {};
  for (const s of skipped) {
    const reason = s.irrelevant ? s.reason : "over-cap";
    pagesSkippedReasonCounts[reason] = (pagesSkippedReasonCounts[reason] ?? 0) + 1;
  }

  const regions: VisionRegion[] = selected.map((p) => ({
    id: `full-page-p${p}-full`,
    kind: "table-body",
    page: p,
    band: "full",
  }));

  return {
    regions,
    diag: {
      aiEvidenceMode: mode,
      aiEvidenceCoverageLevel: coverageLevel,
      aiEvidenceCompletenessScore: Math.round(completeness * 100) / 100,
      selectedEvidencePages: selected,
      selectedEvidencePageCount: selected.length,
      pageCoverageRatio: Math.round((selected.length / pageCount) * 100) / 100,
      allPagesFallbackUsed,
      fullPageFallbackUsed: true,
      transactionPagesSelected: selected.filter((p) => txPages.includes(p)),
      summaryAnchorPagesSelected: selected.filter((p) => anchorPages.includes(p)),
      pagesSkippedCount: skipped.length,
      pagesSkippedReasonCounts,
    },
  };
}

/** A renderer for one region. Returns null when it cannot render that region. */
export type RegionRenderer = (
  bytes: Uint8Array,
  region: VisionRegion,
) => Promise<{ dataUrl: string; crop: boolean } | null>;

const toDataUrl = (png: Uint8Array): string =>
  `data:image/png;base64,${Buffer.from(png).toString("base64")}`;

/** PNG IHDR width/height (offsets 16..23). Dimensions only — no pixel content. */
function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const read = (o: number) => (png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3];
  return { width: read(16) >>> 0, height: read(20) >>> 0 };
}

function bandRange(band: VisionBand, h: number): [number, number] {
  switch (band) {
    case "top":
      return [0, Math.round(h * 0.45)];
    case "middle":
      return [Math.round(h * 0.25), Math.round(h * 0.78)];
    case "bottom":
      return [Math.round(h * 0.55), h];
    // Overlapping halves for chunking a long table. "upper" keeps the column
    // header; the overlap means no row is lost between the two chunks.
    case "upper":
      return [0, Math.round(h * 0.58)];
    case "lower":
      return [Math.round(h * 0.42), h];
    default:
      return [0, h];
  }
}

/** Is a server-side render backend (unpdf + @napi-rs/canvas) available? */
export async function probeRenderBackend(): Promise<{
  available: boolean;
  backend: string | null;
  reason: string | null;
}> {
  try {
    const canvas = await import("@napi-rs/canvas");
    if (typeof canvas.createCanvas !== "function") {
      return { available: false, backend: null, reason: "canvas-backend-unavailable" };
    }
    const unpdf = await import("unpdf");
    if (typeof unpdf.renderPageAsImage !== "function") {
      return { available: false, backend: null, reason: "pdf-renderer-unavailable" };
    }
    return { available: true, backend: "@napi-rs/canvas", reason: null };
  } catch {
    return { available: false, backend: null, reason: "canvas-backend-unavailable" };
  }
}

type DefaultRenderer = { render: RegionRenderer; reason: () => string | null };

/**
 * Real default renderer: renders each PDF page once (unpdf + @napi-rs/canvas),
 * caches it, then crops the region's vertical band (napi-canvas). Falls back to
 * the full relevant page if cropping fails, and returns null if the page cannot be
 * rendered. It records a SPECIFIC failure reason so the caller can report exactly
 * why vision degraded — canvas-backend-unavailable / pdf-renderer-unavailable /
 * page-render-error — never a generic label. Native deps are imported dynamically
 * (server-only) so they never reach a client bundle. `scaleWidth` bounds width.
 */
// Higher render width than before so dense transaction rows stay legible after the
// vision model downscales/tiles the image. Chunking (upper/lower halves) keeps each
// image a readable size at this width.
function makeDefaultRenderer(scaleWidth = 1500): DefaultRenderer {
  const pageCache = new Map<number, { png: Uint8Array; height: number } | null>();
  let firstReason: string | null = null;
  const setReason = (r: string) => {
    if (!firstReason) firstReason = r;
  };
  const render: RegionRenderer = async (bytes, region) => {
    let page = pageCache.get(region.page);
    if (page === undefined) {
      try {
        const canvasMod = await import("@napi-rs/canvas").catch(() => null);
        if (!canvasMod || typeof canvasMod.createCanvas !== "function") {
          setReason("canvas-backend-unavailable");
          pageCache.set(region.page, null);
          return null;
        }
        const unpdf = await import("unpdf");
        if (typeof unpdf.renderPageAsImage !== "function") {
          setReason("pdf-renderer-unavailable");
          pageCache.set(region.page, null);
          return null;
        }
        // IMPORTANT: pass a FRESH copy of the bytes on every call. unpdf transfers
        // (detaches) the underlying ArrayBuffer to the pdf.js worker on the first
        // render; a second call with the same buffer throws "DataCloneError: Cannot
        // transfer object of unsupported type", which previously made every page
        // after the first fail — so the vision fallback never saw the transaction
        // pages. A per-call copy lets all selected pages render.
        const fresh = new Uint8Array(bytes.byteLength);
        fresh.set(bytes);
        const out = await unpdf.renderPageAsImage(fresh, region.page, {
          canvasImport: () => import("@napi-rs/canvas"),
          width: scaleWidth,
        });
        const u8 = out instanceof Uint8Array ? out : new Uint8Array(out);
        page = { png: u8, height: pngDimensions(u8).height };
      } catch {
        setReason("page-render-error");
        page = null;
      }
      pageCache.set(region.page, page);
    }
    if (!page) return null;
    if (region.band === "full") return { dataUrl: toDataUrl(page.png), crop: false };
    try {
      const { createCanvas, loadImage } = await import("@napi-rs/canvas");
      const img = await loadImage(Buffer.from(page.png));
      const [y0, y1] = bandRange(region.band, img.height);
      const ch = Math.max(1, y1 - y0);
      const canvas = createCanvas(img.width, ch);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, y0, img.width, ch, 0, 0, img.width, ch);
      return { dataUrl: `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`, crop: true };
    } catch {
      return { dataUrl: toDataUrl(page.png), crop: false }; // page rendered, crop failed
    }
  };
  return { render, reason: () => firstReason };
}

/** Back-compat: a default region renderer (without the captured-reason accessor). */
export function createDefaultRegionRenderer(scaleWidth = 1100): RegionRenderer {
  return makeDefaultRenderer(scaleWidth).render;
}

/**
 * Render the selected regions to images. Vision is PREFERRED: when enabled and a
 * backend is present, image crops are produced and used. Returns available=false
 * with a SPECIFIC failureReason ONLY when vision is disabled or rendering genuinely
 * failed (backend missing / page render error) — the caller then makes a single
 * text-layout call. Never a generic "render-failed".
 */
export async function renderVisionEvidence(
  bytes: Uint8Array,
  regions: VisionRegion[],
  opts: { enabled: boolean; renderer?: RegionRenderer; maxImages?: number } = { enabled: false },
): Promise<VisionRenderResult> {
  if (!opts.enabled) {
    return { available: false, images: [], renderedPages: 0, crops: 0, fullPages: 0, failureReason: "vision-disabled", meta: [] };
  }
  if (regions.length === 0) {
    return { available: false, images: [], renderedPages: 0, crops: 0, fullPages: 0, failureReason: "no-regions", meta: [] };
  }
  const usingDefault = !opts.renderer;
  const def = usingDefault ? makeDefaultRenderer() : null;
  const renderer = opts.renderer ?? def!.render;
  const max = opts.maxImages ?? 6;

  const images: VisionImage[] = [];
  const pages = new Set<number>();
  for (const region of regions) {
    if (images.length >= max) break;
    const rendered = await renderer(bytes, region);
    if (!rendered) continue;
    pages.add(region.page);
    images.push({
      id: region.id,
      kind: rendered.crop ? region.kind : "full-page",
      page: region.page,
      band: region.band,
      crop: rendered.crop,
      dataUrl: rendered.dataUrl,
    });
  }
  if (images.length === 0) {
    // Specific reason from the actual render attempt (default), or for an injected
    // renderer that produced nothing, "injected-renderer-no-output".
    const reason = usingDefault ? def!.reason() ?? "page-render-error" : "injected-renderer-no-output";
    return { available: false, images: [], renderedPages: 0, crops: 0, fullPages: 0, failureReason: reason, meta: [] };
  }
  // SAFE per-image metadata (dimensions + byte size only; no pixels/text/base64).
  const meta: VisionImageMeta[] = images.map((img) => {
    const b64 = img.dataUrl.split(",")[1] ?? "";
    const bytes2 = Buffer.from(b64, "base64");
    const dims = bytes2.length >= 24 ? pngDimensions(bytes2) : { width: 0, height: 0 };
    return {
      id: img.id,
      kind: img.kind,
      page: img.page,
      band: img.band,
      crop: img.crop,
      width: dims.width,
      height: dims.height,
      byteSize: bytes2.length,
    };
  });
  return {
    available: true,
    images,
    renderedPages: pages.size,
    crops: images.filter((i) => i.crop).length,
    fullPages: images.filter((i) => !i.crop).length,
    failureReason: null,
    meta,
  };
}
