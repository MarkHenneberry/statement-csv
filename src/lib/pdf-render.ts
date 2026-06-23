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

/**
 * Best-effort default renderer: dynamically imports unpdf's image renderer and
 * renders the region's PAGE (downscaled) as a full relevant page (crop=false).
 * Real per-region cropping needs a canvas-based cropper; until one is wired this
 * returns the relevant page (the documented full-page fallback). Returns null on
 * any failure so the caller degrades to text/layout-only evidence.
 */
const defaultRegionRenderer: RegionRenderer = async (bytes, region) => {
  try {
    const mod = (await import("unpdf")) as unknown as {
      renderPageAsImage?: (
        data: Uint8Array,
        page: number,
        opts?: Record<string, unknown>,
      ) => Promise<ArrayBuffer | Uint8Array>;
    };
    if (typeof mod.renderPageAsImage !== "function") return null;
    const out = await mod.renderPageAsImage(bytes, region.page, { scale: 1 });
    const b64 = Buffer.from(out instanceof Uint8Array ? out : new Uint8Array(out)).toString("base64");
    return { dataUrl: `data:image/png;base64,${b64}`, crop: false };
  } catch {
    return null; // no canvas / render failure → degrade gracefully
  }
};

/**
 * Render the selected regions to images (best-effort). Prefers crops; uses a
 * downscaled full relevant page only when a crop is unavailable. Caps the number
 * of images for token control. Returns available=false (no images) when the
 * renderer is missing — the caller then runs the AI fallback on text evidence.
 */
export async function renderVisionEvidence(
  bytes: Uint8Array,
  regions: VisionRegion[],
  opts: { enabled: boolean; renderer?: RegionRenderer; maxImages?: number } = { enabled: false },
): Promise<VisionRenderResult> {
  const empty: VisionRenderResult = { available: false, images: [], renderedPages: 0, crops: 0, fullPages: 0 };
  if (!opts.enabled || regions.length === 0) return empty;
  const renderer = opts.renderer ?? defaultRegionRenderer;
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
  if (images.length === 0) return empty;
  return {
    available: true,
    images,
    renderedPages: pages.size,
    crops: images.filter((i) => i.crop).length,
    fullPages: images.filter((i) => !i.crop).length,
  };
}
