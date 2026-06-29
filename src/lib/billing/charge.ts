import "server-only";
import { prisma } from "@/lib/db";
import { getRemainingPages } from "./credits";

// Single server-only entry point for deducting page credits for a conversion.
// Idempotent + race-safe: the charge is "claimed" with an atomic conditional
// UPDATE on Conversion.chargedAt (WHERE chargedAt IS NULL), so concurrent/double
// clicks can never deduct twice — the loser sees zero rows updated and returns the
// already-charged result. Everything runs in one DB transaction. Stores only safe
// metadata (page counts), never statement content.

export type ChargeReason = "verified_conversion" | "review_export";

export type ChargeResult =
  | {
      ok: true;
      chargedPages: number;
      pagesRemaining: number;
      alreadyCharged: boolean;
    }
  | {
      ok: false;
      error: "NOT_FOUND" | "FORBIDDEN" | "NOT_CHARGEABLE" | "INSUFFICIENT_PAGE_CREDITS";
    };

async function chargeConversion(
  conversionId: string,
  userId: string,
  reason: ChargeReason,
  opts: { requireReviewStatus?: boolean } = {},
): Promise<ChargeResult> {
  return prisma.$transaction(async (tx) => {
    const conv = await tx.conversion.findUnique({ where: { id: conversionId } });
    if (!conv) return { ok: false, error: "NOT_FOUND" };
    if (conv.userId !== userId) return { ok: false, error: "FORBIDDEN" };

    // Already charged → idempotent success (no second deduction).
    if (conv.chargedAt) {
      const acct = await tx.billingAccount.findUnique({ where: { userId } });
      return {
        ok: true,
        chargedPages: conv.creditsCharged,
        pagesRemaining: acct ? getRemainingPages(acct) : 0,
        alreadyCharged: true,
      };
    }

    // Review-export charges may only apply to a review-status conversion.
    if (opts.requireReviewStatus && conv.status !== "review") {
      return { ok: false, error: "NOT_CHARGEABLE" };
    }

    const pages = conv.pageCount;
    const acct = await tx.billingAccount.findUnique({ where: { userId } });
    if (!acct) return { ok: false, error: "NOT_FOUND" };
    if (getRemainingPages(acct) < pages) {
      return { ok: false, error: "INSUFFICIENT_PAGE_CREDITS" };
    }

    // Atomic claim: only one concurrent caller flips chargedAt from null.
    const claim = await tx.conversion.updateMany({
      where: { id: conversionId, userId, chargedAt: null },
      data: { chargedAt: new Date(), creditsCharged: pages },
    });
    if (claim.count === 0) {
      // Lost the race — another call already charged it. Report current state.
      const fresh = await tx.conversion.findUnique({ where: { id: conversionId } });
      const freshAcct = await tx.billingAccount.findUnique({ where: { userId } });
      return {
        ok: true,
        chargedPages: fresh?.creditsCharged ?? pages,
        pagesRemaining: freshAcct ? getRemainingPages(freshAcct) : 0,
        alreadyCharged: true,
      };
    }

    await tx.billingAccount.update({
      where: { userId },
      data: { pagesUsedThisPeriod: { increment: pages } },
    });
    await tx.pageCreditLedger.create({
      data: { userId, conversionId, deltaPages: -pages, reason },
    });

    return {
      ok: true,
      chargedPages: pages,
      pagesRemaining: getRemainingPages(acct) - pages,
      alreadyCharged: false,
    };
  });
}

/** Charge a verified conversion (called server-side right after a verified parse). */
export function chargeVerifiedConversion(conversionId: string, userId: string): Promise<ChargeResult> {
  return chargeConversion(conversionId, userId, "verified_conversion");
}

/** Charge a review-highlighted conversion when (and only when) the user exports. */
export function chargeReviewExport(conversionId: string, userId: string): Promise<ChargeResult> {
  return chargeConversion(conversionId, userId, "review_export", { requireReviewStatus: true });
}
