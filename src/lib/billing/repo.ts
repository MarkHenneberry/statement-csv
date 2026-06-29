import "server-only";
import { prisma } from "@/lib/db";
import { getPlanAllowance, type PlanKey } from "./plans";
import { nextPeriodEnd } from "./credits";
import type { ConversionStatus, BalanceStatus, LedgerReason } from "./types";

// Thin, server-only database helpers for the billing/page-credit foundation.
//
// IMPORTANT: these are NOT called from the upload/export routes yet. They exist so
// the next auth + enforcement pass can wire credit deduction cleanly. They store
// ONLY safe operational metadata — never PDF files, raw PDF text, transaction rows,
// rendered images, or AI prompts/responses.

/** Look up a user's billing account (null if none yet). */
export function getBillingAccountByUserId(userId: string) {
  return prisma.billingAccount.findUnique({ where: { userId } });
}

/** Create a billing account for a user with the plan's allowance + a fresh period. */
export function createDefaultBillingAccount(
  userId: string,
  planKey: PlanKey = "free",
  now: Date = new Date(),
) {
  return prisma.billingAccount.create({
    data: {
      userId,
      planKey,
      status: "free",
      monthlyPageAllowance: getPlanAllowance(planKey),
      pagesUsedThisPeriod: 0,
      currentPeriodStart: now,
      currentPeriodEnd: nextPeriodEnd(now),
    },
  });
}

/** Increment (or decrement) the pages used in the current period. */
export function updateBillingUsage(userId: string, pagesDelta: number) {
  return prisma.billingAccount.update({
    where: { userId },
    data: { pagesUsedThisPeriod: { increment: pagesDelta } },
  });
}

/** Record a conversion (safe metadata only; no statement content). */
export function createConversionRecord(data: {
  userId?: string | null;
  originalFilename?: string | null;
  pageCount: number;
  status: ConversionStatus;
  balanceStatus?: BalanceStatus | null;
  creditsCharged?: number;
}) {
  return prisma.conversion.create({
    data: {
      userId: data.userId ?? null,
      originalFilename: data.originalFilename ?? null,
      pageCount: data.pageCount,
      status: data.status,
      balanceStatus: data.balanceStatus ?? null,
      creditsCharged: data.creditsCharged ?? 0,
    },
  });
}

/** Append a page-credit ledger entry (audit trail for usage + resets). */
export function createPageCreditLedgerEntry(data: {
  userId: string;
  conversionId?: string | null;
  deltaPages: number;
  reason: LedgerReason;
}) {
  return prisma.pageCreditLedger.create({
    data: {
      userId: data.userId,
      conversionId: data.conversionId ?? null,
      deltaPages: data.deltaPages,
      reason: data.reason,
    },
  });
}
