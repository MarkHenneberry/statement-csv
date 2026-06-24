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
  type AiAssistConfig,
  type ChatResult,
} from "../src/lib/ai-assist.ts";
import { detectCreditCardInterestFees } from "../src/lib/parser.ts";
import {
  buildStatementFromRows,
  type ParsedStatement,
} from "../src/lib/statement-model.ts";
import type { TransactionRow } from "../src/lib/upload.ts";
import { computeBalanceCheck, resolveBalanceStatus, getRowWarnings, deriveAmount, countRowWarningSeverity } from "../src/lib/upload.ts";
import { conversionPresentation, resolveConversionState, type ConversionInputs } from "../src/lib/conversion-state.ts";
import { evaluateAiEligibility } from "../src/lib/ai-assist.ts";
import { recoverDescriptionFromLine } from "../src/lib/parser.ts";
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
  check("crop selection targets summary + totals", regions.some((r) => r.kind === "summary") && regions.some((r) => r.kind === "totals"));
  check("low-confidence region added when present", regions.some((r) => r.kind === "low-confidence"));
  check("no low-confidence region when absent", selectVisionRegions({ pageCount: 1, hasLowConfidence: false }).every((r) => r.kind !== "low-confidence"));
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
const img = (id: string): VisionImage => ({ id, kind: "summary", page: 1, crop: true, dataUrl: "data:image/png;base64,AAAA" });
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

console.log(failures === 0 ? `\nAll AI-assist v2 + pricing checks passed.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
