# StatementCSV — Production Launch Checklist

Operational checklist for deploying StatementCSV safely. **No real secret values
belong in this file** — it lists variable *names* and expected settings only. Set
actual values in the Vercel project settings (and never commit them).

---

## 1. Required environment variables

### App / domain
| Variable | Purpose | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Canonical app origin used for Stripe success/cancel + portal return URLs | Must equal the production domain (e.g. `https://statementcsv.com`). |

### Supabase (auth)
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (publishable, safe for browser). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key (browser-safe). |

> Never expose the Supabase service-role/secret key or the database URL to the client.

### Database (Prisma → Supabase Postgres)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled connection (PgBouncer, port 6543) used at runtime. |
| `DIRECT_URL` | Direct connection (port 5432) used by `prisma migrate`. |

### Stripe (live mode)
| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side Stripe secret (live). |
| `STRIPE_WEBHOOK_SECRET` | Live webhook signing secret for the production endpoint. |
| `STRIPE_PRICE_MINIMUM` | Price ID for the Minimum plan. |
| `STRIPE_PRICE_PLUS` | Price ID for the Plus plan. |
| `STRIPE_PRICE_PRO` | Price ID for the Pro plan. |
| `STRIPE_PRICE_PRO_PLUS_2000` | Price ID for Pro+ 2,000. |
| `STRIPE_PRICE_PRO_PLUS_3000` | Price ID for Pro+ 3,000. |

### AI (guided verification fallback)
| Variable | Purpose | Production value |
|---|---|---|
| `OPENAI_API_KEY` | API key for the AI provider. | set (secret) |
| `ENABLE_AI_ASSIST` | Master switch for AI fallback. | `true` |
| `ENABLE_AI_VISION_FALLBACK` | Allow rendered-image (vision) fallback. | `true` (anything other than `"false"` enables it) |
| `AI_ASSIST_MODEL` | Text/structuring model id. | set |
| `AI_VISION_MODEL` | Vision-capable model id (falls back to `AI_ASSIST_MODEL`). | set |

### Internal testers (optional)
| Variable | Purpose | Default |
|---|---|---|
| `INTERNAL_TESTER_EMAILS` | Comma-separated allowlist of internal tester emails (matched against the validated Supabase email, case-insensitive). Leave unset to disable. | unset (feature off) |
| `INTERNAL_TESTER_MONTHLY_PAGE_ALLOWANCE` | High monthly page allowance granted to tester accounts. | `100000` |

> Server-side only — never `NEXT_PUBLIC_`. Testers use the normal paid path (conversion
> records + idempotent charges + usage tracking) but never create Stripe subscriptions.
> Removing an email from the list immediately reverts that account to normal behavior.

### Internal diagnostics (optional)
| Variable | Purpose |
|---|---|
| `DIAGNOSTIC_REPORT_EMAIL` | Recipient inbox for internal-tester "Send diagnostic summary" emails. Required to send. |
| `DIAGNOSTIC_REPORT_FROM_EMAIL` | Optional sender address (must be allowed by the email provider). |
| `RESEND_API_KEY` | Transport secret for the email provider (Resend HTTP API). Required to send. |

> Diagnostic emails carry SAFE aggregate fields only (status/source/counts/balance
> labels/safe error code). No PDF, text, rows, descriptions, prompts, responses, ids,
> or token/cost metadata are ever sent. If unset, the route returns a safe "could not
> send" and testers can still use "Copy diagnostic summary".

### Free preview quota
| Variable | Purpose | Default |
|---|---|---|
| `FREE_PREVIEW_PAGE_LIMIT` | Pages per rolling window for no-account / free users. | `6` |
| `FREE_PREVIEW_WINDOW_HOURS` | Length of the rolling window. | `12` |
| `FREE_PREVIEW_MAX_ATTEMPTS` | Max parse attempts per window (abuse guard). | `5` |
| `FREE_PREVIEW_HASH_SECRET` | Optional pepper for hashing the preview subject before storage. | recommended (secret) |

> Public copy (pricing, FAQ, upload screen) states **6 pages every 12 hours**. If you
> change `FREE_PREVIEW_PAGE_LIMIT` / `FREE_PREVIEW_WINDOW_HOURS`, update the copy too.

---

## 2. Debug flags that MUST be false (or unset) in production

| Variable | Required | Effect if left on |
|---|---|---|
| `NEXT_PUBLIC_SHOW_DEBUG_DIAGNOSTICS` | `false` / unset | Shows the developer parser-diagnostics panel to users. |
| `SERVER_SAFE_PARSE_TRACE` | `false` / unset | Emits a one-line **safe-aggregate** server log per parse (no statement content). Safe, but keep off unless debugging. |
| `AI_ASSIST_DEBUG_PROVIDER_META` | `false` / unset | Populates provider/token metadata (response id, token counts) on the response. |
| `AI_VISION_DEBUG_SAVE_CROPS` | `false` / unset | Would write rendered crops to disk — **hard-gated to `NODE_ENV=development`**, so it is a no-op in production even if set, but keep it off. |

The diagnostics panel is also gated on `NODE_ENV` (only shows in non-production unless
`NEXT_PUBLIC_SHOW_DEBUG_DIAGNOSTICS=true`). Provider/token metadata is `null` unless
`AI_ASSIST_DEBUG_PROVIDER_META=true`.

---

## 3. Database / Prisma

- Apply migrations against the production DB: `npx prisma migrate deploy`
- `postinstall` / `build` run `prisma generate` automatically (so Vercel builds with
  a fresh client — required for the `FreePreviewUsage` model).
- Confirm the `FreePreviewUsage` table exists after deploy.

---

## 4. Stripe

- Production webhook endpoint URL = `<NEXT_PUBLIC_APP_URL>/api/stripe/webhook`.
- Webhook must use the **live** signing secret (`STRIPE_WEBHOOK_SECRET`).
- Subscribe the endpoint to at least: `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_succeeded`,
  `invoice.payment_failed`.
- Webhook signature is verified before any handling; invalid signatures are rejected.
- Logs record only the event **type** — never the payload.

---

## 5. DNS / canonical domain

- Point the canonical domain at Vercel; set `NEXT_PUBLIC_APP_URL` to that exact origin.
- Ensure sitemap/robots/canonical URLs (built from `siteConfig.url`) match the live domain.
- Stripe success/cancel/portal URLs derive from `NEXT_PUBLIC_APP_URL`.

---

## 6. Request limits (implemented)

- Max upload size: **10 MB** (`MAX_FILE_SIZE_MB`).
- Max pages per PDF: **100** (`MAX_PDF_PAGES`) — rejected cleanly before parser/AI.
- Only PDFs accepted (MIME `application/pdf` or `.pdf`).
- Encrypted/unreadable PDFs fail with a safe message (no stack trace).
- Quota/credit gate runs **before** the parser/AI; blocked uploads never invoke them.
- Route `maxDuration = 60s` (tune per hosting plan).

---

## 7. Privacy / data handling (verified in code)

- Uploaded PDF bytes + extracted text are held **in memory only** during the request.
- The only disk write in the app (debug vision crops) is hard-gated to development.
- No storage bucket; no temp files.
- DB stores **safe metadata only**: `User`, `BillingAccount`, `Conversion` (page
  count / status / balance status / credits / timestamps), `PageCreditLedger`,
  `FreePreviewUsage` (hashed subject + quota counters). No transaction rows,
  descriptions, balances, PDFs, images, or AI prompts/responses are stored.
- AI fallback may send **rendered statement images** to an external AI provider —
  reflected accurately in privacy/security copy (do NOT claim "AI never sees your
  document" or "nothing is uploaded").

---

## 8. Manual QA checklist (pre-launch)

- [ ] Incognito visitor: upload screen shows "6 free pages"; convert a small PDF; pill updates without reload.
- [ ] Convert a 6-page PDF as a signed-out visitor → "Preview used"; next upload is blocked **before** parsing.
- [ ] Upload a >100-page PDF → clean "over the 100-page limit" message, no parse.
- [ ] Upload a non-PDF → rejected with a clear message.
- [ ] Upload a scanned/image-only PDF → "scanned" message; consumes 0 credits/pages.
- [ ] Sign up, subscribe via Stripe Checkout (test in a staging Stripe mode first), confirm `/account` reflects the plan after the webhook.
- [ ] Paid user: verified conversion deducts credits; review export deducts on export; failed deducts 0.
- [ ] Confirm no diagnostics panel, provider ids, or traces are visible in production.
- [ ] Confirm production logs contain no statement content (descriptions, balances, rows, prompts, responses).
- [ ] Confirm privacy/security/pricing/FAQ copy matches implemented behavior.

---

## 9. Known launch-blockers still tracked in code

- Formal retention/deletion + production logging policy wording is still hedged
  ("designed to" / "being finalized"); finalize before public launch.
- Parser accuracy remains an MVP prototype — keep the "review highlighted rows
  before export" framing; do not add accuracy guarantees.
