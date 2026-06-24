// Centralized conversion PRESENTATION state — the single source of truth for how
// a finished conversion is communicated, kept separate from the raw validation
// math. The UI derives its badge, banner, secondary copy, and export-area styling
// from this so confidence is communicated consistently and never contradicts the
// underlying validation.
//
// PRIVACY: static copy + safe aggregates only. No statement content ever flows in.

import type { EffectiveBalanceStatus } from "./upload.ts";

export type ConversionState =
  | "verified"
  | "review-recommended"
  | "needs-review"
  | "preview-limited"
  | "unsupported";

export type ConversionInputs = {
  /** Validation-aware balance status (see resolveBalanceStatus). */
  balanceStatus: EffectiveBalanceStatus;
  /** Overall model confidence 0..1. */
  confidence: number;
  /** Number of usable rows. */
  rowCount: number;
  /** Rows with MATERIAL warnings (missing amount/date/description, etc.). */
  materialWarningCount: number;
  /** Rows with only minor warnings (e.g. low confidence). */
  minorWarningCount: number;
  /** True when the statement summary totals matched; null when none to compare. */
  summaryMatched: boolean | null;
  /** Only the preview pages were converted (free preview / page cap). */
  previewLimited: boolean;
  /** Scanned/encrypted/no extractable content. */
  unsupported: boolean;
};

export type ExportTone = "safe" | "review" | "neutral";

export type ConversionPresentation = {
  state: ConversionState;
  badgeLabel: string;
  badgeTone: "green" | "amber" | "red" | "neutral";
  bannerVariant: "success" | "info" | "warning" | "error";
  bannerTitle: string;
  bannerBody: string;
  /** Optional softer secondary line (e.g. "spot-checking is optional"). */
  secondaryCopy: string | null;
  /** Whether to show the prominent top export area (also requires rows). */
  showTopExport: boolean;
  exportTone: ExportTone;
  exportNote: string;
  /** Label prefix for the export buttons, e.g. "preview" → "Download preview CSV". */
  exportLabelPrefix: string | null;
};

/** Confidence at/above which a passed conversion may be called "verified". */
export const VERIFIED_CONFIDENCE = 0.7;

/** Max material row warnings that a RECONCILED statement can have and still be
 * "review-recommended" (a small, localized issue) rather than "needs-review". */
export const LOCALIZED_MATERIAL_MAX_COUNT = 3;
/** ...and the share of rows it may affect. Above either limit it is needs-review. */
export const LOCALIZED_MATERIAL_MAX_RATE = 0.05;

/**
 * The base state ignoring the page-cap overlay. A reconciled statement with a
 * small, localized number of material row warnings (e.g. one unreadable
 * description in 65 rows) is "review-recommended", not "needs-review" — the totals
 * still matched, the user just needs to glance at a row or two.
 */
function baseState(input: ConversionInputs): ConversionState {
  if (input.rowCount === 0) return "needs-review";
  const passed = input.balanceStatus === "passed";
  if (!passed || input.summaryMatched === false) return "needs-review";

  const material = input.materialWarningCount;
  const rate = material / Math.max(1, input.rowCount);
  const localized = material <= LOCALIZED_MATERIAL_MAX_COUNT && rate <= LOCALIZED_MATERIAL_MAX_RATE;
  if (material > 0 && !localized) return "needs-review";

  const highConfidence = input.confidence >= VERIFIED_CONFIDENCE;
  if (material === 0 && input.minorWarningCount === 0 && highConfidence) return "verified";
  return "review-recommended";
}

/**
 * Resolve the conversion presentation state. Precedence: unsupported → no rows →
 * base (verified / review-recommended / needs-review), with a preview-limited
 * OVERLAY that applies only when the base is otherwise good (a real problem is
 * never hidden behind preview-limited).
 */
export function resolveConversionState(input: ConversionInputs): ConversionState {
  if (input.unsupported) return "unsupported";
  if (input.rowCount === 0) return "needs-review";
  const base = baseState(input);
  if (input.previewLimited && base !== "needs-review") return "preview-limited";
  return base;
}

/** Map a conversion state to its full presentation (copy + styling). */
export function conversionPresentation(input: ConversionInputs): ConversionPresentation {
  const state = resolveConversionState(input);
  const hasRows = input.rowCount > 0;
  const highlightCount = input.materialWarningCount + input.minorWarningCount;
  const rowsPhrase = `${highlightCount} highlighted ${highlightCount === 1 ? "row" : "rows"}`;
  switch (state) {
    case "verified":
      return {
        state,
        badgeLabel: "Verified",
        badgeTone: "green",
        bannerVariant: "success",
        bannerTitle: "Conversion verified",
        bannerBody: "Totals matched. You can export now.",
        secondaryCopy: "Spot-checking is optional but recommended for important records.",
        showTopExport: hasRows,
        exportTone: "safe",
        exportNote: "Totals matched. Export is ready.",
        exportLabelPrefix: null,
      };
    case "review-recommended":
      return {
        state,
        badgeLabel: "Review recommended",
        badgeTone: "amber",
        bannerVariant: "warning",
        bannerTitle: "Review recommended",
        // Totals reconciled, so never imply the conversion could not be verified.
        bannerBody:
          highlightCount > 0
            ? `Totals matched. Review ${rowsPhrase} before export.`
            : "Totals matched. Review the highlighted rows before export.",
        secondaryCopy: null,
        showTopExport: hasRows,
        exportTone: "review",
        exportNote: "Totals matched. Please review the highlighted rows before export.",
        exportLabelPrefix: null,
      };
    case "preview-limited":
      return {
        state,
        badgeLabel: "Preview converted",
        badgeTone: "neutral",
        bannerVariant: "info",
        bannerTitle: "Preview converted",
        bannerBody:
          "Only the preview pages were converted. Converting the full statement will be available with an upgrade.",
        secondaryCopy:
          input.balanceStatus === "passed"
            ? "The previewed pages reconciled."
            : null,
        showTopExport: hasRows,
        exportTone: "neutral",
        exportNote: "This is a partial (preview) export of the first pages only.",
        exportLabelPrefix: "preview",
      };
    case "unsupported":
      return {
        state,
        badgeLabel: "Unsupported",
        badgeTone: "red",
        bannerVariant: "error",
        bannerTitle: "This PDF can’t be converted",
        bannerBody:
          "We couldn’t read transactions from this file. Scanned/image-only or protected PDFs aren’t supported yet.",
        secondaryCopy: null,
        showTopExport: false,
        exportTone: "neutral",
        exportNote: "",
        exportLabelPrefix: null,
      };
    case "needs-review":
    default:
      return {
        state: "needs-review",
        badgeLabel: "Needs review",
        badgeTone: "amber",
        bannerVariant: "warning",
        bannerTitle: "Needs review",
        bannerBody:
          "We could not fully verify this conversion. Review the highlighted rows before export.",
        secondaryCopy: null,
        showTopExport: hasRows,
        exportTone: "review",
        exportNote: "Review the highlighted rows first. This conversion is not verified.",
        exportLabelPrefix: null,
      };
  }
}
