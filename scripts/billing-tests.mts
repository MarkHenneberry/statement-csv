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
  defaultFreeAccountFields,
  summarizeAccountUsage,
  evaluateUploadAccess,
  getPreviewLimits,
  evaluatePreviewAccess,
  previewWindowEnd,
  parseInternalTesterEmails,
  isInternalTesterEmail,
  internalTesterAllowance,
  isInternalTesterUser,
  effectiveMonthlyAllowance,
  effectiveRemainingPages,
  evaluateAccountAccess,
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

// ----- default free account (new signed-in user) -----
{
  const f = defaultFreeAccountFields(new Date("2026-01-10T00:00:00Z"));
  check(
    "default account is the free plan with 0 allowance + 0 used",
    f.planKey === "free" && f.status === "free" && f.monthlyPageAllowance === 0 && f.pagesUsedThisPeriod === 0,
    JSON.stringify(f),
  );
  check(
    "default account opens a one-month period",
    f.currentPeriodStart.toISOString().startsWith("2026-01-10") &&
      f.currentPeriodEnd.toISOString().startsWith("2026-02-10"),
  );
}

// ----- evaluateUploadAccess (pre-parser gate) -----
{
  // Free / 0-allowance accounts can never process a real upload.
  const free = evaluateUploadAccess({ monthlyPageAllowance: 0, pagesUsedThisPeriod: 0 }, 6);
  check(
    "free/0-allowance is blocked with PLAN_REQUIRED",
    free.allowed === false && free.code === "PLAN_REQUIRED" && free.required === 6,
    JSON.stringify(free),
  );

  // Paid with enough remaining is allowed and reports remaining/required.
  const enough = evaluateUploadAccess({ monthlyPageAllowance: 100, pagesUsedThisPeriod: 0 }, 6);
  check(
    "paid with enough credits is allowed (remaining 100, required 6)",
    enough.allowed === true && enough.remaining === 100 && enough.required === 6,
    JSON.stringify(enough),
  );

  // Allowed exactly at the boundary (remaining == required).
  const exact = evaluateUploadAccess({ monthlyPageAllowance: 100, pagesUsedThisPeriod: 94 }, 6);
  check("paid allowed when remaining equals required", exact.allowed === true);

  // Paid but not enough remaining is blocked with INSUFFICIENT_PAGE_CREDITS.
  const short = evaluateUploadAccess({ monthlyPageAllowance: 100, pagesUsedThisPeriod: 97 }, 6);
  check(
    "paid but short is blocked with INSUFFICIENT_PAGE_CREDITS (remaining 3, required 6)",
    short.allowed === false && short.code === "INSUFFICIENT_PAGE_CREDITS" && short.remaining === 3 && short.required === 6,
    JSON.stringify(short),
  );
}

// ----- free-preview quota (no-account / signed-in-free path) -----
{
  // Env defaults: 6 pages / 12 hours / 5 attempts.
  const def = getPreviewLimits({} as NodeJS.ProcessEnv);
  check(
    "preview limits default to 6 pages / 12h / 5 attempts",
    def.pageLimit === 6 && def.windowHours === 12 && def.maxAttempts === 5,
    JSON.stringify(def),
  );
  const custom = getPreviewLimits({
    FREE_PREVIEW_PAGE_LIMIT: "10",
    FREE_PREVIEW_WINDOW_HOURS: "24",
    FREE_PREVIEW_MAX_ATTEMPTS: "3",
  } as unknown as NodeJS.ProcessEnv);
  check(
    "preview limits read env overrides",
    custom.pageLimit === 10 && custom.windowHours === 24 && custom.maxAttempts === 3,
  );
  check(
    "preview limits ignore non-positive/garbage env (fallback to defaults)",
    getPreviewLimits({ FREE_PREVIEW_PAGE_LIMIT: "0", FREE_PREVIEW_WINDOW_HOURS: "abc" } as unknown as NodeJS.ProcessEnv).pageLimit === 6,
  );

  const limits = { pageLimit: 6, windowHours: 12, maxAttempts: 5 };

  // Fresh subject under the limit is allowed.
  const fresh = evaluatePreviewAccess(limits, { pagesUsed: 0, attemptsUsed: 0 }, 3);
  check(
    "signed-out under 6 pages is allowed",
    fresh.allowed === true && fresh.remaining === 6 && fresh.required === 3,
    JSON.stringify(fresh),
  );

  // Allowed exactly at the boundary (a 6-page PDF on a fresh window).
  check(
    "preview allowed when required equals remaining (6 pages fresh)",
    evaluatePreviewAccess(limits, { pagesUsed: 0, attemptsUsed: 0 }, 6).allowed === true,
  );

  // Over the page limit on a fresh window is blocked before parser/AI.
  const over = evaluatePreviewAccess(limits, { pagesUsed: 0, attemptsUsed: 0 }, 7);
  check(
    "signed-out over 6 pages is blocked (PREVIEW_PAGE_LIMIT)",
    over.allowed === false && over.code === "PREVIEW_PAGE_LIMIT" && over.required === 7,
    JSON.stringify(over),
  );

  // Remaining 2 pages cannot process a 3-page PDF.
  const short = evaluatePreviewAccess(limits, { pagesUsed: 4, attemptsUsed: 1 }, 3);
  check(
    "remaining 2 preview pages cannot upload a 3-page PDF",
    short.allowed === false && short.code === "PREVIEW_PAGE_LIMIT" && short.remaining === 2 && short.required === 3,
    JSON.stringify(short),
  );

  // Attempt cap blocks even when pages remain.
  const attempts = evaluatePreviewAccess(limits, { pagesUsed: 1, attemptsUsed: 5 }, 1);
  check(
    "preview blocked when attempts are exhausted (PREVIEW_ATTEMPT_LIMIT)",
    attempts.allowed === false && attempts.code === "PREVIEW_ATTEMPT_LIMIT",
    JSON.stringify(attempts),
  );

  // Window end math.
  check(
    "previewWindowEnd adds the window hours",
    previewWindowEnd(new Date("2026-06-29T00:00:00Z"), 12).toISOString().startsWith("2026-06-29T12:00:00"),
  );
}

// ----- internal tester mode (env-driven, server-side) -----
{
  // Parse + normalize the allowlist (comma / space / semicolon separated).
  const list = parseInternalTesterEmails(" Mark@Example.com, andrew@HOTMAIL.com ;b@c.io ");
  check(
    "allowlist is trimmed + lowercased + split on separators",
    list.length === 3 && list[0] === "mark@example.com" && list[1] === "andrew@hotmail.com" && list[2] === "b@c.io",
    JSON.stringify(list),
  );
  check("empty/undefined allowlist parses to []", parseInternalTesterEmails(undefined).length === 0 && parseInternalTesterEmails("").length === 0);

  const raw = "markhenneberry@outlook.com,andrewsmail7@hotmail.com";
  // Case-insensitive + trimmed matching.
  check("tester email matches case-insensitively + trimmed", isInternalTesterEmail("  MarkHenneberry@Outlook.com ", raw) === true);
  check("second tester email matches", isInternalTesterEmail("andrewsmail7@hotmail.com", raw) === true);
  check("non-allowlisted email is not a tester", isInternalTesterEmail("attacker@evil.com", raw) === false);
  check("null / empty email is not a tester", isInternalTesterEmail(null, raw) === false && isInternalTesterEmail("", raw) === false);
  check("no allowlist configured → nobody is a tester", isInternalTesterEmail("markhenneberry@outlook.com", undefined) === false);

  // Env-reading convenience (does not touch real process.env — env passed in).
  check(
    "isInternalTesterUser reads INTERNAL_TESTER_EMAILS from env",
    isInternalTesterUser("markhenneberry@outlook.com", { INTERNAL_TESTER_EMAILS: raw } as unknown as NodeJS.ProcessEnv) === true &&
      isInternalTesterUser("nope@x.com", { INTERNAL_TESTER_EMAILS: raw } as unknown as NodeJS.ProcessEnv) === false,
  );

  // Allowance: default 100000, env override, garbage falls back.
  check("tester allowance defaults to 100000", internalTesterAllowance(undefined) === 100000);
  check("tester allowance reads env override", internalTesterAllowance("250000") === 250000);
  check("tester allowance ignores garbage/non-positive", internalTesterAllowance("abc") === 100000 && internalTesterAllowance("0") === 100000);

  // Effective allowance: tester gets max(testerAllowance, plan allowance); others unchanged.
  const freeAcct = { monthlyPageAllowance: 0, pagesUsedThisPeriod: 0 };
  check(
    "tester effective allowance is the high tester value over a 0 plan",
    effectiveMonthlyAllowance(freeAcct, { internalTester: true, testerAllowance: 100000 }) === 100000,
  );
  check(
    "non-tester effective allowance is unchanged (0 stays 0)",
    effectiveMonthlyAllowance(freeAcct, { internalTester: false, testerAllowance: 100000 }) === 0,
  );
  check(
    "tester effective remaining subtracts used from the high allowance",
    effectiveRemainingPages({ monthlyPageAllowance: 0, pagesUsedThisPeriod: 40 }, { internalTester: true, testerAllowance: 100000 }) === 99960,
  );

  // evaluateAccountAccess: tester allowed without a Stripe plan; normal free blocked.
  const testerAccess = evaluateAccountAccess(freeAcct, 6, { internalTester: true, testerAllowance: 100000 });
  check("internal tester is allowed without a Stripe subscription", testerAccess.allowed === true && testerAccess.remaining === 100000);
  const normalFree = evaluateAccountAccess(freeAcct, 6, { internalTester: false, testerAllowance: 100000 });
  check("normal free user (allowance 0) is still PLAN_REQUIRED", normalFree.allowed === false && normalFree.code === "PLAN_REQUIRED");
  // Normal paid behavior is unchanged by tester mode being off.
  const paidShort = evaluateAccountAccess({ monthlyPageAllowance: 100, pagesUsedThisPeriod: 97 }, 6, { internalTester: false, testerAllowance: 100000 });
  check("normal paid-but-short still blocks with INSUFFICIENT_PAGE_CREDITS", paidShort.allowed === false && paidShort.code === "INSUFFICIENT_PAGE_CREDITS");
}

// ----- account usage summary (free + paid shapes) -----
{
  const free = summarizeAccountUsage({ monthlyPageAllowance: 0, pagesUsedThisPeriod: 0 });
  check("free shape: allowance 0 / used 0 / remaining 0", free.monthlyPageAllowance === 0 && free.remaining === 0);
  const paid = summarizeAccountUsage({ monthlyPageAllowance: 500, pagesUsedThisPeriod: 120 });
  check("paid shape: 500 allowance, 120 used -> 380 remaining", paid.remaining === 380 && paid.pagesUsedThisPeriod === 120);
  const over = summarizeAccountUsage({ monthlyPageAllowance: 100, pagesUsedThisPeriod: 250 });
  check("over-used shape clamps remaining to 0", over.remaining === 0);
}

console.log(
  failures === 0
    ? `\nAll billing/page-credit checks passed.`
    : `\n${failures} billing check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
