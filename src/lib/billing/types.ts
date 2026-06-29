// Billing domain types. These mirror the Prisma schema blueprint in
// prisma/schema.prisma and are the in-code contracts the helper functions operate
// on. The next pass generates Prisma client types from the schema; these stay as
// the plain shapes used by pure logic + tests (no DB client needed here).
//
// PRIVACY: these records intentionally hold ONLY safe operational metadata. We do
// NOT store transaction rows, raw PDF text, PDF files, rendered images, or AI
// prompts/responses. See src/lib/billing/README.md.

import type { PlanKey } from "./plans.ts";

/** Subscription lifecycle state (mirrors common Stripe subscription statuses). */
export type SubscriptionStatus =
  | "free"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

/** Billing-relevant outcome of a conversion. */
export type ConversionStatus = "verified" | "review" | "failed";

/** Balance-check outcome (operational metadata only). */
export type BalanceStatus = "passed" | "review" | "limited";

/** Why a page-credit ledger entry was written. */
export type LedgerReason =
  | "verified_conversion"
  | "review_export"
  | "refund"
  | "monthly_reset"
  | "manual_adjustment";

export type User = {
  id: string;
  email: string;
  name?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Per-user billing/subscription state + the current period's page-credit counters.
 * `monthlyPageAllowance` is snapshotted onto the account (so a mid-cycle plan change
 * does not retroactively change the active period) and is kept in sync with the
 * plan's allowance by billing logic / Stripe webhooks in a later pass.
 */
export type BillingAccount = {
  userId: string;
  planKey: PlanKey;
  status: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  monthlyPageAllowance: number;
  pagesUsedThisPeriod: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Operational record of a conversion. `userId` is nullable so an anonymous free
 * preview can still be recorded. NO statement content is stored — only counts,
 * statuses, and timestamps. `originalFilename` is optional and should be treated as
 * potentially sensitive (store only if needed; it is never required by billing).
 */
export type ConversionRecord = {
  id: string;
  userId?: string | null;
  originalFilename?: string | null;
  pageCount: number;
  status: ConversionStatus;
  balanceStatus?: BalanceStatus | null;
  /** Page credits actually charged for this conversion (0 until/unless charged). */
  creditsCharged: number;
  chargedAt?: Date | null;
  exportedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Append-only ledger of page-credit movements (audit trail for usage + resets). */
export type PageCreditLedgerEntry = {
  id: string;
  userId: string;
  conversionId?: string | null;
  /** Pages added (+, e.g. monthly_reset/refund) or consumed (-, e.g. a conversion). */
  deltaPages: number;
  reason: LedgerReason;
  createdAt: Date;
};
