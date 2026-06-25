// AI Assist v2 + pricing/copy tests (no framework, no network).
//
//   node --experimental-strip-types scripts/ai-assist-tests.mts
//
// Exercises the candidate-comparison design: AI returns an independent candidate
// and/or a repair plan; the validator compares them with the parser result and
// adopts only when AI reconciles or materially improves. All via an injected mock
// caller (no network). Synthetic data only.

import {
  aiAssistConfig,
  isAiAssistEligible,
  parseAiResponse,
  parseAiTransactions,
  runAiAssist,
  resolveAiAssist,
  buildAiEvidence,
  candidateBeatsParser,
  repairCreditCardInterestFees,
  evaluateCandidateQuality,
  buildBlindersPacket,
  SYSTEM_PROMPT,
  type AiAssistConfig,
  type ChatResult,
} from "../src/lib/ai-assist.ts";
import { detectCreditCardInterestFees } from "../src/lib/parser.ts";
import {
  buildStatementFromRows,
  buildParsedStatement,
  parsedStatementToRows,
  type ParsedStatement,
} from "../src/lib/statement-model.ts";
import { detectCategoryColumnContext, carryForwardRowDates, normalizeTransferDescription, type ParseResult } from "../src/lib/parser.ts";
import { parseStatement } from "../src/lib/statement-pipeline.ts";
import { buildSampleItems, coordinateSamples } from "../src/lib/coordinate-table-samples.ts";
import { groupVisualLines } from "../src/lib/coordinate-table.ts";
import type { TransactionRow } from "../src/lib/upload.ts";
import { computeBalanceCheck, resolveBalanceStatus, getRowWarnings, deriveAmount, countRowWarningSeverity, rowsToCsv, CORE_CSV_HEADERS, CSV_HEADERS } from "../src/lib/upload.ts";
import { conversionPresentation, resolveConversionState, type ConversionInputs } from "../src/lib/conversion-state.ts";
import { evaluateAiEligibility } from "../src/lib/ai-assist.ts";
import { recoverDescriptionFromLine, parseDayMonthDate, detectStatementDateContext, resolveDayMonthDate, detectCreditCardSummary, detectCreditCardBalances, splitTrailingSpendCategory } from "../src/lib/parser.ts";
import { isAggregateOrPlaceholderDescription } from "../src/lib/upload.ts";
import { resolveCreditCardOpenClose } from "../src/lib/coordinate-table.ts";
import { detectMeaningfulPages, analyzePreviewLimit } from "../src/lib/free-preview.ts";
import { shouldShowDiagnostics, buildSafeParseSummary } from "../src/lib/parser-diagnostics.ts";
import { estimateAiCost, formatUsd, AI_MODEL_PRICING } from "../src/lib/ai-cost.ts";
import { selectReviewMessage } from "../src/lib/review-messages.ts";
import {
  pricingPlans,
  pricingSubheadline,
  pricingFooter,
  pricingHeadline,
  categoryFeatureHeadline,
  categoryFeatureSubtext,
} from "../src/lib/pricing.ts";
import { siteConfig } from "../src/lib/site.ts";
import { generalFaqs } from "../src/lib/faq.ts";
import { SCANNED_PDF_WARNING } from "../src/lib/parser.ts";
import {
  selectVisionRegions,
  renderVisionEvidence,
  analyzeVisionPages,
  EXCLUDED_REGION_KINDS,
  type VisionImage,
  type RegionRenderer,
} from "../src/lib/pdf-render.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
let rid = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok    ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function row(over: Partial<TransactionRow> = {}): TransactionRow {
  rid += 1;
  return {
    id: `r-${rid}`,
    date: "2024-01-02",
    description: "Row",
    debit: null,
    credit: null,
    balance: null,
    category: "",
    confidence: 0.9,
    ...over,
  };
}
function bank(rows: TransactionRow[], opening: number, closing: number): ParsedStatement {
  return buildStatementFromRows(rows, { statementKind: "bank-account", openingBalance: opening, closingBalance: closing });
}
function cc(
  rows: TransactionRow[],
  opening: number,
  closing: number,
  summary?: { credits: number | null; debits: number | null },
): ParsedStatement {
  return buildStatementFromRows(rows, {
    statementKind: "credit-card",
    openingBalance: opening,
    closingBalance: closing,
    summary,
  });
}

const ON: AiAssistConfig = { enabled: true, model: "m", hasKey: true, missingConfig: [] };
const reply = (obj: unknown) => async (): Promise<ChatResult> => ({ ok: true, content: JSON.stringify(obj), errorLabel: null });
const fail = (errorLabel: string) => async (): Promise<ChatResult> => ({ ok: false, content: null, errorLabel });
const raw = (content: string) => async (): Promise<ChatResult> => ({ ok: true, content, errorLabel: null });

// ----- config + eligibility -----
check("disabled with no env", aiAssistConfig({} as NodeJS.ProcessEnv).enabled === false);
check("missingConfig names both", aiAssistConfig({} as NodeJS.ProcessEnv).missingConfig.join(",") === "OPENAI_API_KEY,AI_ASSIST_MODEL");
check("enabled with key+model", aiAssistConfig({ OPENAI_API_KEY: "x", AI_ASSIST_MODEL: "m" } as NodeJS.ProcessEnv).enabled);
const cleanStmt = bank([row({ credit: 100, balance: 200 })], 100, 200); // reconciles
check("clean reconciled parse is not eligible", isAiAssistEligible(cleanStmt) === false);
const brokenStmt = bank([row({ credit: 10 })], 100, 200); // 100+10≠200
check("non-reconciling parse is eligible", isAiAssistEligible(brokenStmt) === true);

// ----- response parsing -----
check("parseAiResponse rejects prose", parseAiResponse("not json") === null);
check("parseAiResponse rejects neither-mode", parseAiResponse("{}") === null);
check("parseAiResponse rejects old transactions-only shape", parseAiResponse('{"transactions":[{"amount":1}]}') === null);
check("parseAiResponse accepts candidate", Boolean(parseAiResponse('{"candidate":{"transactions":[]}}')?.candidate));
check("parseAiResponse accepts repairPlan", Boolean(parseAiResponse('{"repairPlan":{"rowsToAdd":[]}}')?.repairPlan));
check("parseAiTransactions still works", Array.isArray(parseAiTransactions('{"transactions":[{"description":"x","credit":1,"amount":1}]}')));

// ----- evidence safeguards -----
const ev = buildAiEvidence(brokenStmt);
check("evidence detects parser opening/closing balances", ev.detectedBalances.includes(100) && ev.detectedBalances.includes(200));

// ----- status flow via mock caller -----
async function run(parser: ParsedStatement, content: () => Promise<ChatResult>, evidence?: object) {
  return runAiAssist(parser, ON, {}, { call: content, env: {} as NodeJS.ProcessEnv, evidence });
}

{
  // not-eligible → no call.
  let called = false;
  const r = await runAiAssist(cleanStmt, ON, {}, { call: async () => { called = true; return { ok: true, content: "{}", errorLabel: null }; }, env: {} as NodeJS.ProcessEnv });
  check("not-eligible makes no call", r.outcome.status === "not-eligible" && !called);
}
{
  // not-configured (eligible, no key/model).
  const r = await runAiAssist(brokenStmt, aiAssistConfig({} as NodeJS.ProcessEnv), {}, { env: {} as NodeJS.ProcessEnv });
  check("not-configured returned, no call", r.outcome.status === "not-configured");
}
check("call-failed surfaces error label", (await run(brokenStmt, fail("http-401"))).outcome.status === "call-failed");
check("invalid-response on bad JSON", (await run(brokenStmt, raw("here you go (not json)"))).outcome.status === "invalid-response");
check("no-usable-result when neither mode builds", (await run(brokenStmt, reply({ candidate: { transactions: [] } }))).outcome.status === "no-usable-result");

// 1) AI independent candidate reconciles when parser does not.
{
  const r = await run(brokenStmt, reply({
    candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 200, transactions: [{ description: "Deposit", credit: 100, amount: 100 }], confidence: 0.9, issues: [] },
  }));
  check(
    "independent candidate reconciles + adopted",
    r.outcome.status === "reconciled" && r.outcome.adoptedCandidateSource === "ai-candidate" && Boolean(r.statement) && r.statement!.validation.status === "passed",
    r.outcome.status,
  );
  check("independent candidate built flag set", r.outcome.aiIndependentCandidateBuilt === true);
}

// 2) AI repair plan selects a better detected account section (right opening).
{
  // parser picked the tiny share opening (5.00); real business opening 25,816.58.
  const parser = bank(
    [row({ credit: 20000 }), row({ debit: 10000 }), row({ credit: 22396.47 }), row({ debit: 20335.17 })],
    5,
    37877.88,
  );
  const r = await run(
    parser,
    reply({ repairPlan: { selectedSectionIndex: 2, openingBalanceSourceCandidate: 25816.58 } }),
    { detectedBalances: [25816.58] }, // route would detect this balance line
  );
  check(
    "repair plan re-selects detected section opening → reconciles",
    r.outcome.status === "reconciled" && r.outcome.adoptedCandidateSource === "ai-repair-plan" && r.outcome.aiSelectedSectionIndex === 2,
    `${r.outcome.status} diff=${r.outcome.postDifference}`,
  );
}

// 3) AI repair plan adds missing dateless fee rows.
{
  const parser = bank([row({ credit: 100 })], 100, 192.5); // 100+100=200 ≠ 192.50 (missing 7.50 in fees)
  const r = await run(parser, reply({
    repairPlan: {
      rowsToAdd: [
        { description: "Service Charge", debit: 5, amount: -5 },
        { description: "Account Fee", debit: 2.5, amount: -2.5 },
      ],
      closingBalanceSourceCandidate: 192.5,
    },
  }));
  check(
    "repair plan adds fee rows → reconciles",
    r.outcome.status === "reconciled" && r.outcome.adoptedCandidateSource === "ai-repair-plan" && r.statement!.transactions.length === 3,
    `${r.outcome.status} rows=${r.statement?.transactions.length}`,
  );
}

// 4) AI unsupported balance override is rejected (kept at parser value, not adopted).
{
  const parser = bank([row({ credit: 20000 }), row({ debit: 10000 })], 5, 37877.88);
  const r = await run(parser, reply({ repairPlan: { openingBalanceSourceCandidate: 99999.99 } }));
  check(
    "unsupported balance override rejected + not adopted",
    r.outcome.aiRejectedReason === "unsupported-balance" && r.outcome.adoptedCandidateSource === "parser" && r.statement === undefined,
    `${r.outcome.status} reason=${r.outcome.aiRejectedReason}`,
  );
}

// 5) AI no-improvement keeps parser result.
{
  const r = await run(brokenStmt, reply({
    candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 200, transactions: [{ description: "Same", credit: 10, amount: 10 }], confidence: 0.5, issues: [] },
  }));
  check("no-improvement keeps parser", r.outcome.status === "no-improvement" && r.statement === undefined && r.outcome.applied === true);
}

// 6) Candidate comparison chooses deterministic when AI is worse.
{
  const parser = bank([row({ credit: 100 })], 100, 150); // diff +50
  const r = await run(parser, reply({
    candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 150, transactions: [{ description: "Worse", credit: 140, amount: 140 }], confidence: 0.9, issues: [] },
  }));
  check("worse AI candidate rejected (parser kept)", r.outcome.adoptedCandidateSource === "parser" && r.outcome.status === "no-improvement");
}

// 7) Candidate comparison helper: validated/reconciling candidate beats a non-reconciling parser.
{
  const reconciled = bank([row({ credit: 100, balance: 200 })], 100, 200);
  check("candidateBeatsParser true when AI reconciles & parser does not", candidateBeatsParser(brokenStmt, reconciled));
  check("candidateBeatsParser false when AI equals parser", candidateBeatsParser(brokenStmt, brokenStmt) === false);
}

// ----- route-decision integration: aiAssist always present -----
{
  const res = await resolveAiAssist(brokenStmt, [], ON, {}, {
    call: reply({ candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 200, transactions: [{ description: "D", credit: 100, amount: 100 }], confidence: 0.9, issues: [] } }),
    env: {} as NodeJS.ProcessEnv,
  });
  check("route decision: outcome always present + adopted on reconcile", Boolean(res.outcome) && res.outcome.status === "reconciled" && res.statement.validation.status === "passed");
}
{
  const res = await resolveAiAssist(brokenStmt, [], aiAssistConfig({} as NodeJS.ProcessEnv), {}, { env: {} as NodeJS.ProcessEnv });
  check("route decision: not-configured still returns outcome, keeps parser", res.outcome.status === "not-configured" && res.statement === brokenStmt);
}

// ----- honest review messages -----
for (const s of ["not-eligible", "not-configured", "disabled", "call-failed", "invalid-response", "no-usable-result"] as const) {
  const m = selectReviewMessage(s, true);
  check(`message for ${s} never says AI-assisted`, !/ai-assisted/i.test(m.title) && !/ai-assisted/i.test(m.body));
}
for (const s of ["no-improvement", "improved", "reconciled"] as const) {
  check(`message for ${s} says AI-assisted review`, /ai-assisted review/i.test(selectReviewMessage(s, true).title));
}
check("no message uses 'AI-recovered'", (["reconciled", "improved", "no-improvement", undefined] as const).every((s) => {
  const m = selectReviewMessage(s, true);
  return !/ai-recovered/i.test(m.title) && !/ai-recovered/i.test(m.body);
}));

// ----- scanned + pricing copy -----
check("scanned message says digital PDFs only", SCANNED_PDF_WARNING.includes("digital PDF statements only"));
check("scanned message does not claim OCR", !/OCR/i.test(SCANNED_PDF_WARNING));
check("every tier includes CSV + Excel", pricingPlans.every((p) => p.features.some((f) => /csv \+ excel/i.test(f))));
check("no tier mentions 'No ads'", pricingPlans.every((p) => p.features.every((f) => !/no ads/i.test(f))));
check("subheadline mentions guided AI verification", /guided ai verification/i.test(pricingSubheadline));
check("footer says scanned/image not supported", /scanned or image-based statements are not currently supported/i.test(pricingFooter));

// ----- vision fallback: region/crop selection -----
{
  const regions = selectVisionRegions({ pageCount: 3, hasLowConfidence: true });
  const excluded = new Set<string>(EXCLUDED_REGION_KINDS as readonly string[]);
  check("crop selection excludes footer/legal/blank kinds", regions.every((r) => !excluded.has(r.kind)) && regions.length > 0);
  // Summary/totals are NOT sent as images (they become text anchors); selection is
  // transaction-table focused.
  check("crop selection targets the transaction table", regions.some((r) => r.kind === "table-header") && regions.some((r) => r.kind === "table-body"));
  check("crop selection does not send summary/totals images", regions.every((r) => r.kind !== "summary" && r.kind !== "totals"));

  // Transaction pages come FIRST and are chunked (header chunk + body chunk).
  const tx = selectVisionRegions({
    pageCount: 6,
    hasLowConfidence: true,
    transactionHeaderPages: [3, 4],
    summaryPages: [1, 5],
    legalPages: [2],
    maxRegions: 10,
  });
  check("transaction-table evidence is ordered first", tx.length > 0 && (tx[0].kind === "table-header" || tx[0].kind === "table-body"));
  check("no summary/totals images for credit-card table", tx.every((r) => r.kind !== "summary" && r.kind !== "totals"));
  check("transaction pages 3 and 4 are the evidence pages", [...new Set(tx.map((r) => r.page))].sort((a, b) => a - b).join(",") === "3,4");
  check("each tx page is chunked into header + body halves", tx.some((r) => r.page === 3 && r.band === "upper") && tx.some((r) => r.page === 3 && r.band === "lower"));
  check("legal pages are never targeted", tx.every((r) => r.page !== 2));
}

// ----- vision rendering: crop vs full-page fallback + graceful degrade -----
{
  const bytes = new Uint8Array([1, 2, 3]);
  const regions = selectVisionRegions({ pageCount: 2, hasLowConfidence: false });
  const cropRenderer: RegionRenderer = async () => ({ dataUrl: "data:image/png;base64,AAAA", crop: true });
  const pageRenderer: RegionRenderer = async () => ({ dataUrl: "data:image/png;base64,AAAA", crop: false });
  const noRenderer: RegionRenderer = async () => null;

  const cropped = await renderVisionEvidence(bytes, regions, { enabled: true, renderer: cropRenderer });
  check("crops produced when renderer supports cropping", cropped.available && cropped.crops > 0 && cropped.fullPages === 0);
  const fulls = await renderVisionEvidence(bytes, regions, { enabled: true, renderer: pageRenderer });
  check("full-page fallback used when crops unavailable", fulls.available && fulls.fullPages > 0 && fulls.crops === 0);
  const none = await renderVisionEvidence(bytes, regions, { enabled: true, renderer: noRenderer });
  check(
    "graceful degrade to no images + failure reason when renderer unavailable",
    none.available === false && none.images.length === 0 && Boolean(none.failureReason),
  );
  const disabled = await renderVisionEvidence(bytes, regions, { enabled: false });
  check("no rendering when vision disabled", disabled.available === false && disabled.failureReason === "vision-disabled");

  // Default renderer on invalid PDF bytes → a SPECIFIC reason, never "render-failed".
  const badBytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
  const realFail = await renderVisionEvidence(badBytes, regions, { enabled: true });
  check(
    "default renderer reports a specific failure reason (not generic)",
    realFail.available === false &&
      ["page-render-error", "canvas-backend-unavailable", "pdf-renderer-unavailable"].includes(
        realFail.failureReason ?? "",
      ) &&
      realFail.failureReason !== "render-failed",
    realFail.failureReason ?? "(null)",
  );
}

// renderFailedReason flows into the outcome (text-layout fallback diagnostics).
{
  const r = await runAiAssist(brokenStmt, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    renderFailedReason: "canvas-backend-unavailable",
    call: reply({ candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 200, transactions: [{ description: "D", credit: 100, amount: 100 }] } }),
  });
  check(
    "render failure reason surfaced + text-layout fallback",
    r.outcome.aiRenderFailedReason === "canvas-backend-unavailable" && r.outcome.aiFallbackType === "text-layout" && r.outcome.aiVisionUsed === false,
  );
}

// Client bundle must not statically import the native renderer / canvas.
{
  function clientFilesImportingNative(dir: string): string[] {
    const hits: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) hits.push(...clientFilesImportingNative(full));
      else if (/\.(tsx|ts)$/.test(entry)) {
        const src = readFileSync(full, "utf8");
        if (!src.includes('"use client"')) continue;
        if (/@napi-rs\/canvas/.test(src) || /["']@?\/?.*pdf-render/.test(src)) hits.push(full);
      }
    }
    return hits;
  }
  const offenders = clientFilesImportingNative("src");
  check("no client component imports native renderer / pdf-render", offenders.length === 0, offenders.join(", "));
}

// ----- vision fallback: one multimodal call + diagnostics -----
const img = (id: string): VisionImage => ({ id, kind: "summary", page: 1, band: "top", crop: true, dataUrl: "data:image/png;base64,AAAA" });
{
  let calls = 0;
  const r = await runAiAssist(brokenStmt, ON, {}, {
    images: [img("summary-p1-top")],
    env: {} as NodeJS.ProcessEnv,
    call: async () => {
      calls += 1;
      return { ok: true, content: JSON.stringify({ candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 200, transactions: [{ description: "D", credit: 100, amount: 100 }] } }), errorLabel: null };
    },
  });
  check("exactly one multimodal AI call", calls === 1 && r.outcome.aiCallCount === 1);
  check("vision diagnostics: vision used + fallback type", r.outcome.aiVisionUsed && r.outcome.aiFallbackType === "vision" && r.outcome.aiImageCropsCount === 1 && r.outcome.aiRenderedPagesCount === 1);
}
{
  // No images → single text-layout call (no second vision call).
  let calls = 0;
  const r = await runAiAssist(brokenStmt, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    call: async () => { calls += 1; return { ok: true, content: JSON.stringify({ candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 200, transactions: [{ description: "D", credit: 100, amount: 100 }] } }), errorLabel: null }; },
  });
  check("text-layout fallback is a single call", calls === 1 && r.outcome.aiFallbackType === "text-layout" && r.outcome.aiVisionUsed === false);
}

// AI vision candidate reconciles using a balance backed by a provided image.
{
  const r = await runAiAssist(brokenStmt, ON, {}, {
    images: [img("summary-p1-top")],
    env: {} as NodeJS.ProcessEnv,
    call: reply({ candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 250, transactions: [{ description: "D", credit: 150, amount: 150 }], visualEvidenceReference: "summary-p1-top" } }),
  });
  check(
    "vision candidate reconciles via visually-backed balance",
    r.outcome.status === "reconciled" && r.outcome.adoptedCandidateSource === "ai-candidate" && r.statement!.closingBalance === 250,
    `${r.outcome.status} close=${r.statement?.closingBalance}`,
  );
}

// AI candidate rejected when it invents an unsupported balance WITHOUT visual evidence.
{
  const r = await runAiAssist(brokenStmt, ON, {}, {
    env: {} as NodeJS.ProcessEnv, // no images → no visual backing possible
    call: reply({ candidate: { statementKind: "bank-account", openingBalance: 5, closingBalance: 200, transactions: [{ description: "D", credit: 10, amount: 10 }] } }),
  });
  check(
    "invented unsupported balance rejected (no visual evidence)",
    r.outcome.aiRejectedReason === "unsupported-balance" && r.outcome.adoptedCandidateSource === "parser",
    `${r.outcome.status} reason=${r.outcome.aiRejectedReason}`,
  );
}

// Diagnostics carry no private content.
{
  const r = await runAiAssist(brokenStmt, ON, {}, {
    images: [img("summary-p1-top")],
    env: {} as NodeJS.ProcessEnv,
    call: reply({ candidate: { statementKind: "bank-account", openingBalance: 100, closingBalance: 200, transactions: [{ description: "SECRETMERCHANT", credit: 100, amount: 100 }] } }),
  });
  const serialized = JSON.stringify(r.outcome);
  check("AI outcome diagnostics contain no row/description content", !serialized.includes("SECRETMERCHANT") && !serialized.includes("base64"));
}

// ----- false-pass guard: summary totals vs near-zero parsed activity -----
{
  // The reported bug: a credit-card statement where the parser captured only a
  // warning line, used New Balance as BOTH opening and closing (so opening==closing
  // "reconciles"), and reported a false PASS while the summary shows real activity.
  const warningRow = row({ description: "ON YOUR LAST STATEMENT. IF THE", debit: null, credit: null, balance: null });
  const falsePass = cc([warningRow], 23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  check(
    "false-pass blocked: opening==closing + nonzero summary + 1 row → needs-review",
    falsePass.validation.status === "needs-review",
    `status=${falsePass.validation.status}`,
  );
  check(
    "false-pass blocked: it is NOT reported as passed",
    falsePass.validation.status !== "passed",
  );
  check(
    "false-pass blocked: it remains AI-eligible",
    isAiAssistEligible(falsePass) === true,
  );

  // A genuinely reconciled, fully-populated CC statement must STILL pass (no regression).
  const realRows = [
    row({ description: "Payment", credit: 1519.68, debit: null }),
    row({ description: "Purchase A", debit: 22000, credit: null }),
    row({ description: "Purchase B", debit: 972.51, credit: null }),
  ];
  const goodCc = cc(realRows, 1605.47, 23058.3, { credits: 1519.68, debits: 22972.51 });
  check(
    "reconciled CC with full rows + matching summary still passes",
    goodCc.validation.status === "passed",
    `status=${goodCc.validation.status} diff=${goodCc.validation.difference}`,
  );
}

// A summary with NO activity (both totals zero/absent) must not trip the guard.
{
  const trivial = cc([row({ description: "Single", debit: 10, credit: null })], 100, 110, { credits: null, debits: 10 });
  check("zero/absent summary credits does not force needs-review", trivial.validation.status === "passed", trivial.validation.status);
}

// ----- user-facing balance status reflects validation, not bare arithmetic -----
{
  // The reported bug: opening == closing with no real activity → arithmetic check
  // "passes", but validation said needs-review. The UI must show Needs review.
  const arithCheck = computeBalanceCheck(23058.3, 23058.3, [row({ description: "ON YOUR LAST STATEMENT", debit: null, credit: null })], "credit-card");
  check("arithmetic-only check still reports passed (the trap)", arithCheck.passed === true);
  check(
    "resolveBalanceStatus downgrades to review when validation needs-review (diff 0)",
    resolveBalanceStatus(arithCheck, "needs-review") === "review",
  );
  check(
    "credit-card summary mismatch cannot render green Passed",
    resolveBalanceStatus(arithCheck, "needs-review") !== "passed",
  );
  check("resolveBalanceStatus passes only when validation passed", resolveBalanceStatus(arithCheck, "passed") === "passed");
  check("resolveBalanceStatus limited when balances unavailable", resolveBalanceStatus({ available: false, passed: false }, "passed") === "limited");
  check("resolveBalanceStatus limited when validation limited", resolveBalanceStatus(arithCheck, "limited") === "limited");
}

// ----- AI near-zero candidate is rejected when summary totals are meaningful -----
{
  const ccBroken = cc([row({ description: "ON YOUR LAST STATEMENT. IF THE", debit: null, credit: null })], 23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  check("broken CC parse is AI-eligible", isAiAssistEligible(ccBroken) === true);
  // AI returns a one-row, near-zero candidate (the false-pass shape) → must be rejected.
  // The zero-amount row is now dropped during sanitization, leaving no usable rows,
  // so the safe reason is "no-transaction-table-candidate" (still a clean rejection).
  const r = await runAiAssist(ccBroken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    call: reply({ candidate: { statementKind: "credit-card", openingBalance: 23058.3, closingBalance: 23058.3, transactions: [{ description: "ON YOUR LAST STATEMENT", amount: 0 }] } }),
  });
  check(
    "AI near-zero candidate rejected with a safe reason",
    ["ai-returned-near-zero-rows", "no-transaction-table-candidate"].includes(r.outcome.aiRejectedReason ?? ""),
    `reason=${r.outcome.aiRejectedReason}`,
  );
  check("AI near-zero candidate not adopted", r.outcome.adoptedCandidateSource === "parser" && r.outcome.improved === false);

  // evidence flag is raised for this shape.
  const ev2 = buildAiEvidence(ccBroken);
  check("evidence flags parserLikelyMissedTransactions", ev2.parserLikelyMissedTransactions === true);

  // A real AI candidate that rebuilds the table and matches the summary is adopted.
  // (Previous Balance 1605.47 is a deterministically-detected balance the AI may use.)
  const good = await runAiAssist(ccBroken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    evidence: { detectedBalances: [1605.47, 23058.3] },
    call: reply({ candidate: { statementKind: "credit-card", openingBalance: 1605.47, closingBalance: 23058.3, summaryTotals: { totalCredits: 1519.68, totalDebits: 22972.51 }, transactions: [
      { description: "Payment", credit: 1519.68, amount: 1519.68 },
      { description: "Purchase A", debit: 22000, amount: -22000 },
      { description: "Purchase B", debit: 972.51, amount: -972.51 },
    ] } }),
  });
  check(
    "AI candidate that rebuilds the table + matches summary is adopted",
    good.outcome.improved === true && good.outcome.adoptedCandidateSource === "ai-candidate",
    `status=${good.outcome.status} reason=${good.outcome.aiRejectedReason}`,
  );
}

// ----- diagnostics distinguish "vision ran but AI failed" vs "vision did not run" -----
{
  const ccBroken = cc([row({ description: "warn", debit: null, credit: null })], 100, 100, { credits: 50, debits: 50 });
  // Vision ran (images provided) but AI returns an empty table (no usable rows).
  const visionRan = await runAiAssist(ccBroken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    images: [img("table-body-p3-middle")],
    call: reply({ candidate: { statementKind: "credit-card", transactions: [] } }),
  });
  check("vision-ran-but-failed: aiVisionUsed true + fallback vision", visionRan.outcome.aiVisionUsed === true && visionRan.outcome.aiFallbackType === "vision");
  check("vision-ran-but-failed: no-usable-result + safe reason", visionRan.outcome.status === "no-usable-result" && visionRan.outcome.aiRejectedReason === "no-transaction-table-candidate");

  // Vision did NOT run (no images) — text-layout fallback, render reason recorded.
  const noVision = await runAiAssist(ccBroken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    renderFailedReason: "canvas-backend-unavailable",
    call: reply({ candidate: { statementKind: "credit-card", transactions: [] } }),
  });
  check("vision-did-not-run: aiVisionUsed false + reason surfaced", noVision.outcome.aiVisionUsed === false && noVision.outcome.aiRenderFailedReason === "canvas-backend-unavailable");
}

// ----- vision page classification (analyzeVisionPages) -----
{
  // Page layout: 1=summary, 2=legal disclosure, 3=TRANSACTIONS, 4=TRANSACTIONS continued, 5=rewards
  const pages = [
    "Previous Balance 1,605.47 New Balance 23,058.30 Minimum Payment 35.00",
    "Important Information about your account. Cardholder agreement terms and conditions.",
    "TRANSACTIONS\nTrans Date Posting Date Description Amount\nJan 2 Jan 3 Store 10.00",
    "TRANSACTIONS Continued\nJan 5 Jan 6 Store 20.00",
    "Rewards points summary. You earned points this period.",
  ];
  const a = analyzeVisionPages(pages);
  check("analyze: transaction pages detected (3 & 4)", a.transactionHeaderPages.includes(3) && a.transactionHeaderPages.includes(4));
  check("analyze: summary page detected (1)", a.summaryPages.includes(1));
  check("analyze: legal page detected (2) and excluded", a.legalPages.includes(2));
  check("analyze: rewards page flagged as warning/reward (5)", a.warningRewardPages.includes(5));
  check("analyze: a transaction page is never also legal/warning", a.legalPages.every((p) => !a.transactionHeaderPages.includes(p)) && a.warningRewardPages.every((p) => !a.transactionHeaderPages.includes(p)));

  // Selection PRIORITIZES the transaction pages and EXCLUDES the legal page.
  const regions = selectVisionRegions({
    pageCount: pages.length,
    hasLowConfidence: true,
    transactionHeaderPages: a.transactionHeaderPages,
    summaryPages: a.summaryPages,
    legalPages: a.legalPages,
  });
  check("selection includes a transaction page", regions.some((r) => a.transactionHeaderPages.includes(r.page)));
  check("selection never targets the legal page", regions.every((r) => !a.legalPages.includes(r.page)));
  check("selection includes table-header/body kinds for tx pages", regions.some((r) => r.kind === "table-header") && regions.some((r) => r.kind === "table-body"));
}

// visionSelection diagnostics thread through the outcome (and carry no text).
{
  const r = await runAiAssist(brokenStmt, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    visionSelection: {
      selectedPageIndexes: [3, 4],
      selectedRegionKinds: ["summary", "table-header", "table-body"],
      selectedRegionCount: 5,
      transactionHeaderPagesDetected: 2,
      summaryPagesDetected: 1,
      excludedLegalPagesCount: 1,
      excludedWarningRewardPagesCount: 1,
    },
    call: reply({ candidate: null, repairPlan: null }),
  });
  check(
    "visionSelection diagnostics surfaced on outcome",
    r.outcome.visionSelection?.selectedRegionCount === 5 && r.outcome.visionSelection?.transactionHeaderPagesDetected === 2,
  );
}

// ----- credit-card interest / fee detection -----
{
  const lines = [
    "+Interest Charged $35.94",
    "+Fees Charged $0.00",
    "Total Debits $22,972.51",
    "FEES",
    "TOTAL FEES FOR THIS PERIOD $0.00",
    "INTEREST",
    "29/01 29/01 Interest Charge on Purchases $35.94",
    "29/01 29/01 Interest Charge on Cash Advances $0.00",
    "TOTAL INTEREST FOR THIS PERIOD $35.94",
    "Total Interest Charged in 2025 $35.94",
  ];
  const d = detectCreditCardInterestFees(lines);
  check("interest detect: current-period interest = 35.94", d.interestCharged === 35.94, String(d.interestCharged));
  check("interest detect: current-period fees = 0", d.feesCharged === 0, String(d.feesCharged));
  check("interest detect: one nonzero line item (purchases)", d.lineItems.length === 1 && Math.abs(d.lineItems[0].amount - 35.94) < 0.001);
  check("interest detect: zero cash-advance line ignored", d.lineItems.every((li) => li.amount >= 0.01));
  check("interest detect: year-to-date total not a line item", d.lineItems.every((li) => !/2025/.test(li.description)));
}

// ----- credit-card interest / fee repair -----
{
  const detected = { interestCharged: 35.94, feesCharged: 0, lineItems: [{ description: "Interest Charge on Purchases", amount: 35.94, date: "2025-01-29" }] };
  // Purchases reconcile credits but debits are short by exactly the interest (35.94).
  const short = cc(
    [row({ debit: 22000, credit: null }), row({ debit: 936.57, credit: null }), row({ credit: 1519.68, debit: null })],
    1605.47,
    23058.3,
    { credits: 1519.68, debits: 22972.51 },
  );
  check("repair precondition: candidate is short on debits", short.validation.status === "needs-review");
  const rep = repairCreditCardInterestFees(short, detected);
  check("interest repair applied", rep.applied === true && rep.rowsAdded === 1);
  const repDebits = rep.statement.transactions.reduce((a, t) => a + (t.debit ?? 0), 0);
  check("interest repair brings debits to summary total", Math.abs(repDebits - 22972.51) < 0.001, String(repDebits));
  check("interest repair reconciles → passed", rep.statement.validation.status === "passed", rep.statement.validation.status);
  check("interest repair row has a description + debit", rep.statement.transactions.some((t) => /interest/i.test(t.description) && (t.debit ?? 0) > 0));

  // Idempotent: repairing the already-repaired statement is a no-op (no duplicate row).
  const rep2 = repairCreditCardInterestFees(rep.statement, detected);
  check("interest repair is idempotent (no duplicate)", rep2.applied === false && rep2.rowsAdded === 0);

  // No-op when the interest row is already present.
  const already = cc(
    [row({ debit: 22936.57, credit: null }), row({ credit: 1519.68, debit: null }), row({ debit: 35.94, description: "Interest Charge on Purchases", credit: null })],
    1605.47,
    23058.3,
    { credits: 1519.68, debits: 22972.51 },
  );
  const repAlready = repairCreditCardInterestFees(already, detected);
  check("interest repair no-op when already present", repAlready.applied === false);

  // Deterministic repair only uses detected evidence: a shortfall that does NOT
  // match detected interest/fees is flagged, not invented.
  const mismatched = cc(
    [row({ debit: 22872.51, credit: null }), row({ credit: 1519.68, debit: null })],
    1605.47,
    23058.3,
    { credits: 1519.68, debits: 22972.51 },
  );
  const repMis = repairCreditCardInterestFees(mismatched, detected); // short by 100, interest 35.94
  check("interest repair flags missing-interest-or-fee-row on mismatch", repMis.applied === false && repMis.issue === "missing-interest-or-fee-row");

  // Bank-account statements are never interest/fee-repaired.
  const bankShort = bank([row({ credit: 10 })], 100, 200);
  check("interest repair ignores bank-account statements", repairCreditCardInterestFees(bankShort, detected).applied === false);
}

// ----- AI candidate short by interest is repaired + adopted -----
{
  const broken = cc([row({ description: "warn", debit: null, credit: null })], 23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  const r = await runAiAssist(broken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    evidence: {
      detectedBalances: [1605.47, 23058.3],
      creditCardInterestFees: { interestCharged: 35.94, feesCharged: 0, lineItems: [{ description: "Interest Charge on Purchases", amount: 35.94, date: "2025-01-29" }] },
    },
    // AI rebuilds purchases (debits short by the interest) + the payment credit.
    call: reply({ candidate: { statementKind: "credit-card", openingBalance: 1605.47, closingBalance: 23058.3, summaryTotals: { totalCredits: 1519.68, totalDebits: 22972.51 }, transactions: [
      { description: "Purchase A", debit: 22000, amount: -22000 },
      { description: "Purchase B", debit: 936.57, amount: -936.57 },
      { description: "Payment", credit: 1519.68, amount: 1519.68 },
    ] } }),
  });
  check(
    "AI candidate short by interest is repaired and reconciles",
    r.outcome.improved === true && r.outcome.interestFeeRepairApplied === true && r.outcome.status === "reconciled",
    `status=${r.outcome.status} repair=${r.outcome.interestFeeRepairApplied}`,
  );
  check("repaired adopted statement has the interest row", (r.rows ?? []).some((row) => /interest/i.test(row.description) && (row.debit ?? 0) > 0));
  check("AI call duration recorded", typeof r.outcome.aiCallDurationMs === "number");
}

// ----- zero debit/credit normalization (no false "both filled" warning) -----
{
  const debitOnly = row({ debit: 228.85, credit: 0 });
  check("debit + credit:0 is NOT flagged 'both filled'", !getRowWarnings(debitOnly).includes("Debit and credit cannot both be filled."));
  check("debit + credit:0 derives a negative (debit) amount", deriveAmount(228.85, 0) === -228.85);

  const creditOnly = row({ debit: 0, credit: 263.97 });
  check("credit + debit:0 is NOT flagged 'both filled'", !getRowWarnings(creditOnly).includes("Debit and credit cannot both be filled."));
  check("credit + debit:0 derives a positive (credit) amount", deriveAmount(0, 263.97) === 263.97);

  const bothZero = row({ debit: 0, credit: 0 });
  check("debit:0 + credit:0 is flagged as missing amount", getRowWarnings(bothZero).includes("Add a debit or credit amount."));

  // A reconciled credit-card result (every row one-sided, opposite column 0) has no row warnings.
  const ccRows = [
    row({ debit: 22000, credit: 0, date: "2025-01-10", description: "Purchase A" }),
    row({ debit: 936.57, credit: 0, date: "2025-01-12", description: "Purchase B" }),
    row({ debit: 35.94, credit: 0, date: "2025-01-29", description: "Interest Charge on Purchases" }),
    row({ debit: 0, credit: 1519.68, date: "2025-01-05", description: "Payment" }),
  ];
  const sev = countRowWarningSeverity(ccRows);
  check("zero-normalized credit-card rows have no material warnings", sev.material === 0, `material=${sev.material}`);
}

// ----- conversion presentation state -----
{
  const base: ConversionInputs = {
    balanceStatus: "passed",
    confidence: 0.95,
    rowCount: 50,
    materialWarningCount: 0,
    minorWarningCount: 0,
    summaryMatched: true,
    previewLimited: false,
    unsupported: false,
  };
  const verified = conversionPresentation(base);
  check("verified state when passed + high conf + no warnings", verified.state === "verified");
  check("verified badge is green + 'Verified'", verified.badgeTone === "green" && verified.badgeLabel === "Verified");
  check("verified shows safe export + export-ready copy", verified.showTopExport && verified.exportTone === "safe");
  check("verified secondary copy is optional spot-check", /spot-check/i.test(verified.secondaryCopy ?? ""));

  const reviewRec = conversionPresentation({ ...base, minorWarningCount: 3 });
  check("review-recommended when passed but minor warnings", reviewRec.state === "review-recommended");
  check("review-recommended is not safe export tone", reviewRec.exportTone !== "safe");

  const needs = conversionPresentation({ ...base, balanceStatus: "review", materialWarningCount: 5 });
  check("needs-review state when not passed / material warnings", needs.state === "needs-review");
  check("needs-review never shows green 'Ready to export'", needs.exportTone !== "safe" && needs.badgeTone !== "green");
  check("needs-review copy says could not verify", /could not fully verify/i.test(needs.bannerBody));

  const preview = conversionPresentation({ ...base, previewLimited: true });
  check("preview-limited state when only preview pages converted", preview.state === "preview-limited");
  check("preview-limited is NOT phrased as parser failure", !/fail/i.test(preview.bannerBody) && /preview/i.test(preview.bannerTitle));
  check("preview-limited export uses 'preview' label + neutral tone", preview.exportLabelPrefix === "preview" && preview.exportTone !== "safe");

  const unsupported = conversionPresentation({ ...base, unsupported: true, rowCount: 0 });
  check("unsupported state hides top export", unsupported.state === "unsupported" && unsupported.showTopExport === false);

  const noRows = conversionPresentation({ ...base, rowCount: 0 });
  check("no rows → needs-review, no top export", resolveConversionState({ ...base, rowCount: 0 }) === "needs-review" && noRows.showTopExport === false);

  // Reclassification: 1 missing description in a reconciled 65-row statement is a
  // SMALL localized issue → review-recommended, NOT needs-review.
  const oneLocalized = conversionPresentation({ ...base, rowCount: 65, materialWarningCount: 1 });
  check("1 material warning in 65 reconciled rows → review-recommended", oneLocalized.state === "review-recommended");
  check("localized review copy says totals matched (not 'could not verify')", /totals matched/i.test(oneLocalized.bannerBody) && !/could not fully verify/i.test(oneLocalized.bannerBody));
  check("localized review copy mentions the highlighted row count", /1 highlighted row/i.test(oneLocalized.bannerBody));

  // Many material warnings (over the rate/count threshold) → needs-review.
  const manyMaterial = conversionPresentation({ ...base, rowCount: 65, materialWarningCount: 10 });
  check("many material warnings → needs-review", manyMaterial.state === "needs-review");

  // Preview-limited overlay must NOT hide a genuine needs-review problem.
  const previewButBroken = conversionPresentation({ ...base, previewLimited: true, rowCount: 65, materialWarningCount: 10 });
  check("preview-limited does not mask needs-review", previewButBroken.state === "needs-review");

  // Preview-limited overlays a verified/review base (page cap, content otherwise good).
  const previewOverVerified = conversionPresentation({ ...base, previewLimited: true });
  check("preview-limited overlays an otherwise-verified base", previewOverVerified.state === "preview-limited");
}

// ----- zero/no-amount AI rows are dropped (cleanup) -----
{
  const broken = cc([row({ description: "warn", debit: null, credit: null })], 23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  const r = await runAiAssist(broken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    evidence: { detectedBalances: [1605.47, 23058.3] },
    // AI returns the real rows PLUS a zero "Interest Charge on Cash Advances" row.
    call: reply({ candidate: { statementKind: "credit-card", openingBalance: 1605.47, closingBalance: 23058.3, summaryTotals: { totalCredits: 1519.68, totalDebits: 22972.51 }, transactions: [
      { transactionDate: "2025-01-10", description: "Purchase A", debit: 22000, amount: -22000 },
      { transactionDate: "2025-01-12", description: "Purchase B", debit: 936.57, amount: -936.57 },
      { transactionDate: "2025-01-29", description: "Interest Charge on Purchases", debit: 35.94, amount: -35.94 },
      { transactionDate: "2025-01-29", description: "Interest Charge on Cash Advances", debit: 0, credit: 0, amount: 0 },
      { transactionDate: "2025-01-05", description: "Payment", credit: 1519.68, amount: 1519.68 },
    ] } }),
  });
  check("zero/no-amount AI row is dropped (4 real rows, not 5)", (r.rows ?? []).length === 4, `rows=${(r.rows ?? []).length}`);
  check("no row is the zero cash-advance line", !(r.rows ?? []).some((x) => /cash advances/i.test(x.description)));
  check("reconciled credit-card is warning-free after cleanup", countRowWarningSeverity(r.rows ?? []).material === 0);
  check("cleanup result still reconciles + adopted", r.outcome.improved === true && r.statement!.validation.status === "passed");
}

// ----- meaningful-page detection + preview-limit analysis -----
{
  const txPage = "01/02 Coffee Shop $4.50\n02/02 Grocery $52.10\n03/02 Payment $100.00";
  const trailerPage = "Thank you for banking with us.\nContact us at the number on the back of your card.";
  const summaryPage = "Statement Period 01/02/2025 - 28/02/2025\nTotal Deposits $100.00";
  const meaningful = detectMeaningfulPages([summaryPage, txPage, trailerPage]);
  check("meaningful pages = transaction pages only", meaningful.length === 1 && meaningful[0] === 2);

  // Skipped page is a trailer → NOT preview-limited.
  const a1 = analyzePreviewLimit([txPage, trailerPage], 1);
  check("trailer-only skipped page → not preview-limited", a1.previewLimited === false && a1.previewLimitedReason === "skipped-pages-not-meaningful");
  // Skipped page has transactions → preview-limited.
  const a2 = analyzePreviewLimit([summaryPage, txPage], 1);
  check("skipped transaction page → preview-limited", a2.previewLimited === true && a2.skippedMeaningfulPagesCount === 1 && a2.previewLimitedReason === "skipped-meaningful-pages");
  // No truncation.
  const a3 = analyzePreviewLimit([txPage], 1);
  check("no truncation → not preview-limited", a3.previewLimited === false && a3.previewLimitedReason === "no-truncation");
  check("preview analysis contains no private content", !JSON.stringify(a2).match(/coffee|grocery|\$/i));
}

// ----- generic bank-table description recovery -----
{
  // Description appears AFTER the amount/date columns (leading-text rule misses it).
  const recovered = recoverDescriptionFromLine("01/02 1,234.56 5,000.00 PAYROLL DEPOSIT", "01/02");
  check("recovers description from trailing text", /payroll deposit/i.test(recovered));
  // Nothing word-like → empty (caller still flags).
  const none = recoverDescriptionFromLine("01/02 1,234.56 5,000.00", "01/02");
  check("no description to recover → empty string", none === "");
}

// ----- AI not called for a minor localized warning after reconciliation -----
{
  // 1 missing description in 65 reconciled rows: validation passed, high conf.
  const many: TransactionRow[] = [];
  for (let i = 0; i < 64; i += 1) many.push(row({ debit: 10, credit: 0, date: "2025-01-02", description: `Row ${i}` }));
  many.push(row({ debit: 10, credit: 0, date: "2025-01-02", description: "" })); // 1 missing description
  const stmt = cc(many, 0, 650, { credits: 0, debits: 650 });
  const elig = evaluateAiEligibility(stmt);
  check("AI not called for 1 missing description in 65 reconciled rows", elig.eligible === false, `reasons=${elig.reasons.join(",")}`);
}

// ----- AI eligibility tightening -----
{
  // Verified parser result (passed, high confidence, clean rows) → AI skipped.
  const clean = cc(
    [row({ debit: 100, credit: 0, date: "2025-01-02", description: "A" }), row({ credit: 100, debit: 0, date: "2025-01-03", description: "Pay" })],
    100,
    100,
    { credits: 100, debits: 100 },
  );
  const cleanElig = evaluateAiEligibility(clean);
  check("AI not eligible for verified parser result", cleanElig.eligible === false && cleanElig.reasons.length === 0);
  check("AI skipped reason is a safe label", cleanElig.skippedReason === "parser-verified");

  // Summary mismatch / missed-table credit card → AI eligible.
  const missed = cc([row({ description: "warn", debit: null, credit: null })], 23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  const missedElig = evaluateAiEligibility(missed);
  check("AI eligible for missed-table credit card", missedElig.eligible === true);
  check("AI eligibility reasons are safe labels", missedElig.reasons.every((r) => /^[a-z-]+$/.test(r)) && missedElig.reasons.includes("validation-not-passed"));

  // Diagnostics carry no private content.
  check("eligibility labels contain no private content", !JSON.stringify({ ...cleanElig, ...missedElig }).match(/\$|account|merchant|warn/i));
}

// ----- dev-only cost estimate -----
{
  check("gpt-5.4-mini is in the pricing table", Boolean(AI_MODEL_PRICING["gpt-5.4-mini"]));
  const exact = estimateAiCost("gpt-5.4-mini", 12000, 1500, 13500);
  check("cost: exact when input+output known", exact.available === true && typeof exact.usd === "number");
  const p = AI_MODEL_PRICING["gpt-5.4-mini"];
  const expected = (12000 / 1e6) * p.inputPer1M + (1500 / 1e6) * p.outputPer1M;
  check("cost: matches the model pricing constants", Math.abs((exact.usd ?? -1) - expected) < 1e-9);
  check("cost: formats as USD string", /^\$\d/.test(formatUsd(exact.usd ?? 0)));

  const totalOnly = estimateAiCost("gpt-5.4-mini", null, null, 13500);
  check("cost: total-only is flagged unavailable", totalOnly.available === false && /total tokens only/i.test(totalOnly.note));

  const none = estimateAiCost(null, null, null, null);
  check("cost: no tokens → unavailable", none.available === false && none.usd === null);

  const unknownModel = estimateAiCost("some-future-model", 1000, 1000, 2000);
  check("cost: unknown model falls back to default pricing", unknownModel.available === true && /default pricing/i.test(unknownModel.note));

  // Cost output carries no statement content — only numbers, a model name, a label.
  check("cost note carries no private content", !/\$\d{3,}|account|merchant/i.test(`${exact.note} ${totalOnly.note}`));
}

// ----- production diagnostics visibility gating -----
{
  check("diagnostics hidden in production by default", shouldShowDiagnostics({ nodeEnv: "production" }) === false);
  check("diagnostics shown in production with opt-in flag", shouldShowDiagnostics({ nodeEnv: "production", showFlag: "true" }) === true);
  check("diagnostics always shown in development", shouldShowDiagnostics({ nodeEnv: "development" }) === true);
  check("diagnostics hidden when flag is not exactly 'true'", shouldShowDiagnostics({ nodeEnv: "production", showFlag: "1" }) === false);
}

// ----- production-safe parse summary (SERVER_SAFE_PARSE_TRACE) -----
{
  // Build a real outcome from a vision run whose candidate carries a secret merchant.
  const broken = cc([row({ description: "warn", debit: null, credit: null })], 23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  const r = await runAiAssist(broken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    images: [img("table-body-p3-middle")],
    evidence: { detectedBalances: [1605.47, 23058.3] },
    call: reply({ candidate: { statementKind: "credit-card", openingBalance: 1605.47, closingBalance: 23058.3, summaryTotals: { totalCredits: 1519.68, totalDebits: 22972.51 }, transactions: [
      { transactionDate: "2025-01-10", description: "SECRETMERCHANT PURCHASE", debit: 22972.51, amount: -22972.51 },
      { transactionDate: "2025-01-05", description: "Payment", credit: 1519.68, amount: 1519.68 },
    ] } }),
  });
  r.outcome.rendererBackendAvailable = true;
  r.outcome.rendererBackendName = "@napi-rs/canvas";
  const summary = buildSafeParseSummary({ validationStatus: "passed", confidence: 0.9, previewLimited: false, outcome: r.outcome });
  const keys = Object.keys(summary);
  check("safe summary includes the vision-path fields", keys.includes("aiFallbackType") && keys.includes("aiVisionUsed") && keys.includes("aiImageCropsCount") && keys.includes("rendererBackendAvailable"));
  check("safe summary values are safe primitives", Object.values(summary).every((v) => v === null || ["string", "number", "boolean"].includes(typeof v)));
  const serialized = JSON.stringify(summary);
  check("safe summary contains no merchant/row/prompt content", !/SECRETMERCHANT|PURCHASE|base64,|data:image|"prompt"/i.test(serialized));
  check("safe summary reports renderer backend", summary.rendererBackendAvailable === true && summary.rendererBackendName === "@napi-rs/canvas");
  // It must NOT carry any content-bearing field (counts like aiImageCropsCount are fine).
  check("safe summary has no content fields", !keys.some((k) => /description|prompt|response|merchant|account|rawtext/i.test(k)));
}

// ----- positioning / copy pass (Canadian, parser-first, privacy, categories) -----
{
  const EM_DASH = "—";
  // No em dashes in the major positioning/pricing/trust copy.
  const copyStrings = [
    siteConfig.tagline,
    siteConfig.description,
    pricingHeadline,
    pricingSubheadline,
    pricingFooter,
    categoryFeatureHeadline,
    categoryFeatureSubtext,
    ...pricingPlans.flatMap((p) => [p.name, p.description, ...p.features]),
    ...generalFaqs.flatMap((f) => [f.question, f.answer]),
  ];
  check("no em dashes in positioning/pricing/trust copy", copyStrings.every((s) => !s.includes(EM_DASH)));

  // Canadian-first positioning.
  check("tagline is Canadian-focused", /canadian/i.test(siteConfig.tagline));
  check("description mentions parser-first + guided AI verification + balance checks",
    /parser-first/i.test(siteConfig.description) && /guided ai verification/i.test(siteConfig.description) && /balance check/i.test(siteConfig.description));
  check("description mentions e-Transfer", /e-?transfer/i.test(siteConfig.description));
  check("positioning is not generic 'AI PDF to CSV'", !/\bai pdf to csv\b/i.test(siteConfig.description));

  // Honest support language: no overpromising.
  const allCopy = copyStrings.join(" \n ");
  check("no '100% accurate' claim", !/100%\s*accurate/i.test(allCopy));
  check("no 'works with every' bank claim", !/works with every/i.test(allCopy));
  check("no 'AI never sees' claim", !/ai never sees|ai never comes in contact/i.test(allCopy));

  // Categories: optional, editable, Plus/Pro, separate from balance verification.
  check("category copy says optional + AI-assisted", /optional/i.test(categoryFeatureHeadline) && /ai/i.test(categoryFeatureHeadline));
  check("category copy says editable + separate from balance verification",
    /edit/i.test(categoryFeatureSubtext) && /separate from balance/i.test(categoryFeatureSubtext));
  check("only Plus/Pro list AI category suggestions", (() => {
    const byName = Object.fromEntries(pricingPlans.map((p) => [p.name, p.features.join(" ")]));
    const hasCat = (n: string) => /category|categories/i.test(byName[n] ?? "");
    return !hasCat("Free Preview") && !hasCat("Starter") && hasCat("Plus") && hasCat("Pro");
  })());

  // AI is available on every tier (not paid-only).
  check("every tier mentions guided AI verification", pricingPlans.every((p) => p.features.some((f) => /guided ai verification/i.test(f))));

  // Privacy wording: never claim AI sees nothing; do claim PDF not handed directly.
  const aiFaq = generalFaqs.find((f) => /how does ai fit/i.test(f.question));
  check("AI FAQ exists and is parser-first", Boolean(aiFaq) && /parser-first/i.test(aiFaq!.answer));
  check("AI FAQ says original PDF not handed directly to AI", Boolean(aiFaq) && /never handed directly to ai/i.test(aiFaq!.answer));
  check("AI FAQ mentions limited relevant evidence", Boolean(aiFaq) && /limited, relevant/i.test(aiFaq!.answer));
}

// ----- conversion-state copy honesty (verified vs needs-review) -----
{
  const baseInputs = { confidence: 0.95, rowCount: 50, materialWarningCount: 0, minorWarningCount: 0, summaryMatched: null, previewLimited: false, unsupported: false } as const;
  const verified = conversionPresentation({ ...baseInputs, balanceStatus: "passed" });
  check("verified export note is concise 'export is ready'", /export is ready/i.test(verified.exportNote) && !verified.exportNote.includes("—"));
  const needs = conversionPresentation({ ...baseInputs, balanceStatus: "review", materialWarningCount: 10, rowCount: 50 });
  check("needs-review still says could not fully verify", /could not fully verify/i.test(needs.bannerBody));
  check("review-recommended does not say 'could not fully verify'", (() => {
    const rr = conversionPresentation({ ...baseInputs, balanceStatus: "passed", materialWarningCount: 1, rowCount: 65 });
    return rr.state === "review-recommended" && /totals matched/i.test(rr.bannerBody) && !/could not fully verify/i.test(rr.bannerBody);
  })());
}

// ----- anti fake-reconciliation: prompt guardrails -----
{
  check("prompt forbids aggregate/placeholder rows", /aggregate, summary, or placeholder rows/i.test(SYSTEM_PROMPT));
  check("prompt names the unspecified/other-charges patterns", /unspecified purchases\/charges/i.test(SYSTEM_PROMPT) && /other charges/i.test(SYSTEM_PROMPT));
  check("prompt requires itemized rows only", /itemized rows only|actual itemized line/i.test(SYSTEM_PROMPT));
  check("prompt forbids a row equal to a summary total", /amount equals a printed summary total/i.test(SYSTEM_PROMPT));
  check("prompt instructs needs-review instead of fake reconciliation", /return needs-review issues instead of a balanced-but-fake candidate/i.test(SYSTEM_PROMPT));
}

// ----- anti fake-reconciliation: candidate quality evaluator -----
{
  // Reconciles arithmetically but uses a placeholder/aggregate plug row.
  const fake = cc(
    [
      row({ debit: 35.94, credit: null, date: "2025-01-29", description: "Interest Charge on Purchases" }),
      row({ credit: 1519.68, debit: null, date: "2025-01-05", description: "Payment" }),
      row({ debit: 22936.57, credit: null, date: "2025-01-15", description: "Unspecified purchases/charges for summary total" }),
    ],
    1605.47,
    23058.3,
    { credits: 1519.68, debits: 22972.51 },
  );
  const q = evaluateCandidateQuality(fake, { hasVisionEvidence: true });
  check("quality: placeholder candidate is rejected", q.status === "rejected");
  check("quality: flags aggregate/placeholder row", q.reasons.includes("ai-aggregate-placeholder-row"));
  check("quality: counts the placeholder row", q.placeholderRows >= 1 || q.aggregateRows >= 1);
  check("quality: largest-row share is high", q.largestRowShareOfDebits >= 0.9);
  check("arithmetic pass alone is not enough (fake reconciles but rejected)", fake.validation.status === "passed" && q.status === "rejected");

  // One huge debit row that equals the summary purchases total.
  const onePlug = cc(
    [
      row({ debit: 22972.51, credit: null, date: "2025-01-15", description: "Card purchases" }),
      row({ credit: 1519.68, debit: null, date: "2025-01-05", description: "Payment" }),
    ],
    1605.47,
    23058.3,
    { credits: 1519.68, debits: 22972.51 },
  );
  const q2 = evaluateCandidateQuality(onePlug, { hasVisionEvidence: true });
  check("quality: single summary-total debit row is rejected", q2.status === "rejected" && (q2.reasons.includes("ai-summary-row-as-transaction") || q2.reasons.includes("ai-fake-reconciliation-risk")));

  // High missing-date rate is recorded.
  const noDates = cc(
    [
      row({ debit: 10, credit: null, date: "", description: "Store A" }),
      row({ debit: 20, credit: null, date: "", description: "Store B" }),
      row({ debit: 30, credit: null, date: "2025-01-03", description: "Store C" }),
    ],
    0,
    60,
    { credits: 0, debits: 60 },
  );
  const q3 = evaluateCandidateQuality(noDates, { hasVisionEvidence: true });
  check("quality: high missing-date rate is recorded", q3.missingDateRate >= 0.5 && q3.reasons.includes("ai-high-missing-date-rate"));

  // A genuinely itemized candidate passes quality.
  const itemized = cc(
    [
      row({ debit: 65.96, credit: null, date: "2025-01-10", description: "Magnacharge Battery" }),
      row({ debit: 120.0, credit: null, date: "2025-01-11", description: "Grocery Store" }),
      row({ debit: 22786.55, credit: null, date: "2025-01-12", description: "Equipment Supplier" }),
      row({ debit: 35.94, credit: null, date: "2025-01-29", description: "Interest Charge on Purchases" }),
      row({ credit: 1519.68, debit: null, date: "2025-01-05", description: "Payment" }),
    ],
    1605.47,
    23058.3,
    { credits: 1519.68, debits: 22972.51 },
  );
  const q4 = evaluateCandidateQuality(itemized, { hasVisionEvidence: true });
  check("quality: itemized candidate passes", q4.status === "ok" && q4.aggregateRows === 0 && q4.placeholderRows === 0);
}

// ----- anti fake-reconciliation: adoption is blocked + diagnostics safe -----
{
  const broken = cc([row({ description: "warn", debit: null, credit: null })], 23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  let calls = 0;
  const r = await runAiAssist(broken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    images: [img("table-body-p3-middle")],
    evidence: { detectedBalances: [1605.47, 23058.3] },
    call: async () => {
      calls += 1;
      return { ok: true, content: JSON.stringify({ candidate: { statementKind: "credit-card", openingBalance: 1605.47, closingBalance: 23058.3, summaryTotals: { totalCredits: 1519.68, totalDebits: 22972.51 }, transactions: [
        { transactionDate: "2025-01-29", description: "Interest Charge on Purchases", debit: 35.94, amount: -35.94 },
        { transactionDate: "2025-01-05", description: "Payment", credit: 1519.68, amount: 1519.68 },
        { transactionDate: "2025-01-15", description: "Unspecified purchases/charges for summary total", debit: 22936.57, amount: -22936.57 },
      ] } }), errorLabel: null };
    },
  });
  check("fake candidate is NOT adopted", r.outcome.adoptedCandidateSource === "parser" && r.outcome.improved === false);
  check("fake candidate flagged rejected-for-quality", r.outcome.aiCandidateRejectedForQuality === true);
  check("fake candidate rejection reason is safe label", /^ai-(aggregate|summary|fake|too)/.test(r.outcome.aiRejectedReason ?? ""));
  check("still exactly one AI call (no extra calls)", calls === 1 && r.outcome.aiCallCount === 1);
  check("quality diagnostics recorded", r.outcome.aiAggregateRowsDetected + r.outcome.aiPlaceholderRowsDetected >= 1 && r.outcome.aiItemizedRowCount !== null);
  const serialized = JSON.stringify(r.outcome);
  check("quality diagnostics contain no private content", !/unspecified purchases|payment|interest charge|base64|merchant/i.test(serialized));

  // A valid itemized candidate is still adopted (no over-rejection).
  const good = await runAiAssist(broken, ON, {}, {
    env: {} as NodeJS.ProcessEnv,
    images: [img("table-body-p3-middle")],
    evidence: { detectedBalances: [1605.47, 23058.3] },
    call: reply({ candidate: { statementKind: "credit-card", openingBalance: 1605.47, closingBalance: 23058.3, summaryTotals: { totalCredits: 1519.68, totalDebits: 22972.51 }, transactions: [
      { transactionDate: "2025-01-10", description: "Equipment Supplier", debit: 21416.89, amount: -21416.89 },
      { transactionDate: "2025-01-11", description: "Magnacharge Battery", debit: 1519.68, amount: -1519.68 },
      { transactionDate: "2025-01-12", description: "Office Supplies", debit: 35.94, amount: -35.94 },
      { transactionDate: "2025-01-29", description: "Interest Charge on Purchases", debit: 0, amount: 0 },
      { transactionDate: "2025-01-05", description: "Payment", credit: 1519.68, amount: 1519.68 },
    ] } }),
  });
  check("valid itemized candidate still adopted", good.outcome.adoptedCandidateSource === "ai-candidate" && good.outcome.aiCandidateRejectedForQuality === false);
}

// ----- needs-review wording when balance math matched but rows are bad -----
{
  const base = { confidence: 0.73, rowCount: 3, materialWarningCount: 2, minorWarningCount: 1, summaryMatched: null, previewLimited: false, unsupported: false } as const;
  const mathOkRowsBad = conversionPresentation({ ...base, balanceStatus: "passed" });
  check("needs-review distinguishes math vs rows", mathOkRowsBad.state === "needs-review" && /balance math matches/i.test(mathOkRowsBad.bannerBody) && /incomplete or low-confidence/i.test(mathOkRowsBad.bannerBody));
  check("needs-review (math ok) is not verified and not safe export", mathOkRowsBad.badgeTone !== "green" && mathOkRowsBad.exportTone !== "safe");
}

// ----- Blinders packet (focused, safe evidence) -----
{
  const blinders = buildBlindersPacket({
    statementKind: "credit-card",
    balanceMode: "credit-card",
    openingAnchor: 1605.47,
    closingAnchor: 23058.3,
    totalCreditsTarget: 1519.68,
    totalDebitsTarget: 22972.51,
    period: { start: "2024-12-30", end: "2025-01-29" },
    parserFailureReasons: ["validation-not-passed"],
    transactionTablePages: [3, 4],
    summaryPages: [1, 5],
    tableHeaderPages: [3, 4],
    visionEvidenceOrder: [
      { id: "table-header-p3-upper", kind: "table-header", page: 3 },
      { id: "table-body-p3-lower", kind: "table-body", page: 3 },
    ],
  });
  check("blinders carries opening/closing anchors", blinders.openingAnchor === 1605.47 && blinders.closingAnchor === 23058.3);
  check("blinders carries credit/debit targets", blinders.totalCreditsTarget === 1519.68 && blinders.totalDebitsTarget === 22972.51);
  check("blinders lists transaction table pages", blinders.transactionTablePages.join(",") === "3,4");
  check("blinders allows transactions + current-period fees/interest", blinders.allowedRegions.includes("transactions") && blinders.allowedRegions.some((r) => /fee|interest/i.test(r)));
  check("blinders excludes summary/totals/legal/rewards/ytd", ["summary", "totals", "legal", "rewards", "year-to-date"].every((r) => blinders.excludedRegions.includes(r)));
  check("blinders evidence order is transaction-table-first", blinders.visionEvidenceOrder[0].kind.startsWith("table"));
  check("blinders requires itemized rows + anchors-for-validation-only", blinders.validationRequirements.some((v) => /itemized/i.test(v)) && blinders.validationRequirements.some((v) => /validate/i.test(v)));
  // No private content (only numbers, safe labels, region ids).
  check("blinders contains no private text", !/\bunspecified\b|merchant|account number|payment to|\$/i.test(JSON.stringify(blinders)));

  // Blinders flow into the evidence packet.
  const broken = cc([row({ description: "warn", debit: null, credit: null })], 23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  const ev = buildAiEvidence(broken, { blinders });
  check("evidence carries the blinders packet", ev.blinders !== null && ev.blinders!.transactionTablePages.join(",") === "3,4");
  check("evidence blinders supplies summary totals as anchors (text, not rows)", ev.blinders!.totalDebitsTarget === 22972.51 && ev.blinders!.totalCreditsTarget === 1519.68);
}

// ----- prompt: completeness + no short reconciled summary -----
{
  check("prompt asks for EVERY itemized row", /return EVERY itemized transaction/i.test(SYSTEM_PROMPT));
  check("prompt says dozens of rows produce dozens of rows", /dozens of rows/i.test(SYSTEM_PROMPT));
  check("prompt forbids stopping after one or two rows", /do not stop after one or two rows/i.test(SYSTEM_PROMPT));
  check("prompt prefers long itemized over short summary candidate", /long, fully itemized candidate is ALWAYS preferred/i.test(SYSTEM_PROMPT));
  check("prompt uses anchors for validation only", /use evidence\.blinders.*only to check/i.test(SYSTEM_PROMPT));
}

// ----- bad parser one-row fallback is not presented as a useful conversion -----
{
  const oneBadRow = conversionPresentation({
    balanceStatus: "review",
    confidence: 0.4,
    rowCount: 1,
    materialWarningCount: 1,
    minorWarningCount: 0,
    summaryMatched: null,
    previewLimited: false,
    unsupported: false,
    noUsableTransactionTable: true,
  });
  check("one bad parser row → 'no usable transaction table' state", oneBadRow.state === "needs-review" && /no usable transaction table/i.test(oneBadRow.bannerTitle));
  check("no-usable-table copy says transactions appear missing", /transactions appear to be missing/i.test(oneBadRow.bannerBody));
  check("no-usable-table is not verified / not safe export", oneBadRow.badgeTone !== "green" && oneBadRow.exportTone !== "safe");
}

// ----- credit-card DD/MM date parsing (no year) -----
{
  check("DD/MM day-first: 23/01 → Jan 23", parseDayMonthDate("23/01", 2025) === "2025-01-23");
  check("DD/MM swaps when impossible day-first: 29/01 → Jan 29", parseDayMonthDate("29/01", 2025) === "2025-01-29");
  check("DD/MM with dash: 5-1 parses", parseDayMonthDate("5-1", 2025) === "2025-05-01");
  check("DD/MM without year returns MM-DD", parseDayMonthDate("23/01") === "01-23");
  check("DD/MM rejects out-of-range", parseDayMonthDate("45/99", 2025) === null);
  check("DD/MM rejects non-date", parseDayMonthDate("hello", 2025) === null);
}

// ----- credit-card opening/closing guardrail (no same-balance false pass) -----
{
  // Detected opening wrongly equals New Balance (horizontal-summary mislabel):
  // derive Previous Balance from authoritative totals = new - debits + credits.
  const r = resolveCreditCardOpenClose(23058.3, 23058.3, { credits: 1519.68, debits: 22972.51 });
  check("CC open/close derives previous balance when opening == closing", Math.abs((r.opening ?? 0) - 1605.47) < 0.01 && r.closing === 23058.3);
  // Missing opening → derive it.
  const r2 = resolveCreditCardOpenClose(null, 23058.3, { credits: 1519.68, debits: 22972.51 });
  check("CC open/close derives previous balance when opening missing", Math.abs((r2.opening ?? 0) - 1605.47) < 0.01);
  // Distinct opening/closing are left untouched.
  const r3 = resolveCreditCardOpenClose(1605.47, 23058.3, { credits: 1519.68, debits: 22972.51 });
  check("CC open/close leaves a distinct opening untouched", r3.opening === 1605.47 && r3.closing === 23058.3);
  // No totals to derive from → resolver leaves the detected values as-is; a
  // same-balance near-empty candidate is downgraded by candidate scoring instead.
  const r4 = resolveCreditCardOpenClose(23058.3, 23058.3, { credits: null, debits: null });
  check("CC open/close does not fabricate when no totals", r4.opening === 23058.3 && r4.closing === 23058.3);
}

// ----- verified parser result skips AI even with a few missing-date rows -----
{
  const many: TransactionRow[] = [];
  for (let i = 0; i < 80; i += 1) many.push(row({ debit: 100, credit: null, date: "2025-01-02", description: `Purchase ${i}` }));
  many.push(row({ debit: 35.94, credit: null, date: "", description: "Interest Charge on Purchases" })); // 1 missing date
  many.push(row({ credit: 1519.68, debit: null, date: "2025-01-05", description: "Payment" }));
  // opening + debits - credits = closing: 1605.47 + 8035.94 - 1519.68 = 8121.73
  const reconciled = cc(many, 1605.47, 8121.73, { credits: 1519.68, debits: 8035.94 });
  check("reconciled itemized CC parse verifies", reconciled.validation.status === "passed");
  check("verified parse with 1 missing-date row still skips AI", isAiAssistEligible(reconciled) === false);
}

// ----- statement date context + DD/MM year inference -----
{
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  // Numeric DD/MM/YYYY period that crosses a year boundary.
  const ctx = detectStatementDateContext("Statement Period 30/12/2024 - 29/01/2025");
  check("numeric period detected", ctx !== null);
  check("period infers day-first (30 > 12)", ctx!.dayFirst === true);
  check("period years parsed (2024 → 2025)", ctx!.startYear === 2024 && ctx!.endYear === 2025 && ctx!.crossesYear === true);
  check("period months parsed (Dec → Jan)", ctx!.startMonth === 12 && ctx!.endMonth === 1);

  // DD/MM rows resolve to the correct full ISO date with the right year.
  check("29/01 → 2025-01-29 (day-first, end year)", resolveDayMonthDate("29/01", ctx, true) === "2025-01-29");
  check("02/01 → 2025-01-02 (Jan 2, NOT Feb 1)", resolveDayMonthDate("02/01", ctx, true) === "2025-01-02");
  check("10/01 → 2025-01-10", resolveDayMonthDate("10/01", ctx, true) === "2025-01-10");
  check("30/12 → 2024-12-30 (year boundary picks start year)", resolveDayMonthDate("30/12", ctx, true) === "2024-12-30");
  check("all resolved dates are valid ISO", [resolveDayMonthDate("29/01", ctx, true), resolveDayMonthDate("02/01", ctx, true), resolveDayMonthDate("30/12", ctx, true)].every((d) => d !== null && ISO.test(d)));

  // Impossible dates are rejected (null), never malformed.
  check("impossible day/month rejected", resolveDayMonthDate("45/99", ctx, true) === null);
  check("non day/month token rejected", resolveDayMonthDate("Interest", ctx, true) === null);

  // No malformed partial dates like YYYY-MM-D.
  const bad = /^\d{4}-\d{1}-|^\d{4}-\d{2}-\d{1}$|-\d$/;
  check("no malformed single-digit components", !bad.test(resolveDayMonthDate("02/01", ctx, true) ?? ""));

  // Month-name period (single trailing year), and a year-crossing month-name period.
  const named = detectStatementDateContext("January 10 to February 9, 2026");
  check("month-name period parsed", named !== null && named.startYear === 2026 && named.endYear === 2026 && named.crossesYear === false);
  const crossNamed = detectStatementDateContext("December 15 to January 14, 2026");
  check("year-crossing month-name period picks prior start year", crossNamed !== null && crossNamed.startYear === 2025 && crossNamed.endYear === 2026 && crossNamed.crossesYear === true);

  // Fallback year applies when no full period context is available.
  check("fallback year used without context", resolveDayMonthDate("23/01", null, true, 2025) === "2025-01-23");

  // parseDayMonthDate (legacy MM/DD default) still works for callers without order.
  check("legacy parseDayMonthDate pads + applies year", parseDayMonthDate("3/5", 2025) === "2025-03-05");
}

// ----- default export columns (no Category / Confidence) -----
{
  check("core headers are Date..Balance, no Category", CORE_CSV_HEADERS.join(",") === "Date,Description,Debit,Credit,Amount,Balance");
  check("full headers add Category (for opt-in)", CSV_HEADERS.includes("Category") && CSV_HEADERS[CSV_HEADERS.length - 1] === "Category");

  const exportRows = [
    row({ date: "2025-01-02", description: "Grocery Store", debit: 1050.77, credit: null, balance: 37877.88 }),
    row({ date: "2025-01-05", description: "Payment", debit: null, credit: 5116.81, balance: 302242.5 }),
  ];
  const csv = rowsToCsv(exportRows);
  const header = csv.split("\r\n")[0];
  check("default CSV header excludes Category", header === "Date,Description,Debit,Credit,Amount,Balance");
  check("default CSV excludes Confidence", !/confidence/i.test(csv));
  check("default CSV keeps full YYYY-MM-DD dates", csv.includes("2025-01-02") && csv.includes("2025-01-05"));
  check("default CSV money is 2-decimal, not clipped", csv.includes("1050.77") && csv.includes("5116.81") && csv.includes("302242.50"));
  check("default CSV blank for empty debit/credit (not 0)", csv.split("\r\n")[1].split(",")[3] === "");

  // Opt-in keeps category support for future Plus/Pro.
  const withCat = rowsToCsv([row({ date: "2025-01-02", description: "X", debit: 5, credit: null, category: "Groceries" })], { includeCategory: true });
  check("opt-in CSV includes Category column + value", withCat.split("\r\n")[0].endsWith(",Category") && /Groceries/.test(withCat));
}

// ----- review table: no public confidence; date/money widths not truncating -----
{
  const tableSrc = readFileSync("src/components/upload/TransactionPreviewTable.tsx", "utf8");
  check("table does not render a Confidence column", !/Conf\./.test(tableSrc) && !/row\.confidence/.test(tableSrc));
  check("table date column placeholder supports full YYYY-MM-DD", /YYYY-MM-DD/.test(tableSrc));
  check("table date column has a stable width >= 100px", /w-\[10[0-9]px\]|w-\[1[1-9][0-9]px\]/.test(tableSrc));
  check("table does not show category by default (prop default false)", /showCategory = false/.test(tableSrc));
  // Balance is hidden from the visible table by default (width relief); it stays in
  // the data model + exports. Gated behind showBalance, default false.
  check("table hides Balance column by default (showBalance default false)", /showBalance = false/.test(tableSrc) && /showBalance \? \(/.test(tableSrc));
  // Compact scale: cells and the table body render at text-xs (not the larger text-sm).
  const cellInputDecl = tableSrc.match(/const cellInput =\s*"[^"]*"/)?.[0] ?? "";
  check(
    "table body uses compact text-xs (not text-sm)",
    /table-fixed border-collapse text-xs/.test(tableSrc) &&
      /text-xs/.test(cellInputDecl) &&
      !/text-sm/.test(cellInputDecl),
  );

  // Description is the only flexible (width-less) column; every numeric column has
  // a fixed width so money/date never get squeezed below their content.
  const colMatches = tableSrc.match(/<col[^>]*\/>/g) ?? [];
  const widthlessCols = colMatches.filter((c) => !/w-/.test(c));
  check("description is the single flexible column", widthlessCols.length === 1);
  check("money/date columns use fixed widths (no truncate classes on cells)", !/\btruncate\b/.test(tableSrc) && !/overflow-hidden/.test(tableSrc));

  // Excel export columns exclude Category by default (source-level guard).
  const exportSrc = readFileSync("src/components/upload/TransactionExportButtons.tsx", "utf8");
  check("Excel export gates Category behind includeCategory", /includeCategory\s*\?/.test(exportSrc) && /header: "Category"/.test(exportSrc));
  check("Excel export never includes a Confidence column", !/header: "Confidence"/i.test(exportSrc));
}

// ----- review layout: balance panel stays beside the table on desktop -----
{
  const flowSrc = readFileSync("src/components/upload/UploadFlow.tsx", "utf8");
  check("table + balance use a desktop side-by-side row (lg:flex-row)", /lg:flex-row/.test(flowSrc));
  check("balance panel is a compact fixed-width sidebar on desktop", /lg:w-\[2[0-9][0-9]px\]/.test(flowSrc));
  // Compact scale: review banners use the dense UploadWarning variant.
  check("review result banners use the dense UploadWarning variant", (flowSrc.match(/dense/g) ?? []).length >= 2);
  const warnSrc = readFileSync("src/components/upload/UploadWarning.tsx", "utf8");
  check("UploadWarning supports a dense (compact) variant", /dense\?: boolean/.test(warnSrc) && /dense \? "gap-2 rounded-lg p-3"/.test(warnSrc));
  check("table region can shrink safely (min-w-0 flex-1)", /min-w-0 flex-1/.test(flowSrc));
  check("review wrapper uses tight vertical spacing (space-y-2)", /space-y-2(?![.\d])/.test(flowSrc));

  const pageSrc = readFileSync("src/app/upload/page.tsx", "utf8");
  check("conversion page uses the wide review container", /size="review"/.test(pageSrc));
  check("conversion page uses tight review padding (py-4)", /py-4/.test(pageSrc));

  // The review container is a narrow, centered workspace (~1200px), not a near
  // full-width 1600px stretch. Guard the max-width token in the Tailwind config.
  const twSrc = readFileSync("tailwind.config.ts", "utf8");
  const reviewWidth = twSrc.match(/review:\s*"([\d.]+)rem"/)?.[1];
  check(
    "review container max-width is a focused ~1120-1240px (70-77.5rem)",
    reviewWidth !== undefined && Number(reviewWidth) >= 70 && Number(reviewWidth) <= 77.5,
  );
}

// ----- credit-card summary/balance label families (generalized, not bank-specific) -----
{
  // "Total charges" + "Total credits" must both resolve (charges == debits family).
  const s1 = detectCreditCardSummary(["Total charges $3,249.03", "Total credits $2,126.98"]);
  check("CC summary: 'Total charges' detected as debits", s1.debits === 3249.03, String(s1.debits));
  check("CC summary: 'Total credits' detected as credits", s1.credits === 2126.98, String(s1.credits));

  // "Payments / Total credits" + "Purchases / Total charges" wording.
  const s2 = detectCreditCardSummary(["Payments / Credits 2,126.98", "Purchases / Debits 3,249.03"]);
  check("CC summary: 'Payments / Credits' detected", s2.credits === 2126.98, String(s2.credits));
  check("CC summary: 'Purchases / Debits' detected", s2.debits === 3249.03, String(s2.debits));

  // A "Minimum payment" line must NOT be mistaken for the payments/credits total.
  const s3 = detectCreditCardSummary(["Minimum payment $35.00", "Total payments $2,126.98"]);
  check("CC summary: minimum payment is not the credits total", s3.credits === 2126.98, String(s3.credits));

  // Balance label families: previous/new and statement-balance / amount-due variants.
  const b1 = detectCreditCardBalances(["Previous balance 82.68", "New balance 1,204.73"]);
  check("CC balances: previous/new", b1.opening === 82.68 && b1.closing === 1204.73, `${b1.opening}/${b1.closing}`);
  const b2 = detectCreditCardBalances(["Balance from previous statement $82.68", "Total amount due $1,204.73"]);
  check("CC balances: 'balance from previous statement' + 'total amount due'", b2.opening === 82.68 && b2.closing === 1204.73, `${b2.opening}/${b2.closing}`);
  const b3 = detectCreditCardBalances(["Previous balance 82.68", "Minimum payment 35.00", "Statement balance 1,204.73"]);
  check("CC balances: minimum payment not used as closing", b3.closing === 1204.73, String(b3.closing));
}

// ----- consistency: reconciled itemized parse stays passed; no stale mismatch issue -----
{
  // 3 itemized rows reconcile EXACTLY (82.68 + 3249.03 − 2126.98 = 1204.73), but the
  // DETECTED summary debit is mis-read (2000). Previously this gross-mismatched to
  // needs-review with a "transactions appear missing" issue. It must now stay passed.
  const rows = [
    row({ description: "GROCERY STORE", debit: 1000 }),
    row({ description: "DINER 88", debit: 2249.03 }),
    row({ description: "PAYMENT THANK YOU", credit: 2126.98 }),
  ];
  const s = cc(rows, 82.68, 1204.73, { credits: 2126.98, debits: 2000 });
  check("reconciled itemized CC stays passed despite mis-detected summary debit", s.validation.status === "passed", s.validation.status);
  check(
    "reconciled itemized CC does not inherit a stale 'transactions missing' issue",
    !s.validation.issues.some((i) => /appear to be missing/i.test(i)),
    s.validation.issues.join(" | "),
  );
  check("reconciled itemized CC keeps high confidence", s.validation.confidence >= 0.7, String(s.validation.confidence));
  // Final user-facing balance status agrees with the selected reconciled candidate.
  const chk = computeBalanceCheck(82.68, 1204.73, rows, "credit-card");
  check("conversion balance status agrees (passed)", resolveBalanceStatus(chk, s.validation.status) === "passed");
  // Parser-verified → AI is skipped entirely.
  const elig = evaluateAiEligibility(s);
  check("reconciled itemized CC is parser-verified (AI skipped)", elig.eligible === false && elig.skippedReason === "parser-verified");

  // NEGATIVE control: a near-zero / lone-row parse with meaningful summary is STILL
  // hard-downgraded (the false-pass guard must remain strict).
  const falsePass = cc([row({ description: "ON YOUR LAST STATEMENT", debit: null, credit: null })], 1204.73, 1204.73, { credits: 2126.98, debits: 3249.03 });
  check("near-zero lone-row parse still needs-review", falsePass.validation.status === "needs-review", falsePass.validation.status);

  // NEGATIVE control: a candidate that reconciles via an AGGREGATE 'Total purchases'
  // plug (not itemized) must NOT be rescued — row quality keeps it needs-review.
  const aggregate = cc(
    [row({ description: "PAYMENT THANK YOU", credit: 2126.98 }), row({ description: "Total purchases", debit: 3249.03 })],
    82.68,
    1204.73,
    { credits: 2126.98, debits: 2000 },
  );
  check("aggregate-row reconciliation is not verified (row quality)", aggregate.validation.status === "needs-review", aggregate.validation.status);
}

// ----- statement-provided category / metadata handling -----
{
  // Structural-first: ai-assist + validation share the aggregate/placeholder test.
  check("shared aggregate detector flags 'Total purchases'", isAggregateOrPlaceholderDescription("Total purchases") === true);
  check("shared aggregate detector ignores a real merchant", isAggregateOrPlaceholderDescription("GROCERY STORE #221") === false);

  // String-strip fallback: a DISTINCTIVE trailing spend-category phrase is removed
  // from a polluted description and preserved as the category.
  const a = splitTrailingSpendCategory("GROCERY STORE #221 Retail and Grocery");
  check("category split: distinctive trailing phrase stripped", a.description === "GROCERY STORE #221" && a.category === "Retail and Grocery", `${a.description} | ${a.category}`);
  const b = splitTrailingSpendCategory("SHELL 4421 Personal and Household Expenses");
  check("category split: another distinctive family stripped", b.description === "SHELL 4421" && b.category === "Personal and Household Expenses");

  // Conservative: a real merchant name is never reduced, and an ambiguous SINGLE
  // word (handled only via a structural column) is NOT string-stripped.
  const c = splitTrailingSpendCategory("BED BATH AND BEYOND");
  check("category split: real merchant preserved (no false strip)", c.description === "BED BATH AND BEYOND" && c.category === "");
  const d = splitTrailingSpendCategory("CITY TRANSIT Restaurants");
  check("category split: ambiguous single word not string-stripped", d.description === "CITY TRANSIT Restaurants" && d.category === "");
  const e = splitTrailingSpendCategory("Retail and Grocery");
  check("category split: category-only description left intact", e.description === "Retail and Grocery" && e.category === "");

  // Category is never in the default CSV/Excel export, even when rows carry one.
  const withCat = [row({ description: "GROCERY STORE", debit: 50, category: "Retail and Grocery" })];
  const defaultCsv = rowsToCsv(withCat);
  check("default CSV excludes Category even when rows have a category", !/Category/.test(defaultCsv.split("\r\n")[0]) && !/Retail and Grocery/.test(defaultCsv));
  const optInCsv = rowsToCsv(withCat, { includeCategory: true });
  check("opt-in CSV includes Category when explicitly enabled", /Category/.test(optInCsv.split("\r\n")[0]) && /Retail and Grocery/.test(optInCsv));
}

// ----- text-path metadata cleanup chokepoint (credit-card, structure-imperfect) -----
{
  // Credit-card rows whose Description still carries a trailing statement-provided
  // category (the text-parser path can't separate columns) are cleaned at model
  // build time and the category is preserved internally. City/province stays put.
  const s = cc(
    [
      row({ description: "GOOGLE *Google One HALIFAX NS Professional and Financial Services", debit: 9.99 }),
      row({ description: "WAL-MART #1176 DARTMOUTH NS Retail and Grocery", debit: 50.01 }),
      row({ description: "PAYMENT THANK YOU", credit: 60 }),
    ],
    100,
    100,
  );
  const t0 = s.transactions[0];
  const t1 = s.transactions[1];
  check("text-path: trailing category stripped from description", t0.description === "GOOGLE *Google One HALIFAX NS", t0.description);
  check("text-path: city/province retained in description", /HALIFAX NS/.test(t0.description) && /DARTMOUTH NS/.test(t1.description));
  check("text-path: category preserved internally", t0.category === "Professional and Financial Services", t0.category ?? "");
  check("text-path: second row cleaned + category kept", t1.description === "WAL-MART #1176 DARTMOUTH NS" && t1.category === "Retail and Grocery", `${t1.description} | ${t1.category}`);
  check("text-path: merchant-only row untouched", s.transactions[2].description === "PAYMENT THANK YOU");

  // Default CSV/Excel must NOT carry the captured category (no regression).
  const csvRows = parsedStatementToRows(s);
  const csv = rowsToCsv(csvRows);
  check("default CSV header excludes Category (metadata preserved internally only)", csv.split("\r\n")[0] === "Date,Description,Debit,Credit,Amount,Balance");
  check("default CSV body excludes the captured category text", !/Professional and Financial Services|Retail and Grocery/.test(csv));
  check("opt-in CSV includes the captured category", /Retail and Grocery/.test(rowsToCsv(csvRows, { includeCategory: true })));

  // A bank-account statement is NOT subjected to spend-category stripping (spend
  // categories are a credit-card construct): a merchant name that happens to END in
  // a category-like phrase is left fully intact.
  const b = bank([row({ description: "ACME PERSONAL AND HOUSEHOLD EXPENSES", credit: 100, balance: 200 })], 100, 200);
  check("bank-account descriptions are not category-stripped", b.transactions[0].description === "ACME PERSONAL AND HOUSEHOLD EXPENSES" && (b.transactions[0].category ?? "") === "");
}

// ----- structure-gated stripping of AMBIGUOUS spend-category labels -----
{
  // With structural confirmation (allowAmbiguous), short ambiguous category labels
  // are stripped and the merchant + city/province text is preserved.
  const a = splitTrailingSpendCategory("RANDYS PIZZA - COLE HA DARTMOUTH NS Restaurants", { allowAmbiguous: true });
  check("ambiguous strip (structure): 'Restaurants' removed, city/province kept", a.description === "RANDYS PIZZA - COLE HA DARTMOUTH NS" && a.category === "Restaurants", `${a.description} | ${a.category}`);
  const b = splitTrailingSpendCategory("CALDWELL CONVENIENCE DARTMOUTH NS Transportation", { allowAmbiguous: true });
  check("ambiguous strip (structure): 'Transportation' removed", b.description === "CALDWELL CONVENIENCE DARTMOUTH NS" && b.category === "Transportation");

  // WITHOUT structural confirmation the same ambiguous words are NEVER stripped.
  const c = splitTrailingSpendCategory("RANDYS PIZZA - COLE HA DARTMOUTH NS Restaurants");
  check("ambiguous NOT stripped without structure context", c.description === "RANDYS PIZZA - COLE HA DARTMOUTH NS Restaurants" && c.category === "");
  const d = splitTrailingSpendCategory("CIRCLE K / IRVING # 25 DARTMOUTH NS Transportation");
  check("ambiguous NOT stripped without structure (2nd)", d.description === "CIRCLE K / IRVING # 25 DARTMOUTH NS Transportation" && d.category === "");

  // Short-merchant guard: an ambiguous word with only a one-token head is NOT clipped
  // even with structure (avoids turning "JOEY Restaurants" into "JOEY").
  const e = splitTrailingSpendCategory("JOEY Restaurants", { allowAmbiguous: true });
  check("ambiguous strip guarded: single-token head not clipped", e.description === "JOEY Restaurants" && e.category === "");

  // Province codes are never treated as category labels.
  const f = splitTrailingSpendCategory("SOME MERCHANT EDMONTON AB", { allowAmbiguous: true });
  check("province code not stripped as category", f.description === "SOME MERCHANT EDMONTON AB" && f.category === "");

  // Distinctive multi-word phrases still strip with or without structure context.
  const g = splitTrailingSpendCategory("WAL-MART #1176 DARTMOUTH NS Retail and Grocery");
  check("distinctive phrase strips without needing structure", g.description === "WAL-MART #1176 DARTMOUTH NS" && g.category === "Retail and Grocery");

  // Text-path model build: a credit-card statement with NO detected category column
  // (no parseStats) must NOT strip ambiguous labels — structure isn't confirmed.
  const noCtx = cc([row({ description: "RANDYS PIZZA DARTMOUTH NS Restaurants", debit: 45 })], 0, 45);
  check("model build: ambiguous kept when no category column detected", noCtx.transactions[0].description === "RANDYS PIZZA DARTMOUTH NS Restaurants");
}

// ----- category-column CONTEXT survives to the final model path (text/sectioned) -----
{
  // detectCategoryColumnContext: header-level signal (statement-level, path-agnostic).
  check("category header context: 'Spend Categories' header detected", detectCategoryColumnContext(["Trans Date Post Date Description Spend Categories Amount"]) === true);
  check("category header context: bare 'Category' header with other columns", detectCategoryColumnContext(["Date Description Category Amount"]) === true);
  check("category header context: prose 'category' is not a column", detectCategoryColumnContext(["Spending in each category is summarized below"]) === false);
  check("category header context: no category column", detectCategoryColumnContext(["Date Description Amount"]) === false);

  // SELF-CONTAINED structural evidence at model build: when >= 2 descriptions carry
  // DISTINCTIVE category phrases, a category column is inferred and ambiguous labels
  // ("Restaurants", "Transportation") are ALSO stripped — even with no parseStats
  // flag and no coordinate column order (the text/sectioned-CC winning path).
  const withCtx = cc(
    [
      row({ description: "WAL-MART #1176 DARTMOUTH NS Retail and Grocery", debit: 50 }),
      row({ description: "GOOGLE *Google One HALIFAX NS Professional and Financial Services", debit: 10 }),
      row({ description: "RANDYS PIZZA - COLE HA DARTMOUTH NS Restaurants", debit: 20 }),
      row({ description: "CIRCLE K / IRVING # 25 DARTMOUTH NS Transportation", debit: 5 }),
      row({ description: "PAYMENT THANK YOU", credit: 85 }),
    ],
    0,
    0,
  );
  const byDesc = (frag: string) => withCtx.transactions.find((t) => t.description.includes(frag));
  check("context inferred from distinctive endings → ambiguous 'Restaurants' stripped", withCtx.transactions.some((t) => t.description === "RANDYS PIZZA - COLE HA DARTMOUTH NS" && t.category === "Restaurants"));
  check("context inferred → ambiguous 'Transportation' stripped", withCtx.transactions.some((t) => t.description === "CIRCLE K / IRVING # 25 DARTMOUTH NS" && t.category === "Transportation"));
  check("distinctive phrase still stripped + captured", Boolean(byDesc("WAL-MART") && byDesc("WAL-MART")!.description === "WAL-MART #1176 DARTMOUTH NS" && byDesc("WAL-MART")!.category === "Retail and Grocery"));
  check("city/province retained after ambiguous strip", withCtx.transactions.every((t) => !/Restaurants|Transportation/.test(t.description)) && withCtx.transactions.some((t) => /DARTMOUTH NS/.test(t.description)));
  // Default CSV still excludes the captured categories.
  const csv = rowsToCsv(parsedStatementToRows(withCtx));
  check("default CSV excludes captured categories (context path)", csv.split("\r\n")[0] === "Date,Description,Debit,Credit,Amount,Balance" && !/Restaurants|Transportation|Retail and Grocery/.test(csv));

  // NEGATIVE: the same ambiguous descriptions WITHOUT category-column context are
  // left intact (only 2 ambiguous rows, no distinctive evidence, no flag).
  const noCtx = cc(
    [
      row({ description: "RANDYS PIZZA - COLE HA DARTMOUTH NS Restaurants", debit: 20 }),
      row({ description: "CIRCLE K / IRVING # 25 DARTMOUTH NS Transportation", debit: 5 }),
      row({ description: "PAYMENT THANK YOU", credit: 25 }),
    ],
    0,
    0,
  );
  check("no context → ambiguous labels NOT stripped", noCtx.transactions.some((t) => t.description === "RANDYS PIZZA - COLE HA DARTMOUTH NS Restaurants"));

  // The explicit statement-level flag also drives stripping through the model path.
  const flaggedResult = {
    statementKind: "credit-card",
    layoutFamily: "credit-card-table",
    rows: [
      { id: "x1", date: "2024-01-05", description: "RANDYS PIZZA DARTMOUTH NS Restaurants", debit: 20, credit: null, balance: null, category: "", confidence: 0.95 },
    ],
    openingBalance: 0,
    closingBalance: 20,
    summary: { credits: null, debits: null },
    warnings: [],
    parseStats: { categoryColumnContextDetected: true, coordColumnOrder: null, ambiguousCategoriesStripped: 0, metadataCategoriesCaptured: 0 },
  } as unknown as ParseResult;
  const flagged = buildParsedStatement(flaggedResult);
  check("statement flag → ambiguous stripped via model path", flagged.transactions[0].description === "RANDYS PIZZA DARTMOUTH NS" && flagged.transactions[0].category === "Restaurants");
  check("diagnostic counts recorded (ambiguous stripped / captured)", (flaggedResult.parseStats!.ambiguousCategoriesStripped ?? 0) >= 1 && (flaggedResult.parseStats!.metadataCategoriesCaptured ?? 0) >= 1);
}

// ----- bank-account same-day date carry-forward -----
{
  // Within one table context, a dateless row inherits the most recent valid date;
  // a leading dateless row (no previous date) stays empty; existing dates are kept.
  const rs = [
    row({ date: "", description: "LEADING (no prior date)", debit: 1 }),
    row({ date: "2024-01-05", description: "DATED", debit: 1 }),
    row({ date: "", description: "SAME-DAY CONT 1", debit: 1 }),
    row({ date: "", description: "SAME-DAY CONT 2", debit: 1 }),
    row({ date: "2024-01-06", description: "NEXT DAY", debit: 1 }),
  ];
  const inherited = carryForwardRowDates(rs);
  check("carry-forward fills dateless continuation rows", rs[2].date === "2024-01-05" && rs[3].date === "2024-01-05");
  check("carry-forward leaves a leading dateless row empty (no prior date)", rs[0].date === "");
  check("carry-forward does not overwrite existing dates", rs[1].date === "2024-01-05" && rs[4].date === "2024-01-06");
  check("carry-forward count is accurate", inherited === 2, String(inherited));

  // End-to-end (full pipeline): a bank table continued across a page with a dateless
  // same-day row reconciles, every row ends up dated, and it verifies + skips AI.
  const ac = coordinateSamples.find((s) => s.name === "AC-bank-continued-same-day-date-carryforward")!;
  const acItems = buildSampleItems(ac);
  const acText = groupVisualLines(acItems).map((l) => l.text).join("\n");
  const acOut = parseStatement({ text: acText, items: acItems });
  check("carry-forward (pipeline): every row is dated", acOut.statement.transactions.every((t) => (t.transactionDate ?? "").trim() !== ""));
  check("carry-forward (pipeline): statement validates passed", acOut.statement.validation.status === "passed", acOut.statement.validation.status);
  check("carry-forward (pipeline): reconciling bank verifies + skips AI", evaluateAiEligibility(acOut.statement).eligible === false);
  check("carry-forward (pipeline): rowsDateInherited diagnostic recorded", (acOut.result.parseStats?.rowsDateInherited ?? 0) >= 1);
  check("carry-forward (pipeline): no rows still missing date", (acOut.result.parseStats?.rowsStillMissingDate ?? -1) === 0);
}

// ----- Canadian e-Transfer / Interac description cleanup -----
{
  // Raw reference/hash fragments are removed when readable transfer text remains.
  const a = normalizeTransferDescription("e-Transfer sent Robert G Currie Inc CA8a3f9c2d1e");
  check("transfer cleanup: hash fragment removed, type + name kept", a.description === "e-Transfer sent Robert G Currie Inc" && a.removed === true, a.description);
  const b = normalizeTransferDescription("e-Transfer - Autodeposit KEVIN G WALSH 0099887766554433");
  check("transfer cleanup: long digit reference removed, direction (Autodeposit) kept", /Autodeposit KEVIN G WALSH$/.test(b.description) && !/0099887766554433/.test(b.description) && b.removed);

  // Clean transfer descriptions are left exactly as-is (no over-stripping).
  check("transfer cleanup: clean 'Online transfer received' kept intact", normalizeTransferDescription("Online transfer received J MARK HENNEBERRY").removed === false);
  check("transfer cleanup: 'Interac e-Transfer Received' kept intact", normalizeTransferDescription("Interac e-Transfer Received").removed === false);
  check("transfer cleanup: 'e-Transfer - Autodeposit KEVIN G WALSH' (no ref) kept", normalizeTransferDescription("e-Transfer - Autodeposit KEVIN G WALSH").removed === false);

  // Names and city/province are never removed.
  const c = normalizeTransferDescription("Interac e-Transfer received JOHN SMITH HALIFAX NS");
  check("transfer cleanup: names + city/province preserved", c.description === "Interac e-Transfer received JOHN SMITH HALIFAX NS" && c.removed === false);

  // NON-transfer descriptions are never touched (merchant reference codes kept).
  check("transfer cleanup: non-transfer merchant ref untouched", normalizeTransferDescription("AMAZON MARKETPLACE AB1234567890").removed === false);

  // Through the model build: the default Description is cleaned and the default CSV
  // is unchanged (no ref fragment, still Date..Balance columns).
  const stmt = bank([row({ description: "e-Transfer sent Robert G Currie Inc CA8a3f9c2d1e", debit: 50, balance: 150 })], 200, 150);
  check("model build normalizes the transfer description", stmt.transactions[0].description === "e-Transfer sent Robert G Currie Inc");
  const csv = rowsToCsv(parsedStatementToRows(stmt));
  check("transfer cleanup: default CSV unchanged + no ref fragment", csv.split("\r\n")[0] === "Date,Description,Debit,Credit,Amount,Balance" && !/CA8a3f9c2d1e/.test(csv));
}

// ----- Goal 1: fee/formula amount handling (text bank path via full pipeline) -----
{
  const parseBank = (lines: string[]) => parseStatement({ text: lines.join("\n") }).statement;
  const debitOf = (s: ParsedStatement, frag: string) =>
    s.transactions.find((t) => t.description.includes(frag))?.debit ?? null;

  // A fee row with embedded @ rates AND a separate posted amount + balance uses the
  // POSTED amount (1.50), never a 0.75 rate, and stays a SINGLE row.
  const a = parseBank([
    "BANK", "Details of your account activity", "Opening Balance 100.00",
    "Jun 1 Electronic transaction fee 1 Dr @ 0.75 1 Cr @ 0.75 1.50 98.50",
    "Closing Balance 98.50",
  ]);
  check("fee row chooses posted amount over @ rate", a.transactions.length === 1 && Math.abs((debitOf(a, "transaction fee") ?? 0) - 1.5) < 0.01, JSON.stringify(a.transactions.map((t) => t.debit)));
  check("fee row never emits a 0.75 rate as the amount", a.transactions.every((t) => Math.abs((t.debit ?? 0) - 0.75) > 0.001));
  check("fee formula description is cleaned of the rate clause", (a.transactions[0]?.description ?? "").trim() === "Electronic transaction fee");

  // Multiple count/rate fragments with NO separate posted amount (only a running
  // balance) compute the total (Σ count×rate = 1.50) as ONE row — not per-rate rows,
  // and the embedded "Cr" never creates a credit row.
  const b = parseBank([
    "BANK", "Details of your account activity", "Opening Balance 100.00",
    "Jun 1 Electronic transaction fee 1 Dr @ 0.75 1 Cr @ 0.75 98.50",
    "Closing Balance 98.50",
  ]);
  check("multi-fragment fee is one row with the computed total", b.transactions.length === 1 && Math.abs((b.transactions[0].debit ?? 0) - 1.5) < 0.01, JSON.stringify(b.transactions.map((t) => ({ d: t.debit, c: t.credit }))));
  check("Dr/Cr in fee formula does not create a credit row", b.transactions.every((t) => (t.credit ?? 0) < 0.005) && Math.abs((b.transactions[0].debit ?? 0) - 1.5) < 0.01);
  check("fee formula row reconciles", b.validation.status === "passed");
}

// ----- Goal 2: page-bottom / balance-less row recovery -----
{
  const parseBank = (lines: string[]) => parseStatement({ text: lines.join("\n") });

  // A page-bottom cheque row with NO running balance is recovered and reconciles.
  const out = parseBank([
    "BANK", "Details of your account activity", "Opening Balance 1000.00",
    "Jun 1 Customer Deposit 500.00 1500.00",
    "Jun 2 Cheque - 5 945.47",
    "Closing Balance 554.53",
  ]);
  check("balance-less page-bottom cheque is accepted", out.statement.transactions.some((t) => t.description.includes("Cheque") && Math.abs((t.debit ?? 0) - 945.47) < 0.01));
  check("balance-less row recovery reconciles", out.statement.validation.status === "passed");
  check("rowsAcceptedWithoutRunningBalance diagnostic recorded", (out.result.parseStats?.rowsAcceptedWithoutRunningBalance ?? 0) >= 1);
  check("pageBottomRowsRecovered diagnostic recorded", (out.result.parseStats?.pageBottomRowsRecovered ?? 0) >= 1);

  // Footer/legal text after the table and dateless total rows are NOT transactions.
  const out2 = parseBank([
    "BANK", "Details of your account activity", "Opening Balance 1000.00",
    "Jun 1 Customer Deposit 500.00 1500.00",
    "Closing Balance 1500.00",
    "Important Account Information",
    "Account Fees: 50.00",
  ]);
  check("footer/legal rows after the table are not transactions", out2.statement.transactions.length === 1 && out2.statement.transactions.every((t) => Math.abs((t.debit ?? 0) - 50) > 0.001));

  const out3 = parseBank([
    "BANK", "Details of your account activity", "Opening Balance 1000.00",
    "Jun 1 Customer Deposit 500.00 1500.00",
    "Total deposits 500.00 1500.00",
    "Closing Balance 1500.00",
  ]);
  check("dateless total/summary rows are not transactions", out3.statement.transactions.length === 1);
}

// ----- Goal 3: AI adoption safety (do not adopt unreconciled AI that loses rows) -----
{
  // A reconciled candidate beats a non-reconciled parser.
  const parserNR = bank([row({ credit: 10 })], 100, 200); // 100+10≠200
  const aiPass = bank([row({ credit: 100 })], 100, 200); // reconciles
  check("reconciled AI candidate beats non-reconciled parser", candidateBeatsParser(parserNR, aiPass) === true);

  // An UNRECONCILED AI candidate with FEWER rows but a smaller difference is NOT
  // adopted (it improved arithmetic only by dropping valid rows).
  const parserMany = bank([row({ debit: 10 }), row({ debit: 10 }), row({ debit: 10 })], 100, 100); // diff 30, 3 rows
  const aiFewer = bank([row({ debit: 10 }), row({ debit: 10 })], 100, 100); // diff 20, 2 rows
  check("unreconciled AI that drops parser rows is NOT adopted", candidateBeatsParser(parserMany, aiFewer) === false);

  // An UNRECONCILED AI candidate that improves the difference WITHOUT losing rows is adopted.
  const parserOne = bank([row({ debit: 10 })], 100, 100); // diff 10, 1 row
  const aiMore = bank([row({ debit: 2 }), row({ debit: 2 })], 100, 100); // diff 4, 2 rows
  check("unreconciled AI that keeps rows + improves diff is adopted", candidateBeatsParser(parserOne, aiMore) === true);
}

console.log(failures === 0 ? `\nAll AI-assist v2 + pricing checks passed.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
