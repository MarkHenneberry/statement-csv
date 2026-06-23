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
  type AiAssistConfig,
  type ChatResult,
} from "../src/lib/ai-assist.ts";
import {
  buildStatementFromRows,
  type ParsedStatement,
} from "../src/lib/statement-model.ts";
import type { TransactionRow } from "../src/lib/upload.ts";
import { selectReviewMessage } from "../src/lib/review-messages.ts";
import { pricingPlans, pricingSubheadline, pricingFooter } from "../src/lib/pricing.ts";
import { SCANNED_PDF_WARNING } from "../src/lib/parser.ts";
import {
  selectVisionRegions,
  renderVisionEvidence,
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
check("subheadline can say AI-assisted (marketing)", /ai-assisted repair/i.test(pricingSubheadline));
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

console.log(failures === 0 ? `\nAll AI-assist v2 + pricing checks passed.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
