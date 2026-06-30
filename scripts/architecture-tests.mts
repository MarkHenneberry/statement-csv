// Architecture invariant tests (no test framework).
//
//   node --experimental-strip-types scripts/architecture-tests.mts
//
// These assert ARCHITECTURE behavior — the PDF → ParsedStatement → validation →
// export model — rather than specific bank statements. They use synthetic, FAKE
// text/items only and store nothing.

import {
  parseStatementText,
  detectStatementPeriod,
  inferRowYear,
} from "../src/lib/parser.ts";
import { parseStatement, PARSER_PIPELINE_STAGES } from "../src/lib/statement-pipeline.ts";
import {
  buildParsedStatement,
  parsedStatementToRows,
} from "../src/lib/statement-model.ts";
import { detectStatementProfile, STATEMENT_PROFILES } from "../src/lib/statement-profiles.ts";
import { rowsToCsv } from "../src/lib/upload.ts";
import { groupVisualLines, probeCoordinateHeaders } from "../src/lib/coordinate-table.ts";
import { buildItems, coordinateSamples } from "../src/lib/coordinate-table-samples.ts";
import { shouldShowDiagnostics } from "../src/lib/parser-diagnostics.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok    ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BANK_TEXT = [
  "Some Bank Chequing",
  "Statement period January 1 to January 31, 2026",
  "Details of your account activity",
  "Date Description Withdrawals Deposits Balance",
  "Opening Balance 2,000.00",
  "Jan 3 Payroll Deposit 1,500.00 3,500.00",
  "Jan 5 Hydro One 120.00 3,380.00",
  "Closing Balance 3,380.00",
  "Total deposits 1,500.00",
  "Total withdrawals 120.00",
].join("\n");

const SUMMARY_HEAVY_CC = [
  "RBC ROYAL BANK VISA",
  "STATEMENT FROM APR 24 TO MAY 25, 2026",
  "PAYMENT DUE DATE MAY 21, 2026",
  "MINIMUM PAYMENT $10.00",
  "Credit Limit $10,000.00",
  "Available Credit $9,500.00",
  "Previous Account Balance $500.00",
  "APR 25 APR 26 BOOK STORE TORONTO ON",
  "74000000000000000000010",
  "$120.00",
  "APR 29 APR 29 PAYMENT - THANK YOU / PAIEMENT - MERCI",
  "74000000000000000000011",
  "-$50.00",
  "New Balance $570.00",
  "TOTAL ACCOUNT BALANCE $570.00",
  "TIME TO PAY",
].join("\n");

// 1. The model carries a validation status + numeric confidence + issues array.
{
  const result = parseStatementText(BANK_TEXT);
  const statement = buildParsedStatement(result, { fileName: "x.pdf" });
  check(
    "validation present (status + confidence + issues)",
    ["passed", "needs-review", "limited"].includes(statement.validation.status) &&
      typeof statement.validation.confidence === "number" &&
      statement.validation.confidence >= 0 &&
      statement.validation.confidence <= 1 &&
      Array.isArray(statement.validation.issues),
    JSON.stringify(statement.validation),
  );
  check(
    "bank statement reconciles to passed with high confidence",
    statement.validation.status === "passed" && statement.validation.confidence >= 0.8,
    `status=${statement.validation.status} conf=${statement.validation.confidence}`,
  );
}

// 2. Transactions carry normalized amount + debit/credit + confidence + issues.
{
  const { statement } = parseStatement({ text: BANK_TEXT });
  const t = statement.transactions[0];
  const consistent = statement.transactions.every((tx) => {
    const hasDebit = tx.debit !== undefined;
    const hasCredit = tx.credit !== undefined;
    const amountOk =
      (hasDebit && tx.amount <= 0) || (hasCredit && tx.amount >= 0) || (!hasDebit && !hasCredit);
    return typeof tx.amount === "number" && typeof tx.confidence === "number" && Array.isArray(tx.issues) && amountOk;
  });
  check("transactions have normalized amount/debit/credit + confidence + issues", Boolean(t) && consistent);
}

// 3. Export uses ParsedStatement.transactions (model → rows), not raw text.
{
  const { statement, rows } = parseStatement({ text: BANK_TEXT });
  const fromModel = parsedStatementToRows(statement);
  const csv = rowsToCsv(rows);
  check("export rows are derived from model transactions", fromModel.length === statement.transactions.length && rows.length === statement.transactions.length);
  check(
    "CSV contains only normalized core fields, never raw statement lines",
    csv.startsWith("Date,Description,Debit,Credit,Amount,Balance") &&
      !/^[^\n]*Category/.test(csv) && // Category excluded from the default export
      !/^[^\n]*Confidence/i.test(csv) &&
      !csv.includes("Details of your account activity") &&
      !csv.includes("Opening Balance 2,000.00"),
  );
}

// 4. Summary rows validate totals but never become transactions.
{
  const { statement } = parseStatement({ text: SUMMARY_HEAVY_CC });
  const descs = statement.transactions.map((t) => t.description.toLowerCase());
  const leaked = descs.some(
    (d) => d.includes("credit limit") || d.includes("available credit") || d.includes("minimum payment"),
  );
  check("summary rows did not become transactions", !leaked && statement.transactions.length === 2);
  check(
    "summary totals captured for validation",
    statement.summaryTotals !== undefined || statement.validation.status !== "limited",
  );
}

// 5. rawText / internal raw lines never appear on the model or the export rows.
{
  const { statement, rows, result } = parseStatement({ text: BANK_TEXT });
  const serialized = JSON.stringify({ statement, rows });
  const hasRawTextField =
    "rawText" in (statement as Record<string, unknown>) ||
    "rawText" in (result as Record<string, unknown>);
  check(
    "no rawText field on model/result and no raw header line leaked",
    !hasRawTextField && !serialized.includes("Details of your account activity"),
  );
}

// 6. Statement period is used for date normalization (MMM DD → ISO).
{
  const result = parseStatementText(BANK_TEXT);
  const dated = result.rows.find((r) => r.date);
  check(
    "dates normalized to ISO using the statement period year",
    Boolean(dated) && /^2026-\d{2}-\d{2}$/.test(dated!.date),
    dated?.date,
  );
}

// 7. Coordinate parser can be absent and the text fallback still works.
{
  const noItems = parseStatement({ text: BANK_TEXT }); // no items
  check(
    "text fallback works with no coordinate items",
    noItems.statement.transactions.length === 2 &&
      noItems.result.parseStats?.coordinateExtractionAvailable === false,
  );
  // And when items ARE present, the coordinate source can be chosen.
  const sample = coordinateSamples.find((s) => s.name === "A-standard-bank-table")!;
  const items = buildItems(sample.rows);
  const text = groupVisualLines(items).map((l) => l.text).join("\n");
  const withItems = parseStatement({ text, items });
  check(
    "coordinate source is chosen when a clean table is present",
    withItems.result.parseStats?.chosenCandidateSource === "coordinate-table",
    withItems.result.parseStats?.chosenCandidateSource,
  );
}

// 8. Profile detection chooses a generic fallback safely.
{
  const cc = detectStatementProfile(SUMMARY_HEAVY_CC);
  const bank = detectStatementProfile(BANK_TEXT);
  const gibberish = detectStatementProfile("hello world, nothing to see here");
  check("credit-card profile detected", cc.statementKind === "credit-card");
  check("bank-account profile detected", bank.statementKind === "bank-account");
  check(
    "unknown text falls back safely (no throw, generic/unknown profile)",
    typeof gibberish.name === "string" && gibberish.confidence <= 0.3,
    gibberish.name,
  );
  check("profile names are generic layout families, not banks", STATEMENT_PROFILES.every((p) => !/^rbc$|^bmo$|^td$|^cibc$/i.test(p.name)));
}

// 9b. Coordinate header probe: sane aggregates + carries NO document text.
{
  const sample = coordinateSamples.find((s) => s.name === "A-standard-bank-table")!;
  const items = buildItems(sample.rows);
  const probe = probeCoordinateHeaders(items);
  check(
    "header probe reports sane aggregates for a clean table",
    probe.coordinateItemsPresent &&
      probe.visualLineCount > 0 &&
      probe.maxItemsPerLine > 0 &&
      probe.bestDistinctMeaningsOnALine >= 2 &&
      probe.tableRegionsFound === 1,
    JSON.stringify(probe),
  );
  const empty = probeCoordinateHeaders([]);
  check(
    "header probe is empty/safe when no coordinate items",
    !empty.coordinateItemsPresent && empty.visualLineCount === 0 && empty.tableRegionsFound === 0,
  );
  // Privacy: the probe is counts/booleans only — no document text (not even the
  // header words like "Description"/"Balance", nor any merchant/amount strings).
  const serialized = JSON.stringify(probe);
  const leakTokens = ["Payroll", "Grocery", "Coffee", "Opening", "Closing", "Description", "Balance", "Deposit", "2,200.00", "4,110.05"];
  check(
    "header probe serialization contains no document text",
    leakTokens.every((tok) => !serialized.includes(tok)),
    serialized,
  );
}

// 9. The pipeline stages are represented in code, in order.
{
  check(
    "pipeline stages enumerated A..J",
    PARSER_PIPELINE_STAGES.length === 10 &&
      PARSER_PIPELINE_STAGES[0].startsWith("A.") &&
      PARSER_PIPELINE_STAGES[PARSER_PIPELINE_STAGES.length - 1].startsWith("J."),
  );
}

// ----- Generalized credit-card structure tests (synthetic, FAKE data) -----
// These cover the class of bug a real CIBC statement exposed: payment-due /
// remittance figures, spend-report/reward/certificate values, and cross-year
// statement periods. They are issuer-agnostic and store nothing.

// A synthetic credit-card statement whose payment slip prints the minimum-payment
// amount on its OWN line, with the "Minimum Payment" / "Please pay this amount by"
// labels on neighboring lines — the exact structure a single-line check misses.
// The period crosses a year boundary (Dec 2025 → Jan 2026).
const CARD_WITH_REMITTANCE = [
  "SYNTHETIC CARD STATEMENT",
  "Statement period December 10, 2025 to January 9, 2026",
  "Previous Account Balance $1,000.00",
  "New Balance $850.00",
  "Your payments",
  "Dec 20 ONLINE PAYMENT - THANK YOU $300.00",
  "Your new charges and credits",
  "Dec 22 BOOK STORE TORONTO ON $120.00",
  "Jan 03 COFFEE SHOP DOWNTOWN $30.00",
  "Minimum Payment $25.00",
  "Please pay this amount by",
  "Jan 05 $25.00",
].join("\n");

// 10. Payment-due / remittance amount must NOT become a transaction (general).
{
  const { statement } = parseStatement({ text: CARD_WITH_REMITTANCE });
  const amounts = statement.transactions.map((t) => Math.abs(t.amount));
  check(
    "payment-due/remittance amount is not a transaction row",
    statement.transactions.length === 3 && !amounts.some((a) => Math.abs(a - 25) < 0.001),
    `rows=${statement.transactions.length} amounts=${amounts.join(",")}`,
  );
  check(
    "no transaction row lacks merchant text (remittance/empty-desc leak)",
    statement.transactions.every((t) => /[A-Za-z]{3,}/.test(t.description)),
  );
  check(
    "credit-card reconciles to passed once remittance is rejected, AI not needed",
    statement.validation.status === "passed",
    `status=${statement.validation.status} diff=${statement.validation.difference}`,
  );
}

// 11. Cross-year statement period assigns row years by month (general).
{
  const period = detectStatementPeriod("Statement period December 10, 2025 to January 9, 2026");
  check(
    "cross-year period detected with both years and crossesYear",
    period !== null &&
      period.crossesYear &&
      period.startMonth === 12 &&
      period.endMonth === 1 &&
      period.startYear === 2025 &&
      period.endYear === 2026,
    JSON.stringify(period),
  );
  check(
    "inferRowYear: December → earlier year, January → later year",
    inferRowYear(period, 12, 2026) === 2025 && inferRowYear(period, 1, 2026) === 2026,
  );
  // Same-year period keeps the single year; no period falls back.
  const sameYear = detectStatementPeriod("STATEMENT FROM APR 24 TO MAY 25, 2026");
  check(
    "same-year period does not cross and keeps its year",
    sameYear !== null && !sameYear.crossesYear && inferRowYear(sameYear, 4, 2026) === 2026,
    JSON.stringify(sameYear),
  );
  check("no period falls back to the provided year", inferRowYear(null, 12, 2026) === 2026);

  // End-to-end: December rows render as 2025-xx, January rows as 2026-xx.
  const result = parseStatementText(CARD_WITH_REMITTANCE);
  const decRow = result.rows.find((r) => /BOOK STORE/i.test(r.description));
  const janRow = result.rows.find((r) => /COFFEE SHOP/i.test(r.description));
  check(
    "December transaction renders with the earlier year (2025-12)",
    Boolean(decRow) && decRow!.date.startsWith("2025-12"),
    decRow?.date,
  );
  check(
    "January transaction renders with the later year (2026-01)",
    Boolean(janRow) && janRow!.date.startsWith("2026-01"),
    janRow?.date,
  );
}

// 12. Spend reports / rewards / cashback or gift certificates are not rows.
{
  const CARD_WITH_REWARDS = [
    "SYNTHETIC CARD STATEMENT",
    "Statement period January 1 to January 31, 2026",
    "Previous Account Balance $500.00",
    "New Balance $560.00",
    "Your new charges and credits",
    "Jan 05 BOOK STORE TORONTO ON $60.00",
    "Spend Report Groceries $200.00",
    "Cashback Certificate $50.00",
    "Gift Certificate $25.00",
  ].join("\n");
  const { statement } = parseStatement({ text: CARD_WITH_REWARDS });
  const amounts = statement.transactions.map((t) => Math.abs(t.amount));
  check(
    "spend-report / rewards / certificate values do not become transactions",
    statement.transactions.length === 1 &&
      !amounts.some((a) => [200, 50, 25].some((x) => Math.abs(a - x) < 0.001)),
    `rows=${statement.transactions.length} amounts=${amounts.join(",")}`,
  );
}

// 13. Quota gating must be server-trust only: the parse route derives the page
// count from the extracted PDF and the subject from auth/cookie — never from query
// params or request-body flags (?free=true, ?dev=true, body.pageCount, etc.).
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../src/app/api/parse-statement/route.ts", import.meta.url),
    "utf8",
  );
  check(
    "parse route derives page count from the extracted PDF (server-side)",
    /const\s+pdfPageCount\s*=\s*extracted\.pageCount\s*\?\?\s*extracted\.pages\.length/.test(src),
  );
  check(
    "parse route does not read URL query params (no ?free/?dev bypass)",
    !/searchParams/.test(src) && !/nextUrl/.test(src) && !/new URL\(\s*request\.url/.test(src),
  );
  check(
    "parse route does not trust a client-supplied page count or plan/preview flag",
    !/form\.get\(\s*["'](pageCount|pages|free|paid|preview|plan|dev)["']\s*\)/.test(src) &&
      !/body\.(pageCount|isPaid|preview|free|plan)\b/.test(src),
  );
  check(
    "parse route reads auth server-side via getAuthenticatedUser (not a client id)",
    /getAuthenticatedUser\(\)/.test(src),
  );
}

// 14. Production debug output is disabled/gated.
{
  // The diagnostics panel is hidden in production unless the explicit opt-in flag is set.
  check(
    "diagnostics panel hidden in production by default",
    shouldShowDiagnostics({ nodeEnv: "production" }) === false &&
      shouldShowDiagnostics({ nodeEnv: "production", showFlag: "false" }) === false,
  );
  check(
    "diagnostics panel shows in dev and behind explicit prod opt-in",
    shouldShowDiagnostics({ nodeEnv: "development" }) === true &&
      shouldShowDiagnostics({ nodeEnv: "production", showFlag: "true" }) === true,
  );

  const fs = await import("node:fs");
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

  // Disk write of rendered statement crops is hard-gated to development.
  const routeSrc = read("../src/app/api/parse-statement/route.ts");
  check(
    "debug vision-crop disk write is gated to development (no prod disk writes)",
    /if\s*\(\s*!IS_DEV\s*\|\|\s*images\.length === 0\s*\)\s*return;/.test(routeSrc),
  );
  // A page-count ceiling is enforced before the parser/AI run.
  check(
    "parse route enforces MAX_PDF_PAGES before parser/AI",
    /pdfPageCount\s*>\s*MAX_PDF_PAGES/.test(routeSrc),
  );

  // AI provider/token metadata is only populated behind the debug flag.
  const aiSrc = read("../src/lib/ai-assist.ts");
  check(
    "AI provider metadata is gated by AI_ASSIST_DEBUG_PROVIDER_META",
    /AI_ASSIST_DEBUG_PROVIDER_META === "true"/.test(aiSrc) &&
      /if\s*\(\s*config\.debugProviderMeta/.test(aiSrc),
  );
}

// 16. Internal-tester mode is server-side + env-driven only (no client activation).
{
  const fs = await import("node:fs");
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

  const routeSrc = read("../src/app/api/parse-statement/route.ts");
  // Tester status is derived from the VALIDATED Supabase email, not client input.
  check(
    "parse route derives internal-tester from the authenticated email",
    /isInternalTesterUser\(authUser\.email\)/.test(routeSrc),
  );
  // The allowlist env var is read only server-side (never NEXT_PUBLIC_, never inlined to the client).
  const creditsSrc = read("../src/lib/billing/credits.ts");
  check(
    "tester allowlist is read from a non-public server env var",
    /env\.INTERNAL_TESTER_EMAILS/.test(creditsSrc) && !/NEXT_PUBLIC_INTERNAL_TESTER/.test(creditsSrc),
  );
  // No client component may reference the tester env vars (would leak / be inert anyway).
  const clientFiles = [
    "../src/components/Header.tsx",
    "../src/components/HeaderCreditPill.tsx",
    "../src/components/upload/UploadFlow.tsx",
  ];
  let leak = "";
  for (const rel of clientFiles) {
    if (/INTERNAL_TESTER/.test(read(rel))) leak += `${rel} `;
  }
  check("no client component references INTERNAL_TESTER env vars", leak === "", leak);
}

// 15. Public copy contains no unsupported/inaccurate claims.
{
  const fs = await import("node:fs");
  const copyFiles = [
    "../src/app/page.tsx",
    "../src/app/privacy/page.tsx",
    "../src/app/security/page.tsx",
    "../src/app/pricing/page.tsx",
    "../src/lib/pricing.ts",
    "../src/lib/faq.ts",
    "../src/components/upload/UploadFlow.tsx",
    "../src/components/content/DataRetentionTrustBlock.tsx",
    "../src/components/content/PrivacyMiniBlock.tsx",
  ];
  // Affirmative overclaims that must never appear (chosen so honest disclaimers,
  // e.g. "not a guarantee of perfect accuracy", do not false-positive).
  const banned = [
    "guaranteed accuracy",
    "99.9",
    "bank-approved",
    "pipeda",
    "data residency",
    "local-only processing",
    "nothing is uploaded or stored",
    "everything happens in your browser",
    "works with every bank",
    "ai never sees your document",
  ];
  let copyOffenders = "";
  for (const rel of copyFiles) {
    const text = fs.readFileSync(new URL(rel, import.meta.url), "utf8").toLowerCase();
    for (const phrase of banned) {
      if (text.includes(phrase)) copyOffenders += `${rel}:"${phrase}" `;
    }
  }
  check("public copy has no unsupported claims", copyOffenders === "", copyOffenders);
}

console.log(
  failures === 0
    ? `\nAll architecture invariants held.`
    : `\n${failures} architecture invariant(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
