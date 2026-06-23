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

export type VisionBand = "top" | "middle" | "bottom" | "full";

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
  /** true = a targeted crop; false = a (downscaled) full relevant page fallback. */
  crop: boolean;
  /** data: URL of the rendered PNG. Never logged. */
  dataUrl: string;
};

export type VisionRenderResult = {
  available: boolean;
  images: VisionImage[];
  renderedPages: number;
  crops: number;
  fullPages: number;
  /** Safe label when no images were produced (e.g. "render-backend-unavailable"). */
  failureReason: string | null;
};

export type SelectRegionsInput = {
  pageCount: number;
  hasLowConfidence: boolean;
  /** Page hints related to the validation failure (1-based), if known. */
  failurePages?: number[];
  maxRegions?: number;
};

/**
 * Choose the minimal set of regions to render for the vision fallback. Targets
 * the summary/opening-closing area, the table header + body, the final rows, and
 * the totals/closing area; adds a low-confidence region only when present. Never
 * targets footer/legal/blank/ads/contact regions. Pure + deterministic.
 */
export function selectVisionRegions(input: SelectRegionsInput): VisionRegion[] {
  const pages = Math.max(1, input.pageCount || 1);
  const last = pages;
  const max = input.maxRegions ?? 6;
  const regions: VisionRegion[] = [];
  const add = (kind: VisionRegionKind, page: number, band: VisionBand) => {
    if (page < 1 || page > pages) return;
    regions.push({ id: `${kind}-p${page}-${band}`, kind, page, band });
  };

  // Page 1 holds the account summary + the start of the transaction table.
  add("summary", 1, "top");
  add("table-header", 1, "middle");
  add("table-body", 1, "middle");
  // The closing balance + final rows are on the last page.
  add("final-rows", last, "bottom");
  add("totals", last, "bottom");
  // Any page implicated in the reconciliation failure (middle band of that page).
  for (const p of input.failurePages ?? []) add("table-body", p, "middle");
  if (input.hasLowConfidence) add("low-confidence", 1, "middle");

  // De-dupe by id and cap (token control: targeted, not the whole document).
  const seen = new Set<string>();
  const unique = regions.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  return unique.slice(0, max);
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

/**
 * Real default renderer: renders each PDF page once (unpdf + @napi-rs/canvas),
 * caches it, then crops the region's vertical band (napi-canvas). Falls back to
 * the full relevant page if cropping fails, and returns null if the page cannot be
 * rendered at all (no backend) so the caller degrades to text-layout evidence.
 * Native deps are imported dynamically (server-only) so they never reach a client
 * bundle. `scaleWidth` bounds the rendered width for token/size control.
 */
export function createDefaultRegionRenderer(scaleWidth = 1100): RegionRenderer {
  const pageCache = new Map<number, { png: Uint8Array; height: number } | null>();
  return async (bytes, region) => {
    let page = pageCache.get(region.page);
    if (page === undefined) {
      try {
        const { renderPageAsImage } = await import("unpdf");
        const out = await renderPageAsImage(bytes, region.page, {
          canvasImport: () => import("@napi-rs/canvas"),
          width: scaleWidth,
        });
        const u8 = out instanceof Uint8Array ? out : new Uint8Array(out);
        page = { png: u8, height: pngDimensions(u8).height };
      } catch {
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
}

/**
 * Render the selected regions to images (best-effort). Prefers crops; uses a full
 * relevant page only when cropping is unavailable. Caps image count for token
 * control. Returns available=false with a safe failureReason when no images are
 * produced — the caller then runs the AI fallback on text-layout evidence only.
 */
export async function renderVisionEvidence(
  bytes: Uint8Array,
  regions: VisionRegion[],
  opts: { enabled: boolean; renderer?: RegionRenderer; maxImages?: number } = { enabled: false },
): Promise<VisionRenderResult> {
  if (!opts.enabled) {
    return { available: false, images: [], renderedPages: 0, crops: 0, fullPages: 0, failureReason: "vision-disabled" };
  }
  if (regions.length === 0) {
    return { available: false, images: [], renderedPages: 0, crops: 0, fullPages: 0, failureReason: "no-regions" };
  }
  const usingDefault = !opts.renderer;
  const renderer = opts.renderer ?? createDefaultRegionRenderer();
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
      crop: rendered.crop,
      dataUrl: rendered.dataUrl,
    });
  }
  if (images.length === 0) {
    const reason = usingDefault ? (await probeRenderBackend()).reason ?? "render-failed" : "render-failed";
    return { available: false, images: [], renderedPages: 0, crops: 0, fullPages: 0, failureReason: reason };
  }
  return {
    available: true,
    images,
    renderedPages: pages.size,
    crops: images.filter((i) => i.crop).length,
    fullPages: images.filter((i) => !i.crop).length,
    failureReason: null,
  };
}
