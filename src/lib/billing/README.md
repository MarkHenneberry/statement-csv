# Billing / page-credit foundation (MVP)

This module is the **data + logic foundation** for monthly page-credit plans. It is
intentionally **not enforced** yet: nothing here blocks uploads/exports, charges a
card, or talks to Stripe. The next pass adds persistence (Prisma) + Stripe.

## What counts as a page credit

- A **page** = one page of an uploaded statement **PDF**. Credits are based on the
  number of PDF **pages processed**, not the number of statements.
- Example: a 4-page statement uses **4** page credits when it is charged.

## When credits will be deducted (rules, not yet enforced)

Implemented as pure functions in [`credits.ts`](./credits.ts):

| Conversion outcome        | Charges credits?                  | Helper |
| ------------------------- | --------------------------------- | ------ |
| Verified                  | Yes — full page count             | `shouldChargeCredits`, `calculateChargeablePages` |
| Review highlighted rows   | Only if the user **exports**      | same |
| Could not extract (failed)| No                                | same |

- Allowance **resets monthly** (`resetForNewPeriod` / `nextPeriodEnd`).
- A user cannot process/export beyond their allowance once enforcement lands
  (`canProcessPages` / `getRemainingPages`).

## Plans

Allowances + plan keys: [`plans.ts`](./plans.ts) (`free`, `minimum`, `plus`, `pro`,
`pro_plus_2000`, `pro_plus_3000`). These **allowance numbers are the source of truth**
and must match the public display copy in `src/lib/pricing.ts` (cross-checked in
`scripts/billing-tests.mts`). Real Stripe price IDs are read from env vars **by name**
(`stripePriceIdEnv`) in the next pass — no real IDs are hardcoded.

## Data intentionally NOT stored

Only safe operational metadata is modeled (`types.ts` / `prisma/schema.prisma`):
page counts, statuses, balance status, credits charged, timestamps, and Stripe IDs
(later). We **never** store:

- raw PDF files
- raw extracted PDF text
- transaction rows / descriptions / amounts
- rendered statement images
- AI prompts or AI responses

`Conversion.originalFilename` is optional and should be treated as sensitive — it is
never required by billing.

## Where the next (Stripe) pass plugs in

- **Persistence:** install Prisma, set `DATABASE_URL`, migrate from
  `prisma/schema.prisma`, then back `types.ts` consumers with the generated client.
- **Stripe webhooks** (`checkout.session.completed`, `customer.subscription.*`,
  `invoice.paid`) should update `BillingAccount` (`planKey`, `status`,
  `stripeCustomerId`, `stripeSubscriptionId`, period bounds) and call
  `resetForNewPeriod` on renewal, writing a `monthly_reset` ledger entry.
- **Upload enforcement:** in `src/app/api/parse-statement/route.ts`, gate processing
  with `canProcessPages(account, pageCount)` once accounts exist.
- **Export enforcement / charging:** when a verified conversion completes (or a
  review conversion is exported), write a `Conversion` row, deduct
  `calculateChargeablePages(...)` via a `PageCreditLedger` entry, and bump
  `pagesUsedThisPeriod`.
