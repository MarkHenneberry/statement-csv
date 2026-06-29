// Page-credit ENFORCEMENT sanity check (Supabase Postgres, write test).
//
//   CREDIT_ENFORCEMENT_TEST=true node --experimental-strip-types scripts/credit-enforcement-sanity.mts
//
// Verifies the DB-level credit-deduction guarantees against the real schema:
//   - a verified conversion deducts exactly its page count, once
//   - a repeated charge of the same conversion does NOT deduct twice (idempotent)
//   - a review conversion is only charged on export, and exactly once
//   - a failed conversion deducts 0
//   - one user cannot charge another user's conversion (FORBIDDEN)
//   - an insufficient balance blocks the charge
//
// It mirrors the atomic-claim transaction in src/lib/billing/charge.ts (which uses
// `server-only` + the `@/` alias and so cannot be imported by a plain node script).
// If the mirrored logic and charge.ts ever diverge, this test loses meaning — keep
// them in sync.
//
// SAFETY: connects only when DATABASE_URL is set AND CREDIT_ENFORCEMENT_TEST=true.
// It writes only clearly-marked dev rows (emails under @enforcement-test.local) and
// deletes everything it created in a finally block. It stores no statement content
// and never prints connection strings or secrets.

import { PrismaClient } from "@prisma/client";
import { getRemainingPages } from "../src/lib/billing/credits.ts";

if (!process.env.DATABASE_URL) {
  console.log("No DATABASE_URL set — skipping credit enforcement check (this is fine).");
  process.exit(0);
}
if (process.env.CREDIT_ENFORCEMENT_TEST !== "true") {
  console.log("Set CREDIT_ENFORCEMENT_TEST=true to run the credit enforcement DB test (writes + cleans up dev rows).");
  process.exit(0);
}

const prisma = new PrismaClient();

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok    ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type ChargeResult =
  | { ok: true; chargedPages: number; pagesRemaining: number; alreadyCharged: boolean }
  | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" | "NOT_CHARGEABLE" | "INSUFFICIENT_PAGE_CREDITS" };

// Mirror of chargeConversion() in src/lib/billing/charge.ts.
async function chargeConversion(
  conversionId: string,
  userId: string,
  reason: "verified_conversion" | "review_export",
  opts: { requireReviewStatus?: boolean } = {},
): Promise<ChargeResult> {
  return prisma.$transaction(async (tx) => {
    const conv = await tx.conversion.findUnique({ where: { id: conversionId } });
    if (!conv) return { ok: false, error: "NOT_FOUND" };
    if (conv.userId !== userId) return { ok: false, error: "FORBIDDEN" };
    if (conv.chargedAt) {
      const acct = await tx.billingAccount.findUnique({ where: { userId } });
      return {
        ok: true,
        chargedPages: conv.creditsCharged,
        pagesRemaining: acct ? getRemainingPages(acct) : 0,
        alreadyCharged: true,
      };
    }
    if (opts.requireReviewStatus && conv.status !== "review") {
      return { ok: false, error: "NOT_CHARGEABLE" };
    }
    const pages = conv.pageCount;
    const acct = await tx.billingAccount.findUnique({ where: { userId } });
    if (!acct) return { ok: false, error: "NOT_FOUND" };
    if (getRemainingPages(acct) < pages) return { ok: false, error: "INSUFFICIENT_PAGE_CREDITS" };

    const claim = await tx.conversion.updateMany({
      where: { id: conversionId, userId, chargedAt: null },
      data: { chargedAt: new Date(), creditsCharged: pages },
    });
    if (claim.count === 0) {
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
    await tx.pageCreditLedger.create({ data: { userId, conversionId, deltaPages: -pages, reason } });
    return { ok: true, chargedPages: pages, pagesRemaining: getRemainingPages(acct) - pages, alreadyCharged: false };
  });
}

const createdUserIds: string[] = [];

async function makeUser(label: string, allowance: number, used: number): Promise<string> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@enforcement-test.local`;
  const now = new Date();
  const user = await prisma.user.create({ data: { email, name: "Enforcement Test (dev)" } });
  createdUserIds.push(user.id);
  await prisma.billingAccount.create({
    data: {
      userId: user.id,
      planKey: "plus",
      status: "active",
      monthlyPageAllowance: allowance,
      pagesUsedThisPeriod: used,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return user.id;
}

function makeConversion(userId: string, status: "verified" | "review" | "failed", pageCount: number) {
  return prisma.conversion.create({
    data: { userId, pageCount, status, balanceStatus: null, creditsCharged: 0 },
  });
}

async function usedPages(userId: string): Promise<number> {
  const acct = await prisma.billingAccount.findUnique({ where: { userId } });
  return acct?.pagesUsedThisPeriod ?? -1;
}

async function main(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;

  // 1. Verified conversion deducts exactly its page count, once.
  {
    const uid = await makeUser("verified", 100, 0);
    const conv = await makeConversion(uid, "verified", 6);
    const r1 = await chargeConversion(conv.id, uid, "verified_conversion");
    check("verified charge deducts page count", r1.ok && r1.chargedPages === 6 && r1.alreadyCharged === false, JSON.stringify(r1));
    check("verified charge updates usage to 6", (await usedPages(uid)) === 6);

    // Repeated charge does not double-deduct.
    const r2 = await chargeConversion(conv.id, uid, "verified_conversion");
    check("repeated verified charge is idempotent (alreadyCharged)", r2.ok && r2.alreadyCharged === true, JSON.stringify(r2));
    check("repeated verified charge leaves usage at 6", (await usedPages(uid)) === 6);
    const ledger = await prisma.pageCreditLedger.count({ where: { conversionId: conv.id } });
    check("exactly one ledger entry for the verified conversion", ledger === 1, `ledger=${ledger}`);
  }

  // 2. Review conversion charges only on export, exactly once.
  {
    const uid = await makeUser("review", 100, 0);
    const conv = await makeConversion(uid, "review", 4);
    check("review conversion has not charged at parse time", (await usedPages(uid)) === 0);
    const r1 = await chargeConversion(conv.id, uid, "review_export", { requireReviewStatus: true });
    check("review export charges page count", r1.ok && r1.chargedPages === 4 && r1.alreadyCharged === false, JSON.stringify(r1));
    check("review export updates usage to 4", (await usedPages(uid)) === 4);
    const r2 = await chargeConversion(conv.id, uid, "review_export", { requireReviewStatus: true });
    check("repeated review export is idempotent", r2.ok && r2.alreadyCharged === true, JSON.stringify(r2));
    check("repeated review export leaves usage at 4", (await usedPages(uid)) === 4);
  }

  // 3. Failed conversion deducts 0 (review-export rejects a non-review status).
  {
    const uid = await makeUser("failed", 100, 0);
    const conv = await makeConversion(uid, "failed", 5);
    const r = await chargeConversion(conv.id, uid, "review_export", { requireReviewStatus: true });
    check("failed conversion is NOT_CHARGEABLE on export", !r.ok && r.error === "NOT_CHARGEABLE", JSON.stringify(r));
    check("failed conversion leaves usage at 0", (await usedPages(uid)) === 0);
  }

  // 4. Cross-user charge is forbidden.
  {
    const owner = await makeUser("owner", 100, 0);
    const attacker = await makeUser("attacker", 100, 0);
    const conv = await makeConversion(owner, "verified", 3);
    const r = await chargeConversion(conv.id, attacker, "verified_conversion");
    check("cross-user charge is FORBIDDEN", !r.ok && r.error === "FORBIDDEN", JSON.stringify(r));
    check("attacker usage unchanged (0)", (await usedPages(attacker)) === 0);
    check("owner conversion remains uncharged (0)", (await usedPages(owner)) === 0);
  }

  // 5. Insufficient balance blocks the charge.
  {
    const uid = await makeUser("insufficient", 100, 97); // remaining 3
    const conv = await makeConversion(uid, "verified", 6);
    const r = await chargeConversion(conv.id, uid, "verified_conversion");
    check("insufficient credits block the charge", !r.ok && r.error === "INSUFFICIENT_PAGE_CREDITS", JSON.stringify(r));
    check("insufficient case leaves usage unchanged (97)", (await usedPages(uid)) === 97);
  }

  console.log(
    failures === 0
      ? `\nAll credit-enforcement DB checks passed.`
      : `\n${failures} credit-enforcement check(s) failed.`,
  );
}

main()
  .catch((err) => {
    failures += 1;
    console.error("credit enforcement check failed:", err instanceof Error ? err.message : "unknown error");
  })
  .finally(async () => {
    // Clean up every row created by this test (ledger + conversions cascade off user).
    for (const userId of createdUserIds) {
      await prisma.pageCreditLedger.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.conversion.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.billingAccount.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    console.log(`info  cleaned up ${createdUserIds.length} dev test user(s)`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
