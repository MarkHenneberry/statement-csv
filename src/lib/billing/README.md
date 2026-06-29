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

## Database (Supabase Postgres) — wired in this pass

The chosen database is **Supabase Postgres**, accessed via **Prisma** (`postgresql`
provider). Prisma is installed and the client generates from `prisma/schema.prisma`.
Nothing connects at build time — no route imports the client — so `npm run build`
works without a live database. The shared client lives in `src/lib/db.ts`; thin
server-only data helpers live in `src/lib/billing/repo.ts` (not called by any route
yet).

### Required env vars (do not commit real values)

Copy `.env.example` to `.env` and fill in from Supabase
(Project Settings → Database → Connection string):

- `DATABASE_URL` — pooled connection (PgBouncer, port 6543, `?pgbouncer=true`); used
  at runtime.
- `DIRECT_URL` — direct connection (port 5432); used by `prisma migrate`. If you only
  have one connection string, set `DIRECT_URL` to the same value as `DATABASE_URL`.

### Commands

```bash
npm run prisma:generate        # generate the client (no DB connection needed)
npm run prisma:migrate:dev     # create/apply a migration (needs DATABASE_URL + DIRECT_URL)
npm run prisma:studio          # browse data (needs DB)
npm run prisma:deploy          # apply migrations in CI/production
npm run db:sanity              # connect + safe read-only counts (skips if no DATABASE_URL)
DB_SANITY_WRITE=true npm run db:sanity   # also upsert one safe dev placeholder row
```

The first migration name is `init_billing_foundation`. The DB sanity script prints
only safe counts/labels and never logs connection strings or secrets.

## Deferred to the next pass

- **Supabase Auth** is intentionally deferred. This pass only uses Supabase as the
  Postgres database; no auth packages or login flow are added. The next auth pass
  connects authenticated users to `User` / `BillingAccount` (e.g. on first sign-in,
  call `createDefaultBillingAccount`).

## Where the next (Stripe) pass plugs in

- **Persistence:** Prisma is wired. Run `prisma:migrate:dev` once `DATABASE_URL` is
  set, then back `types.ts` consumers with the generated client where helpful.
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
