// Stripe mapping tests (no framework, NO network, NO live Stripe calls, NO charges).
//
//   node --experimental-strip-types scripts/stripe-tests.mts
//
// Exercises only the pure mapping/config logic: plan key <-> price id, plan key ->
// allowance, Stripe status -> internal status, and renewal-reset detection. A fake
// env map stands in for the real Stripe price IDs.

import {
  PAID_PLAN_KEYS,
  isPaidPlanKey,
  priceIdForPlanKey,
  planKeyForPriceId,
  stripeStatusToInternalStatus,
} from "../src/lib/stripe/config.ts";
import { PLANS, getPlanAllowance } from "../src/lib/billing/plans.ts";
import { periodAdvanced } from "../src/lib/billing/credits.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok    ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Fake env (never the real live price IDs).
const ENV = {
  STRIPE_PRICE_MINIMUM: "price_min",
  STRIPE_PRICE_PLUS: "price_plus",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_PRO_PLUS_2000: "price_pp2k",
  STRIPE_PRICE_PRO_PLUS_3000: "price_pp3k",
} as unknown as NodeJS.ProcessEnv;

// ----- paid plan set + validation -----
check("paid plans are minimum/plus/pro/pro_plus_2000/pro_plus_3000", PAID_PLAN_KEYS.join(",") === "minimum,plus,pro,pro_plus_2000,pro_plus_3000");
check("isPaidPlanKey accepts a paid plan", isPaidPlanKey("plus"));
check("isPaidPlanKey rejects free", isPaidPlanKey("free") === false);
check("isPaidPlanKey rejects unknown", isPaidPlanKey("enterprise") === false);
check("isPaidPlanKey rejects non-string", isPaidPlanKey(123) === false && isPaidPlanKey(null) === false);

// ----- planKey -> Stripe env var name -----
check("minimum -> STRIPE_PRICE_MINIMUM", PLANS.minimum.stripePriceIdEnv === "STRIPE_PRICE_MINIMUM");
check("plus -> STRIPE_PRICE_PLUS", PLANS.plus.stripePriceIdEnv === "STRIPE_PRICE_PLUS");
check("pro -> STRIPE_PRICE_PRO", PLANS.pro.stripePriceIdEnv === "STRIPE_PRICE_PRO");
check("pro_plus_2000 -> STRIPE_PRICE_PRO_PLUS_2000", PLANS.pro_plus_2000.stripePriceIdEnv === "STRIPE_PRICE_PRO_PLUS_2000");
check("pro_plus_3000 -> STRIPE_PRICE_PRO_PLUS_3000", PLANS.pro_plus_3000.stripePriceIdEnv === "STRIPE_PRICE_PRO_PLUS_3000");

// ----- planKey -> price id (resolved from env) -----
check("priceIdForPlanKey resolves from env", priceIdForPlanKey("plus", ENV) === "price_plus");
check("priceIdForPlanKey is null when env unset", priceIdForPlanKey("plus", {} as NodeJS.ProcessEnv) === null);

// ----- price id -> planKey (webhook reverse map) -----
check("price_min -> minimum", planKeyForPriceId("price_min", ENV) === "minimum");
check("price_pro -> pro", planKeyForPriceId("price_pro", ENV) === "pro");
check("price_pp2k -> pro_plus_2000", planKeyForPriceId("price_pp2k", ENV) === "pro_plus_2000");
check("price_pp3k -> pro_plus_3000", planKeyForPriceId("price_pp3k", ENV) === "pro_plus_3000");
check("unknown price id -> null", planKeyForPriceId("price_unknown", ENV) === null);

// ----- planKey -> allowance -----
check("minimum allowance 100", getPlanAllowance("minimum") === 100);
check("plus allowance 500", getPlanAllowance("plus") === 500);
check("pro allowance 1000", getPlanAllowance("pro") === 1000);
check("pro_plus_2000 allowance 2000", getPlanAllowance("pro_plus_2000") === 2000);
check("pro_plus_3000 allowance 3000", getPlanAllowance("pro_plus_3000") === 3000);

// ----- Stripe status -> internal status -----
check("active -> active", stripeStatusToInternalStatus("active") === "active");
check("trialing -> active", stripeStatusToInternalStatus("trialing") === "active");
check("past_due -> past_due", stripeStatusToInternalStatus("past_due") === "past_due");
check("unpaid -> past_due", stripeStatusToInternalStatus("unpaid") === "past_due");
check("canceled -> canceled", stripeStatusToInternalStatus("canceled") === "canceled");
check("incomplete_expired -> canceled", stripeStatusToInternalStatus("incomplete_expired") === "canceled");
check("incomplete -> incomplete", stripeStatusToInternalStatus("incomplete") === "incomplete");
check("paused -> incomplete", stripeStatusToInternalStatus("paused") === "incomplete");
check("unknown status -> incomplete", stripeStatusToInternalStatus("something_new") === "incomplete");

// ----- renewal reset detection -----
const t = new Date("2026-02-01T00:00:00Z");
check("period advanced when new start is later", periodAdvanced(t, new Date("2026-03-01T00:00:00Z")));
check("period not advanced when equal (idempotent)", periodAdvanced(t, new Date("2026-02-01T00:00:00Z")) === false);
check("period not advanced when earlier", periodAdvanced(t, new Date("2026-01-01T00:00:00Z")) === false);

console.log(
  failures === 0 ? `\nAll Stripe mapping checks passed.` : `\n${failures} Stripe check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
