import "server-only";
import { prisma } from "@/lib/db";

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
  opts: { requireReviewStatus?: boolean; effectiveAllowance?: number } = {},
): Promise<ChargeResult> {
  // Remaining pages honoring an OPTIONAL effective allowance override (used for
  // internal testers, whose effective allowance is higher than their stored plan
  // allowance). When no override is given this is exactly getRemainingPages, so
  // normal free/paid charging is unchanged.
  const remainingFor = (acct: { monthlyPageAllowance: number; pagesUsedThisPeriod: number }) => {
    const allowance =
      opts.effectiveAllowance != null
        ? Math.max(opts.effectiveAllowance, acct.monthlyPageAllowance)
        : acct.monthlyPageAllowance;
    return Math.max(0, allowance - acct.pagesUsedThisPeriod);
  };

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
        pagesRemaining: acct ? remainingFor(acct) : 0,
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
    if (remainingFor(acct) < pages) {
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
        pagesRemaining: freshAcct ? remainingFor(freshAcct) : 0,
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
      pagesRemaining: remainingFor(acct) - pages,
      alreadyCharged: false,
    };
  });
}

/**
 * Charge a verified conversion (called server-side right after a verified parse).
 * `effectiveAllowance` (optional) raises the remaining-pages ceiling for internal
 * testers; omit it for normal accounts (behavior unchanged).
 */
export function chargeVerifiedConversion(
  conversionId: string,
  userId: string,
  effectiveAllowance?: number,
): Promise<ChargeResult> {
  return chargeConversion(conversionId, userId, "verified_conversion", { effectiveAllowance });
}

/** Charge a review-highlighted conversion when (and only when) the user exports. */
export function chargeReviewExport(
  conversionId: string,
  userId: string,
  effectiveAllowance?: number,
): Promise<ChargeResult> {
  return chargeConversion(conversionId, userId, "review_export", {
    requireReviewStatus: true,
    effectiveAllowance,
  });
}
