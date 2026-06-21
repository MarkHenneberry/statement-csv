// Generic statement-profile configuration.
//
// A StatementProfile is DATA that *guides* the generic parser — section anchors,
// balance-label patterns, header synonyms, column hints, etc. Profiles are
// intentionally broad layout families, never one-off hardcoded parsers. There is
// deliberately no `if (bank === "RBC")`-style branching anywhere: detection is by
// generic layout signals, and an unmatched statement falls back to a generic
// profile safely.
//
// In this foundation pass profile detection is ADVISORY: it is recorded in safe
// diagnostics and documents the configuration surface for future tuning. It does
// not override the generic parser's own kind/layout detection or its results.
//
// PRIVACY: profiles contain only generic patterns and labels. No statement
// content, names, account numbers, or raw text are stored here.

import { detectStatementKind, type StatementKind } from "./parser.ts";

export type StatementProfile = {
  /** Stable profile name (a layout family, not a bank). */
  name: string;
  statementKind: StatementKind;
  /** Generic layout/institution matchers (config, not code branches). */
  match: RegExp[];
  /** Lines that begin the transaction table/section. */
  transactionSectionAnchors: RegExp[];
  /** Lines that end the transaction table/section. */
  transactionEndAnchors: RegExp[];
  /** Opening/closing balance label patterns. */
  balanceLabels: { opening: RegExp[]; closing: RegExp[] };
  /** Header synonyms used to map columns by meaning. */
  tableHeaderSynonyms: string[];
  /** Column hints (normalized meanings expected, left-to-right when known). */
  columnHints: string[];
  /** Wording that indicates debit vs credit direction. */
  debitCreditWording: { debit: RegExp[]; credit: RegExp[] };
  /** Summary / remittance / footer anchors that never become transactions. */
  summaryAnchors: RegExp[];
  footerAnchors: RegExp[];
};

const BANK_BALANCE_LABELS = {
  opening: [/opening balance/i, /beginning balance/i, /previous balance/i, /balance forward/i],
  closing: [/closing balance/i, /ending balance/i, /new balance/i],
};
const CC_BALANCE_LABELS = {
  opening: [/previous (?:account |statement )?balance/i],
  closing: [/new balance/i, /total account balance/i, /total balance/i],
};
const COMMON_SUMMARY = [
  /total (?:debits?|credits?|withdrawals?|deposits?|purchases?|payments?)/i,
  /amounts? (?:debited|credited)/i,
  /minimum payment/i,
  /credit limit/i,
  /available credit/i,
  /number of items/i,
  /monthly (?:aver|min)/i,
];
const COMMON_FOOTER = [
  /important (?:account )?information/i,
  /how to (?:reach|contact) us/i,
  /trade ?-?marks?/i,
  /closing notice/i,
  /payment slip|remittance|amount past due/i,
];

/**
 * The profile catalog, ordered most-specific → most-generic. Detection returns
 * the first profile whose statement kind matches AND whose `match` patterns hit;
 * otherwise the generic profile for the kind; otherwise `unknown`.
 */
export const STATEMENT_PROFILES: StatementProfile[] = [
  {
    name: "collabria-style-credit-card",
    statementKind: "credit-card",
    match: [/collabria/i, /\btransactions\b[\s\S]{0,40}\(continued\)/i, /total (?:fees|interest) for this period/i],
    transactionSectionAnchors: [/^transactions\b/i, /trans(?:\.|action)? date.*post(?:ing)? date/i],
    transactionEndAnchors: [/total (?:fees|interest) for this period/i, /information about your account/i],
    balanceLabels: CC_BALANCE_LABELS,
    tableHeaderSynonyms: ["transaction date", "posting date", "description", "amount"],
    columnHints: ["date", "postDate", "description", "amount"],
    debitCreditWording: { debit: [/purchase|interest|fee/i], credit: [/payment|credit|refund/i] },
    summaryAnchors: COMMON_SUMMARY,
    footerAnchors: COMMON_FOOTER,
  },
  {
    name: "sectioned-credit-card",
    statementKind: "credit-card",
    match: [/your payments|your interest|your new charges/i, /spend categor/i, /amount\s*\(\s*\$\s*\)/i],
    transactionSectionAnchors: [/trans(?:\.|action)? date/i, /activity description/i],
    transactionEndAnchors: [/total (?:account )?balance/i, /time to pay/i, /interest rate chart/i],
    balanceLabels: CC_BALANCE_LABELS,
    tableHeaderSynonyms: ["trans date", "post date", "description", "category", "amount"],
    columnHints: ["date", "postDate", "description", "category", "amount"],
    debitCreditWording: { debit: [/purchase|charge|interest|fee/i], credit: [/payment|credit|refund/i] },
    summaryAnchors: COMMON_SUMMARY,
    footerAnchors: COMMON_FOOTER,
  },
  {
    name: "generic-credit-card",
    statementKind: "credit-card",
    match: [/\bvisa\b|mastercard|credit card/i, /payment due date/i],
    transactionSectionAnchors: [/trans(?:\.|action)? date/i, /activity description/i],
    transactionEndAnchors: [/total (?:account )?balance/i, /time to pay/i],
    balanceLabels: CC_BALANCE_LABELS,
    tableHeaderSynonyms: ["transaction date", "posting date", "description", "amount"],
    columnHints: ["date", "postDate", "description", "amount"],
    debitCreditWording: { debit: [/purchase|charge|interest|fee/i], credit: [/payment|credit|refund/i] },
    summaryAnchors: COMMON_SUMMARY,
    footerAnchors: COMMON_FOOTER,
  },
  {
    name: "multi-account-bank-statement",
    statementKind: "bank-account",
    match: [/equity shares|surplus|\bbusiness \d+\b/i],
    transactionSectionAnchors: [/details of your account activity|account activity/i],
    transactionEndAnchors: COMMON_FOOTER,
    balanceLabels: BANK_BALANCE_LABELS,
    tableHeaderSynonyms: ["date", "description", "withdrawals", "deposits", "balance"],
    columnHints: ["date", "description", "debit", "credit", "balance"],
    debitCreditWording: { debit: [/withdrawal|payment|fee|cheque/i], credit: [/deposit|received|interest/i] },
    summaryAnchors: COMMON_SUMMARY,
    footerAnchors: COMMON_FOOTER,
  },
  {
    name: "balance-forward-bank-account",
    statementKind: "bank-account",
    match: [/balance forward/i, /cheque\s*\/?\s*debit|deposit\s*\/?\s*credit/i],
    transactionSectionAnchors: [/balance forward/i, /description.*date.*balance/i],
    transactionEndAnchors: COMMON_FOOTER,
    balanceLabels: BANK_BALANCE_LABELS,
    tableHeaderSynonyms: ["description", "cheque/debit", "deposit/credit", "date", "balance"],
    columnHints: ["description", "debit", "credit", "date", "balance"],
    debitCreditWording: { debit: [/cheque|withdrawal|payment|fee/i], credit: [/deposit|received|interest/i] },
    summaryAnchors: COMMON_SUMMARY,
    footerAnchors: COMMON_FOOTER,
  },
  {
    name: "business-bank-account",
    statementKind: "bank-account",
    match: [/business (?:account|chequing)/i, /closing totals|number of items processed/i, /transaction fee/i],
    transactionSectionAnchors: [/details of your account activity|account activity/i],
    transactionEndAnchors: [/closing totals|number of items processed/i, ...COMMON_FOOTER],
    balanceLabels: BANK_BALANCE_LABELS,
    tableHeaderSynonyms: ["date", "description", "withdrawals", "deposits", "balance"],
    columnHints: ["date", "description", "debit", "credit", "balance"],
    debitCreditWording: { debit: [/withdrawal|payment|fee|cheque/i], credit: [/deposit|received|interest/i] },
    summaryAnchors: COMMON_SUMMARY,
    footerAnchors: COMMON_FOOTER,
  },
  {
    name: "generic-bank-account",
    statementKind: "bank-account",
    match: [/opening balance|closing balance|withdrawals|deposits|account activity/i],
    transactionSectionAnchors: [/details of your account activity|account activity/i],
    transactionEndAnchors: COMMON_FOOTER,
    balanceLabels: BANK_BALANCE_LABELS,
    tableHeaderSynonyms: ["date", "description", "withdrawals", "deposits", "balance"],
    columnHints: ["date", "description", "debit", "credit", "balance"],
    debitCreditWording: { debit: [/withdrawal|payment|fee|cheque/i], credit: [/deposit|received|interest/i] },
    summaryAnchors: COMMON_SUMMARY,
    footerAnchors: COMMON_FOOTER,
  },
];

/** A safe, content-free generic profile used when nothing matches. */
const UNKNOWN_PROFILE: StatementProfile = {
  name: "unknown",
  statementKind: "unknown",
  match: [],
  transactionSectionAnchors: [],
  transactionEndAnchors: COMMON_FOOTER,
  balanceLabels: { opening: [], closing: [] },
  tableHeaderSynonyms: [],
  columnHints: [],
  debitCreditWording: { debit: [], credit: [] },
  summaryAnchors: COMMON_SUMMARY,
  footerAnchors: COMMON_FOOTER,
};

export type ProfileDetection = {
  name: string;
  profile: StatementProfile;
  statementKind: StatementKind;
  /** 0..1 advisory confidence in the profile choice. */
  confidence: number;
  /** Other profile names whose matchers also fired (for diagnostics). */
  candidates: string[];
};

/** Count how many of a profile's `match` patterns hit the text. */
function matchScore(profile: StatementProfile, text: string): number {
  return profile.match.reduce((n, re) => (re.test(text) ? n + 1 : n), 0);
}

/**
 * Detect the best-fit profile (advisory). Picks among profiles whose statement
 * kind agrees with the generic kind detector, preferring the most matcher hits;
 * falls back to the generic profile for the kind, then `unknown`.
 */
export function detectStatementProfile(text: string): ProfileDetection {
  const kind = detectStatementKind(text);
  const ofKind = STATEMENT_PROFILES.filter((p) => p.statementKind === kind);
  const pool = ofKind.length > 0 ? ofKind : STATEMENT_PROFILES;

  const scored = pool
    .map((p) => ({ p, score: matchScore(p, text) }))
    .sort((a, b) => b.score - a.score);

  const candidates = scored.filter((s) => s.score > 0).map((s) => s.p.name);
  const best = scored[0];

  if (!best || best.score === 0) {
    // Nothing specific matched: use the generic profile for the kind if any.
    const generic =
      kind === "credit-card"
        ? STATEMENT_PROFILES.find((p) => p.name === "generic-credit-card")
        : kind === "bank-account"
          ? STATEMENT_PROFILES.find((p) => p.name === "generic-bank-account")
          : undefined;
    const profile = generic ?? UNKNOWN_PROFILE;
    return {
      name: profile.name,
      profile,
      statementKind: profile.statementKind,
      confidence: kind === "unknown" ? 0.1 : 0.3,
      candidates,
    };
  }

  return {
    name: best.p.name,
    profile: best.p,
    statementKind: best.p.statementKind,
    confidence: Math.min(1, 0.5 + best.score * 0.2),
    candidates,
  };
}
