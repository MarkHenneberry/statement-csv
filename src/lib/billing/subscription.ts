import "server-only";
import { prisma } from "@/lib/db";
import { getPlanAllowance, type PlanKey } from "./plans";
import { periodAdvanced } from "./credits";
import type { SubscriptionStatus } from "./types";

// Server-only helpers that translate Stripe subscription state into BillingAccount
// updates. Idempotent: re-delivering the same Stripe event leaves the account in the
// same state, and a renewal only resets usage once (period-start comparison).
//
// CANCELLATION BEHAVIOR (chosen MVP): on `customer.subscription.deleted` we downgrade
// the account to the free plan immediately (status=canceled, planKey=free, allowance=0)
// and clear the subscription id. The Stripe customer id is kept so the user can
// resubscribe. (Mid-cycle cancellations that Stripe still reports as active arrive as
// `customer.subscription.updated` and keep the paid plan until Stripe deletes it.)

/** Resolve our app userId from event metadata, falling back to the Stripe customer. */
export async function resolveUserId(opts: {
  metadataUserId?: string | null;
  stripeCustomerId?: string | null;
}): Promise<string | null> {
  if (opts.metadataUserId) return opts.metadataUserId;
  if (opts.stripeCustomerId) {
    const acct = await prisma.billingAccount.findFirst({
      where: { stripeCustomerId: opts.stripeCustomerId },
      select: { userId: true },
    });
    return acct?.userId ?? null;
  }
  return null;
}

export type SubscriptionSnapshot = {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planKey: PlanKey;
  status: SubscriptionStatus;
  periodStart: Date;
  periodEnd: Date;
};

/**
 * Apply a Stripe subscription snapshot to the user's BillingAccount. Sets plan,
 * status, allowance, Stripe ids, and period bounds. If the billing period advanced
 * (renewal), resets `pagesUsedThisPeriod` to 0 and writes a `monthly_reset` ledger
 * entry. No-op (safe) if the user has no account row.
 */
export async function applyStripeSubscription(snap: SubscriptionSnapshot): Promise<void> {
  const account = await prisma.billingAccount.findUnique({ where: { userId: snap.userId } });
  if (!account) return; // user row is created at sign-in; nothing to update otherwise

  const advanced = periodAdvanced(account.currentPeriodStart, snap.periodStart);

  await prisma.billingAccount.update({
    where: { userId: snap.userId },
    data: {
      stripeCustomerId: snap.stripeCustomerId,
      stripeSubscriptionId: snap.stripeSubscriptionId,
      planKey: snap.planKey,
      status: snap.status,
      monthlyPageAllowance: getPlanAllowance(snap.planKey),
      currentPeriodStart: snap.periodStart,
      currentPeriodEnd: snap.periodEnd,
      ...(advanced ? { pagesUsedThisPeriod: 0 } : {}),
    },
  });

  if (advanced) {
    await prisma.pageCreditLedger.create({
      data: {
        userId: snap.userId,
        deltaPages: getPlanAllowance(snap.planKey),
        reason: "monthly_reset",
      },
    });
  }
}

/** Mark an account past_due (payment failure). No-op if the account is missing. */
export async function markPastDue(userId: string): Promise<void> {
  await prisma.billingAccount.updateMany({
    where: { userId },
    data: { status: "past_due" },
  });
}

/** Downgrade to the free plan on full subscription deletion. */
export async function downgradeToFree(userId: string): Promise<void> {
  await prisma.billingAccount.updateMany({
    where: { userId },
    data: {
      status: "canceled",
      planKey: "free",
      monthlyPageAllowance: getPlanAllowance("free"),
      stripeSubscriptionId: null,
    },
  });
}
