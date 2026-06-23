// Centralized, testable review-screen copy. The conversion STATUS is honest:
// it only says "AI-assisted" when a real, usable AI result was applied. General
// marketing/pricing copy may say "AI-assisted" freely; this is the per-file
// result banner. The phrase "AI-recovered" is intentionally never used.
//
// PRIVACY: static strings only — never statement content.

import type { AiAssistStatus } from "./ai-assist.ts";

export type ReviewMessage = {
  variant: "success" | "warning";
  title: string;
  body: string;
};

export const REVIEW_MESSAGES = {
  parserPassed: {
    variant: "success",
    title: "Balance check passed",
    body: "Please review the rows before export.",
  },
  needsReview: {
    variant: "warning",
    title: "This conversion needs review",
    body: "Check the highlighted rows before export.",
  },
  aiCouldNotRepair: {
    variant: "warning",
    title: "Automatic review could not fully repair this conversion",
    body: "Please review the highlighted rows before export.",
  },
  aiNoImprovement: {
    variant: "warning",
    title: "AI-assisted review completed",
    body: "This conversion still needs review. Check the highlighted rows before export.",
  },
  aiImproved: {
    variant: "warning",
    title: "AI-assisted review improved this conversion",
    body: "It still needs review — check the highlighted rows before export.",
  },
  aiReconciled: {
    variant: "success",
    title: "AI-assisted review completed",
    body: "Balance check passed — please review the rows before export.",
  },
} as const satisfies Record<string, ReviewMessage>;

/**
 * Pick the honest result banner. AI-assisted wording is used only for statuses
 * where a real, usable AI result was produced (no-improvement / improved /
 * reconciled). For not-configured / disabled / call-failed / invalid responses
 * the copy stays parser-only and never implies AI ran on this file.
 */
export function selectReviewMessage(
  status: AiAssistStatus | undefined,
  needsReview: boolean,
): ReviewMessage {
  switch (status) {
    case "reconciled":
      return REVIEW_MESSAGES.aiReconciled;
    case "improved":
      return REVIEW_MESSAGES.aiImproved;
    case "no-improvement":
      return REVIEW_MESSAGES.aiNoImprovement;
    case "call-failed":
    case "invalid-response":
    case "no-usable-result":
      return REVIEW_MESSAGES.aiCouldNotRepair;
    default:
      // not-eligible / disabled / not-configured / attempted / unknown:
      // honest parser-only copy — AI was not used on this file.
      return needsReview ? REVIEW_MESSAGES.needsReview : REVIEW_MESSAGES.parserPassed;
  }
}

// Scanned/image message lives in parser.ts as SCANNED_PDF_WARNING (shared with
// the API route); re-exported here so UI/tests have one import for review copy.
export { SCANNED_PDF_WARNING } from "./parser.ts";
