// Billing / page-credit foundation tests (no framework, no DB, no network).
//
//   node --experimental-strip-types scripts/billing-tests.mts
//
// Covers the pure page-credit rules in src/lib/billing/* and confirms the billing
// plan allowances match the public pricing display in src/lib/pricing.ts.

import {
  PLANS,
  PLAN_KEYS,
  getPlanAllowance,
  getStripePriceId,
  isPlanKey,
} from "../src/lib/billing/plans.ts";
import {
  getRemainingPages,
  canProcessPages,
  shouldChargeCredits,
  calculateChargeablePages,
  isPeriodExpired,
  nextPeriodEnd,
  resetForNewPeriod,
} from "../src/lib/billing/credits.ts";
import { pricingPlans } from "../src/lib/pricing.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok    ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Minimal account factory for the usage/period helpers.
function account(allowance: number, used: number, periodEnd = new Date("2026-02-01T00:00:00Z")) {
  return {
    monthlyPageAllowance: allowance,
    pagesUsedThisPeriod: used,
    currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
    currentPeriodEnd: periodEnd,
  };
}

// ----- plan allowances -----
check("free allowance is 0 (preview is separate)", getPlanAllowance("free") === 0);
check("minimum allowance is 100", getPlanAllowance("minimum") === 100);
check("plus allowance is 500", getPlanAllowance("plus") === 500);
check("pro allowance is 1000", getPlanAllowance("pro") === 1000);
check("pro_plus_2000 allowance is 2000", getPlanAllowance("pro_plus_2000") === 2000);
check("pro_plus_3000 allowance is 3000", getPlanAllowance("pro_plus_3000") === 3000);
check("all six plan keys exist", PLAN_KEYS.length === 6);
check("isPlanKey validates", isPlanKey("plus") && !isPlanKey("enterprise"));
check("paid plans expose a Stripe price env name", ["minimum", "plus", "pro", "pro_plus_2000", "pro_plus_3000"].every((k) => Boolean(PLANS[k as keyof typeof PLANS].stripePriceIdEnv)));
check("no real Stripe price id resolved yet (env unset)", getStripePriceId("plus", {} as NodeJS.ProcessEnv) === null);

// ----- remaining pages -----
check("remaining = allowance - used", getRemainingPages(account(500, 120)) === 380);
check("remaining never negative", getRemainingPages(account(100, 250)) === 0);
check("remaining full when unused", getRemainingPages(account(1000, 0)) === 1000);

// ----- can process -----
check("can process within allowance", canProcessPages(account(100, 0), 40) === true);
check("can process exactly to the limit", canProcessPages(account(100, 60), 40) === true);
check("cannot process beyond remaining (insufficient credits detected)", canProcessPages(account(100, 90), 40) === false);
check("zero/empty page request always allowed", canProcessPages(account(0, 0), 0) === true);

// ----- shouldChargeCredits -----
check("verified charges", shouldChargeCredits("verified", false) === true);
check("failed never charges", shouldChargeCredits("failed", true) === false);
check("review does not charge before export", shouldChargeCredits("review", false) === false);
check("review charges on export", shouldChargeCredits("review", true) === true);

// ----- calculateChargeablePages -----
check("verified conversion charges its page count", calculateChargeablePages("verified", 4, false) === 4);
check("failed conversion charges 0 pages", calculateChargeablePages("failed", 9, true) === 0);
check("review charges 0 before export", calculateChargeablePages("review", 6, false) === 0);
check("review charges page count on export", calculateChargeablePages("review", 6, true) === 6);
check("non-positive page counts clamp to 0", calculateChargeablePages("verified", 0, false) === 0);

// ----- Pro+ volume plans behave -----
check("Pro+ 2,000 plan: can process 1,500 pages fresh", canProcessPages(account(getPlanAllowance("pro_plus_2000"), 0), 1500));
check("Pro+ 3,000 plan: remaining after 2,500 used is 500", getRemainingPages(account(getPlanAllowance("pro_plus_3000"), 2500)) === 500);

// ----- period / monthly reset helpers -----
check("period expired when now >= end", isPeriodExpired(account(100, 0, new Date("2026-01-15T00:00:00Z")), new Date("2026-02-01T00:00:00Z")));
check("period not expired before end", !isPeriodExpired(account(100, 0, new Date("2026-02-15T00:00:00Z")), new Date("2026-02-01T00:00:00Z")));
check("nextPeriodEnd adds one month", nextPeriodEnd(new Date("2026-01-10T00:00:00Z")).toISOString().startsWith("2026-02-10"));
check("nextPeriodEnd clamps month rollover (Jan 31 -> Feb)", nextPeriodEnd(new Date("2026-01-31T00:00:00Z")).getUTCMonth() === 1);
{
  const reset = resetForNewPeriod("plus", new Date("2026-03-01T00:00:00Z"));
  check(
    "resetForNewPeriod zeroes usage + refreshes allowance + new window",
    reset.pagesUsedThisPeriod === 0 &&
      reset.monthlyPageAllowance === 500 &&
      reset.currentPeriodStart.toISOString().startsWith("2026-03-01") &&
      reset.currentPeriodEnd.toISOString().startsWith("2026-04-01"),
    JSON.stringify(reset),
  );
}

// ----- allowances match the public pricing display -----
{
  const byName = Object.fromEntries(pricingPlans.map((p) => [p.name, p]));
  const fmt = (n: number) => n.toLocaleString("en-US");
  check(
    "Minimum allowance + price match pricing display",
    byName["Minimum"]?.pages.includes(fmt(100)) && byName["Minimum"]?.price === `$${PLANS.minimum.monthlyPriceUsd}`,
  );
  check(
    "Plus allowance + price match pricing display",
    byName["Plus"]?.pages.includes(fmt(500)) && byName["Plus"]?.price === `$${PLANS.plus.monthlyPriceUsd}`,
  );
  check(
    "Pro allowance + price match pricing display",
    byName["Pro"]?.pages.includes(fmt(1000)) && byName["Pro"]?.price === `$${PLANS.pro.monthlyPriceUsd}`,
  );
  const proPlusTiers = byName["Pro+"]?.tiers ?? [];
  check(
    "Pro+ 2,000 tier matches plan ($60 / 2,000)",
    proPlusTiers.some((t) => t.pages.includes(fmt(2000)) && t.price === `$${PLANS.pro_plus_2000.monthlyPriceUsd}`),
  );
  check(
    "Pro+ 3,000 tier matches plan ($80 / 3,000)",
    proPlusTiers.some((t) => t.pages.includes(fmt(3000)) && t.price === `$${PLANS.pro_plus_3000.monthlyPriceUsd}`),
  );
}

console.log(
  failures === 0
    ? `\nAll billing/page-credit checks passed.`
    : `\n${failures} billing check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
