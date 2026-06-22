// Synthetic, FAKE coordinate-aware table samples for the layout-driven parser.
//
// These exercise REUSABLE table layouts (column families and orders), not banks.
// Each sample is authored as a list of visual rows; every cell is [text, x] so a
// fixture mimics real PDF text-item positions. None of this is real statement
// data — it only validates the coordinate extraction + reconciliation pipeline.
//
// Dependency-free (no runtime imports) so a plain Node script can run it.

import type { PdfTextItem } from "./coordinate-table.ts";

export type Cell = [string, number]; // [text, leftX]
export type VisualRowSpec = Cell[];

/** Build positioned PDF text items from top-to-bottom visual rows. */
export function buildItems(
  rows: VisualRowSpec[],
  opts: { page?: number; startY?: number; dy?: number } = {},
): PdfTextItem[] {
  const page = opts.page ?? 1;
  const startY = opts.startY ?? 760;
  const dy = opts.dy ?? 14;
  const items: PdfTextItem[] = [];
  rows.forEach((cells, ri) => {
    const y = startY - ri * dy;
    for (const [str, x] of cells) {
      items.push({ page, str, x, y, width: Math.max(8, str.length * 5.2), height: 9 });
    }
  });
  return items;
}

export type CoordSample = {
  name: string;
  description: string;
  rows: VisualRowSpec[];
  /** Additional pages (page 2, 3, …) for multi-page / stitching samples. */
  morePages?: VisualRowSpec[][];
  expect: {
    rows: number;
    opening: number | null;
    closing: number | null;
    totalCredits: number;
    totalDebits: number;
    balancePasses: boolean;
    columnOrder: string;
    statementKind: "credit-card" | "bank-account";
    /** Expected chosen candidate source (default "coordinate-table"). */
    source?: "coordinate-table" | "text-parser";
    /** Whether the chosen candidate stitched multiple coordinate regions. */
    stitched?: boolean;
    /** Expected number of regions combined into the chosen candidate. */
    regionsStitched?: number;
    /** Substrings that must NOT appear in any parsed row description. */
    noDescriptionIncludes?: string[];
    note?: string;
  };
};

/** Build positioned items across all pages of a sample (page 1 + morePages). */
export function buildSampleItems(sample: CoordSample): PdfTextItem[] {
  const items = buildItems(sample.rows, { page: 1 });
  (sample.morePages ?? []).forEach((page, i) => {
    items.push(...buildItems(page, { page: i + 2 }));
  });
  return items;
}

// Shared column x-positions (consistent spacing keeps boundaries unambiguous).
const X = {
  date: 50,
  postDate: 160,
  desc: 280,
  category: 430,
  debit: 470,
  credit: 560,
  amount: 560,
  balance: 660,
};

export const coordinateSamples: CoordSample[] = [
  // A. Standard bank table: Date | Description | Debit | Credit | Balance
  {
    name: "A-standard-bank-table",
    description: "Date | Description | Debit | Credit | Balance",
    rows: [
      [["Some Bank Chequing", X.date]],
      [["Opening Balance", X.date], ["2,000.00", X.balance]],
      [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
      [["2024-05-02", X.date], ["Payroll Deposit", X.desc], ["2,200.00", X.credit], ["4,200.00", X.balance]],
      [["2024-05-03", X.date], ["Grocery Mart Purchase", X.desc], ["84.20", X.debit], ["4,115.80", X.balance]],
      [["2024-05-05", X.date], ["Coffee Roasters", X.desc], ["5.75", X.debit], ["4,110.05", X.balance]],
      [["Closing Balance", X.date], ["4,110.05", X.balance]],
    ],
    expect: {
      rows: 3,
      opening: 2000,
      closing: 4110.05,
      totalCredits: 2200,
      totalDebits: 89.95,
      balancePasses: true,
      columnOrder: "date|description|debit|credit|balance",
      statementKind: "bank-account",
    },
  },

  // B. Reversed TD-style bank table: Description | Cheque/Debit | Deposit/Credit | Date | Balance
  {
    name: "B-reversed-td-bank-table",
    description: "Description | Cheque/Debit | Deposit/Credit | Date | Balance; balance forward = opening",
    rows: [
      [["TD Business Account", X.desc]],
      [["BALANCE FORWARD", X.desc], ["10,758.27", X.balance]],
      [["Description", X.desc], ["Cheque/Debit", X.debit], ["Deposit/Credit", X.credit], ["Date", 600], ["Balance", X.balance]],
      [["Deposit", X.desc], ["16,336.25", X.credit], ["JAN 2", 600], ["27,094.52", X.balance]],
      [["Cheque", X.desc], ["11,862.10", X.debit], ["JAN 3", 600], ["15,232.42", X.balance]],
      [["Deposit", X.desc], ["9,775.00", X.credit], ["JAN 10", 600], ["25,007.42", X.balance]],
      [["Withdrawal", X.desc], ["11,170.34", X.debit], ["JAN 15", 600], ["13,837.08", X.balance]],
      // Page totals / statistics — money present but NOT in a money column.
      [["Credits 2 26,111.25", X.desc]],
      [["MONTHLY AVER. CR. BAL. 137,366.85", X.desc]],
    ],
    expect: {
      rows: 4,
      opening: 10758.27,
      closing: 13837.08,
      totalCredits: 26111.25,
      totalDebits: 23032.44,
      balancePasses: true,
      columnOrder: "description|debit|credit|date|balance",
      statementKind: "bank-account",
      noDescriptionIncludes: ["MONTHLY", "137,366.85"],
      note: "date column read from the 4th position; page-stat lines ignored",
    },
  },

  // C. Credit-card table: Transaction Date | Posting Date | Description | Amount
  {
    name: "C-credit-card-table",
    description: "Transaction Date | Posting Date | Description | Amount (multi-word headers)",
    rows: [
      [["RBC Visa", X.date]],
      [["Previous Account Balance", X.date], ["$200.00", X.amount]],
      [["Transaction", X.date], ["Date", X.date + 65], ["Posting", X.postDate], ["Date", X.postDate + 65], ["Description", X.desc], ["Amount", X.amount]],
      [["APR 22", X.date], ["APR 24", X.postDate], ["SUNNYSIDE MARKET", X.desc], ["25.25", X.amount]],
      [["APR 29", X.date], ["APR 29", X.postDate], ["PAYMENT THANK YOU", X.desc], ["150.00-", X.amount]],
      [["New Balance", X.date], ["$75.25", X.amount]],
    ],
    expect: {
      rows: 2,
      opening: 200,
      closing: 75.25,
      totalCredits: 150,
      totalDebits: 25.25,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      note: "trailing-minus amount maps to credit; single Amount column",
    },
  },

  // D. Sectioned credit-card table: Trans Date | Post Date | Description | Category | Amount
  {
    name: "D-sectioned-credit-card-table",
    description: "Trans Date | Post Date | Description | Category | Amount",
    rows: [
      [["Some Credit Union Mastercard", X.date]],
      [["Previous Balance", X.date], ["$100.00", X.amount]],
      [["Trans Date", X.date], ["Post Date", X.postDate], ["Description", X.desc], ["Category", X.category], ["Amount", X.amount]],
      [["JAN 05", X.date], ["JAN 06", X.postDate], ["GROCERY STORE", X.desc], ["Groceries", X.category], ["50.00", X.amount]],
      [["JAN 09", X.date], ["JAN 10", X.postDate], ["RESTAURANT", X.desc], ["Dining", X.category], ["30.00", X.amount]],
      [["JAN 10", X.date], ["JAN 11", X.postDate], ["PAYMENT THANK YOU", X.desc], ["Payment", X.category], ["100.00-", X.amount]],
      [["New Balance", X.date], ["$80.00", X.amount]],
    ],
    expect: {
      rows: 3,
      opening: 100,
      closing: 80,
      totalCredits: 100,
      totalDebits: 80,
      balancePasses: true,
      columnOrder: "date|postDate|description|category|amount",
      statementKind: "credit-card",
      note: "Category column ignored for amounts; payment credit via trailing minus",
    },
  },

  // E. Multi-line FX credit-card row: merchant, reference, FX detail, final CAD amount
  {
    name: "E-fx-multiline-credit-card-row",
    description: "Merchant line, reference line, FX detail line, then the final CAD amount line",
    rows: [
      [["RBC Visa", X.date]],
      [["Previous Account Balance", X.date], ["$0.00", X.amount]],
      [["Transaction", X.date], ["Date", X.date + 65], ["Posting", X.postDate], ["Date", X.postDate + 65], ["Description", X.desc], ["Amount", X.amount]],
      [["APR 10", X.date], ["APR 11", X.postDate], ["OFFICE SUPPLIES", X.desc], ["704.15", X.amount]],
      [["APR 12", X.date], ["APR 13", X.postDate], ["IHOMEFINDER SAN FRANCISCO", X.desc]],
      [["74500000000000000000001", X.desc]],
      [["Foreign Currency USD 175.00 Exchange rate 1.357143", X.desc]],
      [["237.45", X.amount]],
      [["New Balance", X.date], ["$941.60", X.amount]],
    ],
    expect: {
      rows: 2,
      opening: 0,
      closing: 941.6,
      totalCredits: 0,
      totalDebits: 941.6,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      noDescriptionIncludes: ["Foreign", "175.00", "Exchange", "74500"],
      note: "FX/reference sub-lines attached/ignored; final CAD amount captured",
    },
  },

  // F. Bank table with dateless rows inside the table (date carried forward)
  {
    name: "F-bank-dateless-rows",
    description: "Date | Description | Amount | Balance with dateless continuation rows",
    rows: [
      [["Some Bank", X.date]],
      [["Opening Balance", X.date], ["1,000.00", X.balance]],
      [["Date", X.date], ["Description", X.desc], ["Amount", X.amount], ["Balance", X.balance]],
      [["2024-06-02", X.date], ["Payroll Deposit", X.desc], ["2,000.00", X.amount], ["3,000.00", X.balance]],
      [["Interac Received", X.desc], ["500.00", X.amount], ["3,500.00", X.balance]],
      [["Hydro Payment", X.desc], ["200.00", X.amount], ["3,300.00", X.balance]],
      [["Closing Balance", X.date], ["3,300.00", X.balance]],
    ],
    expect: {
      rows: 3,
      opening: 1000,
      closing: 3300,
      totalCredits: 2500,
      totalDebits: 200,
      balancePasses: true,
      columnOrder: "date|description|amount|balance",
      statementKind: "bank-account",
      note: "two dateless rows promoted; single-amount direction from balance delta",
    },
  },

  // G. Multi-account: small share section + transaction-heavy account section
  {
    name: "G-multi-account-statement",
    description: "Tiny share account section plus a real transaction-heavy account section",
    rows: [
      [["Some Credit Union", X.date]],
      [["Equity Shares", X.date]],
      [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
      [["Opening Balance", X.date], ["5.00", X.balance]],
      [["Closing Balance", X.date], ["5.00", X.balance]],
      [["Business Chequing", X.date]],
      [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
      [["Opening Balance", X.date], ["25,816.58", X.balance]],
      [["Jan 3", X.date], ["Client Deposit", X.desc], ["20,000.00", X.credit], ["45,816.58", X.balance]],
      [["Jan 10", X.date], ["Supplier Payment", X.desc], ["10,000.00", X.debit], ["35,816.58", X.balance]],
      [["Jan 20", X.date], ["Client Deposit", X.desc], ["22,396.47", X.credit], ["58,213.05", X.balance]],
      [["Jan 28", X.date], ["Loan Payment", X.desc], ["20,335.17", X.debit], ["37,877.88", X.balance]],
      [["Closing Balance", X.date], ["37,877.88", X.balance]],
    ],
    expect: {
      rows: 4,
      opening: 25816.58,
      closing: 37877.88,
      totalCredits: 42396.47,
      totalDebits: 30335.17,
      balancePasses: true,
      columnOrder: "date|description|debit|credit|balance",
      statementKind: "bank-account",
      note: "transaction-heavy account section wins via reconciliation",
    },
  },

  // H. Summary-heavy statement: nothing in the summary block becomes a transaction
  {
    name: "H-summary-heavy-statement",
    description: "Summary totals, credit limit, available credit, minimum payment, page totals, legal text",
    rows: [
      [["RBC Visa", X.date]],
      [["Previous Account Balance", X.date], ["$500.00", X.amount]],
      [["Credit Limit", X.date], ["$10,000.00", X.amount]],
      [["Available Credit", X.date], ["$9,500.00", X.amount]],
      [["Minimum Payment", X.date], ["$10.00", X.amount]],
      [["Total Purchases", X.date], ["$120.00", X.amount]],
      [["Total Payments", X.date], ["$50.00", X.amount]],
      [["Transaction", X.date], ["Date", X.date + 65], ["Posting", X.postDate], ["Date", X.postDate + 65], ["Description", X.desc], ["Amount", X.amount]],
      [["MAY 02", X.date], ["MAY 03", X.postDate], ["BOOK STORE", X.desc], ["120.00", X.amount]],
      [["MAY 10", X.date], ["MAY 11", X.postDate], ["PAYMENT THANK YOU", X.desc], ["50.00-", X.amount]],
      [["New Balance", X.date], ["$570.00", X.amount]],
      [["Important information about your account", X.date]],
      [["You may transfer up to 100,000.00 per day", X.date]],
    ],
    expect: {
      rows: 2,
      opening: 500,
      closing: 570,
      totalCredits: 50,
      totalDebits: 120,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      noDescriptionIncludes: ["Credit Limit", "Available", "Minimum", "100,000.00"],
      note: "credit limit / available credit / minimum payment / totals / legal text never become rows",
    },
  },

  // I. Headers with ($)/colon/unit suffixes (relaxed matching).
  {
    name: "I-suffixed-headers",
    description: "Date | Description | Debit ($) | Credit ($) | Balance : — suffixes must still resolve",
    rows: [
      [["Some Bank Chequing", X.date]],
      [["Opening Balance", X.date], ["2,000.00", X.balance]],
      [["Date", X.date], ["Description", X.desc], ["Debit ($)", X.debit], ["Credit ($)", X.credit], ["Balance :", X.balance]],
      [["2024-05-02", X.date], ["Payroll Deposit", X.desc], ["2,200.00", X.credit], ["4,200.00", X.balance]],
      [["2024-05-03", X.date], ["Grocery Mart Purchase", X.desc], ["84.20", X.debit], ["4,115.80", X.balance]],
      [["2024-05-05", X.date], ["Coffee Roasters", X.desc], ["5.75", X.debit], ["4,110.05", X.balance]],
      [["Closing Balance", X.date], ["4,110.05", X.balance]],
    ],
    expect: {
      rows: 3,
      opening: 2000,
      closing: 4110.05,
      totalCredits: 2200,
      totalDebits: 89.95,
      balancePasses: true,
      columnOrder: "date|description|debit|credit|balance",
      statementKind: "bank-account",
      note: "($)/colon/unit suffixes stripped before matching",
    },
  },

  // J. Stacked Transaction Date / Posting Date header (multi-line merge).
  {
    name: "J-stacked-cc-header",
    description: "Two-line stacked header: Transaction/Posting/Description/Amount over Date/Date",
    rows: [
      [["RBC Visa", X.date]],
      [["Previous Account Balance", X.date], ["$200.00", X.amount]],
      [["Transaction", X.date], ["Posting", X.postDate], ["Description", X.desc], ["Amount ($)", X.amount]],
      [["Date", X.date], ["Date", X.postDate]],
      [["APR 22", X.date], ["APR 24", X.postDate], ["SUNNYSIDE MARKET", X.desc], ["25.25", X.amount]],
      [["APR 29", X.date], ["APR 29", X.postDate], ["PAYMENT THANK YOU", X.desc], ["150.00-", X.amount]],
      [["New Balance", X.date], ["$75.25", X.amount]],
    ],
    expect: {
      rows: 2,
      opening: 200,
      closing: 75.25,
      totalCredits: 150,
      totalDebits: 25.25,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      note: "stacked 'Transaction'/'Date' merge into one logical header",
    },
  },

  // K. Split header: anchor on one line, value columns on the next (bank).
  {
    name: "K-split-bank-header",
    description: "Date Description on one line; Withdrawals Deposits Balance on the next",
    rows: [
      [["Some Bank Chequing", X.date]],
      [["Opening Balance", X.date], ["2,000.00", X.balance]],
      [["Date", X.date], ["Description", X.desc]],
      [["Withdrawals", X.debit], ["Deposits", X.credit], ["Balance", X.balance]],
      [["2024-05-02", X.date], ["Payroll Deposit", X.desc], ["2,200.00", X.credit], ["4,200.00", X.balance]],
      [["2024-05-03", X.date], ["Grocery Mart Purchase", X.desc], ["84.20", X.debit], ["4,115.80", X.balance]],
      [["2024-05-05", X.date], ["Coffee Roasters", X.desc], ["5.75", X.debit], ["4,110.05", X.balance]],
      [["Closing Balance", X.date], ["4,110.05", X.balance]],
    ],
    expect: {
      rows: 3,
      opening: 2000,
      closing: 4110.05,
      totalCredits: 2200,
      totalDebits: 89.95,
      balancePasses: true,
      columnOrder: "date|description|debit|credit|balance",
      statementKind: "bank-account",
      note: "value-column header line below the anchor line is merged in",
    },
  },

  // L. Headerless aligned table (conservative x-clustering fallback).
  {
    name: "L-headerless-aligned-table",
    description: "No header row; date/description/amount/balance inferred from x-clustering",
    rows: [
      [["Some Bank", X.date]],
      [["Opening Balance", X.date], ["1,000.00", X.balance]],
      [["2024-07-02", X.date], ["Payroll Deposit", X.desc], ["2,000.00", X.amount], ["3,000.00", X.balance]],
      [["2024-07-03", X.date], ["Interac Received", X.desc], ["500.00", X.amount], ["3,500.00", X.balance]],
      [["2024-07-05", X.date], ["Hydro Payment", X.desc], ["200.00", X.amount], ["3,300.00", X.balance]],
      [["2024-07-08", X.date], ["Grocery Purchase", X.desc], ["100.00", X.amount], ["3,200.00", X.balance]],
      [["Closing Balance", X.date], ["3,200.00", X.balance]],
    ],
    expect: {
      rows: 4,
      opening: 1000,
      closing: 3200,
      totalCredits: 2500,
      totalDebits: 300,
      balancePasses: true,
      columnOrder: "date|description|amount|balance",
      statementKind: "bank-account",
      note: "no header; conservative x-clustering builds columns; direction from balance delta",
    },
  },

  // M. Credit-card amount on a separate visual line.
  {
    name: "M-cc-amount-separate-line",
    description: "Merchant line has no amount; the amount sits on the next visual line",
    rows: [
      [["RBC Visa", X.date]],
      [["Previous Balance", X.date], ["$100.00", X.amount]],
      [["Trans Date", X.date], ["Post Date", X.postDate], ["Description", X.desc], ["Amount", X.amount]],
      [["APR 05", X.date], ["APR 06", X.postDate], ["GROCERY STORE", X.desc]],
      [["50.00", X.amount]],
      [["APR 10", X.date], ["APR 11", X.postDate], ["PAYMENT THANK YOU", X.desc], ["100.00-", X.amount]],
      [["New Balance", X.date], ["$50.00", X.amount]],
    ],
    expect: {
      rows: 2,
      opening: 100,
      closing: 50,
      totalCredits: 100,
      totalDebits: 50,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      note: "amount on a separate line completes the pending merchant row",
    },
  },

  // N. Credit-card FX detail line before the final CAD amount.
  {
    name: "N-cc-fx-then-cad",
    description: "Merchant, then a foreign-currency detail line, then the final CAD amount",
    rows: [
      [["RBC Visa", X.date]],
      [["Previous Balance", X.date], ["$0.00", X.amount]],
      [["Trans Date", X.date], ["Post Date", X.postDate], ["Description", X.desc], ["Amount", X.amount]],
      [["APR 12", X.date], ["APR 13", X.postDate], ["IHOMEFINDER", X.desc]],
      [["Foreign Currency 175.00 USD Exchange 1.36", X.desc]],
      [["237.45", X.amount]],
      [["APR 15", X.date], ["APR 16", X.postDate], ["OFFICE SUPPLIES", X.desc], ["100.00", X.amount]],
      [["New Balance", X.date], ["$337.45", X.amount]],
    ],
    expect: {
      rows: 2,
      opening: 0,
      closing: 337.45,
      totalCredits: 0,
      totalDebits: 337.45,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      noDescriptionIncludes: ["Foreign", "175.00", "Exchange", "USD"],
      note: "FX detail line ignored; final CAD amount kept, not the foreign amount",
    },
  },

  // O. Bank table continued across two pages with repeated headers (stitched).
  {
    name: "O-bank-continued-pages",
    description: "Same bank table over two pages with a repeated header — must stitch",
    rows: [
      [["Some Bank Chequing", X.date]],
      [["Opening Balance", X.date], ["1,000.00", X.balance]],
      [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
      [["2024-08-02", X.date], ["Payroll Deposit", X.desc], ["2,000.00", X.credit], ["3,000.00", X.balance]],
      [["2024-08-04", X.date], ["Hydro One", X.desc], ["200.00", X.debit], ["2,800.00", X.balance]],
    ],
    morePages: [
      [
        [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
        [["2024-08-10", X.date], ["Interac Received", X.desc], ["500.00", X.credit], ["3,300.00", X.balance]],
        [["2024-08-15", X.date], ["Service Fee", X.desc], ["100.00", X.debit], ["3,200.00", X.balance]],
        [["Closing Balance", X.date], ["3,200.00", X.balance]],
      ],
    ],
    expect: {
      rows: 4,
      opening: 1000,
      closing: 3200,
      totalCredits: 2500,
      totalDebits: 300,
      balancePasses: true,
      columnOrder: "date|description|debit|credit|balance",
      statementKind: "bank-account",
      stitched: true,
      regionsStitched: 2,
      note: "repeated header on page 2; regions stitch into the full statement",
    },
  },

  // P. Bank table with a balance-forward anchor on page 2 (stitched).
  {
    name: "P-bank-balance-forward-page2",
    description: "Page 2 opens with a balance-forward continuation anchor (not a new account)",
    rows: [
      [["Some Bank", X.date]],
      [["Opening Balance", X.date], ["1,000.00", X.balance]],
      [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
      [["2024-09-02", X.date], ["Payroll Deposit", X.desc], ["2,000.00", X.credit], ["3,000.00", X.balance]],
      [["2024-09-04", X.date], ["Rent Payment", X.desc], ["200.00", X.debit], ["2,800.00", X.balance]],
    ],
    morePages: [
      [
        [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
        [["Balance Forward", X.date], ["2,800.00", X.balance]],
        [["2024-09-10", X.date], ["Interac Received", X.desc], ["500.00", X.credit], ["3,300.00", X.balance]],
        [["2024-09-15", X.date], ["Service Fee", X.desc], ["100.00", X.debit], ["3,200.00", X.balance]],
        [["Closing Balance", X.date], ["3,200.00", X.balance]],
      ],
    ],
    expect: {
      rows: 4,
      opening: 1000,
      closing: 3200,
      totalCredits: 2500,
      totalDebits: 300,
      balancePasses: true,
      columnOrder: "date|description|debit|credit|balance",
      statementKind: "bank-account",
      stitched: true,
      regionsStitched: 2,
      note: "balance-forward is a continuation anchor (not a transaction, not a new account)",
    },
  },

  // Q. Multi-account: a share account must NOT stitch into the real account.
  {
    name: "Q-multi-account-no-stitch",
    description: "Tiny share section + transaction account; the two must not be stitched together",
    rows: [
      [["Some Credit Union", X.date]],
      [["Equity Shares", X.date]],
      [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
      [["Opening Balance", X.date], ["5.00", X.balance]],
      [["Closing Balance", X.date], ["5.00", X.balance]],
      [["Business Chequing", X.date]],
      [["Date", X.date], ["Description", X.desc], ["Debit", X.debit], ["Credit", X.credit], ["Balance", X.balance]],
      [["Opening Balance", X.date], ["25,816.58", X.balance]],
      [["Jan 3", X.date], ["Client Deposit", X.desc], ["20,000.00", X.credit], ["45,816.58", X.balance]],
      [["Jan 10", X.date], ["Supplier Payment", X.desc], ["10,000.00", X.debit], ["35,816.58", X.balance]],
      [["Jan 20", X.date], ["Client Deposit", X.desc], ["22,396.47", X.credit], ["58,213.05", X.balance]],
      [["Jan 28", X.date], ["Loan Payment", X.desc], ["20,335.17", X.debit], ["37,877.88", X.balance]],
      [["Closing Balance", X.date], ["37,877.88", X.balance]],
    ],
    expect: {
      rows: 4,
      opening: 25816.58,
      closing: 37877.88,
      totalCredits: 42396.47,
      totalDebits: 30335.17,
      balancePasses: true,
      columnOrder: "date|description|debit|credit|balance",
      statementKind: "bank-account",
      stitched: false,
      note: "fresh opening balance between sections blocks stitching; business account wins alone",
    },
  },

  // R. Credit-card table continued across pages (stitched).
  {
    name: "R-cc-continued-pages",
    description: "Credit-card transactions continue on page 2 under a repeated header",
    rows: [
      [["RBC Visa", X.date]],
      [["Previous Account Balance", X.date], ["$100.00", X.amount]],
      [["Transaction", X.date], ["Date", X.date + 65], ["Posting", X.postDate], ["Date", X.postDate + 65], ["Description", X.desc], ["Amount", X.amount]],
      [["APR 02", X.date], ["APR 03", X.postDate], ["STORE A", X.desc], ["50.00", X.amount]],
      [["APR 04", X.date], ["APR 05", X.postDate], ["STORE B", X.desc], ["30.00", X.amount]],
    ],
    morePages: [
      [
        [["Transaction", X.date], ["Date", X.date + 65], ["Posting", X.postDate], ["Date", X.postDate + 65], ["Description", X.desc], ["Amount", X.amount]],
        [["APR 10", X.date], ["APR 11", X.postDate], ["STORE C", X.desc], ["20.00", X.amount]],
        [["APR 12", X.date], ["APR 13", X.postDate], ["PAYMENT THANK YOU", X.desc], ["100.00-", X.amount]],
        [["New Balance", X.date], ["$100.00", X.amount]],
      ],
    ],
    expect: {
      rows: 4,
      opening: 100,
      closing: 100,
      totalCredits: 100,
      totalDebits: 100,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      stitched: true,
      regionsStitched: 2,
      note: "repeated CC header across pages; transactions stitch to one statement",
    },
  },

  // S. Sectioned credit-card activity: multiple card sections roll into one summary.
  {
    name: "S-sectioned-cc-rollup",
    description: "Two card sections under one Previous/New balance; subtotals ignored",
    rows: [
      [["RBC Business Visa", X.date]],
      [["Previous Statement Balance", X.date], ["$0.00", X.amount]],
      [["Card 1234", X.date]],
      [["Trans Date", X.date], ["Post Date", X.postDate], ["Description", X.desc], ["Amount", X.amount]],
      [["APR 05", X.date], ["APR 06", X.postDate], ["OFFICE SUPPLIES", X.desc], ["704.15", X.amount]],
      [["SUBTOTAL OF MONTHLY ACTIVITY", X.date], ["704.15", X.amount]],
      [["Card 5678", X.date]],
      [["Trans Date", X.date], ["Post Date", X.postDate], ["Description", X.desc], ["Amount", X.amount]],
      [["APR 10", X.date], ["APR 11", X.postDate], ["TRAVEL EXPENSE", X.desc], ["237.45", X.amount]],
      [["SUBTOTAL OF MONTHLY ACTIVITY", X.date], ["237.45", X.amount]],
      [["New Balance", X.date], ["$941.60", X.amount]],
    ],
    expect: {
      rows: 2,
      opening: 0,
      closing: 941.6,
      totalCredits: 0,
      totalDebits: 941.6,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      stitched: true,
      regionsStitched: 2,
      noDescriptionIncludes: ["SUBTOTAL"],
      note: "sectioned CC card blocks roll up to one summary; subtotal rows are not transactions",
    },
  },

  // T. Legal/remittance barrier between pages must stop stitching.
  {
    name: "T-legal-barrier-no-stitch",
    description: "A legal/info section between pages blocks stitching; text fallback handles it",
    rows: [
      [["RBC Visa", X.date]],
      [["Previous Balance", X.date], ["$100.00", X.amount]],
      [["Transaction", X.date], ["Date", X.date + 65], ["Posting", X.postDate], ["Date", X.postDate + 65], ["Description", X.desc], ["Amount", X.amount]],
      [["APR 05", X.date], ["APR 06", X.postDate], ["GROCERY STORE", X.desc], ["50.00", X.amount]],
      [["APR 07", X.date], ["APR 08", X.postDate], ["GAS BAR", X.desc], ["30.00", X.amount]],
      [["Important information about your account", X.date]],
      [["Please see reverse for details", X.date]],
    ],
    morePages: [
      [
        [["Transaction", X.date], ["Date", X.date + 65], ["Posting", X.postDate], ["Date", X.postDate + 65], ["Description", X.desc], ["Amount", X.amount]],
        [["APR 10", X.date], ["APR 11", X.postDate], ["BOOK STORE", X.desc], ["20.00", X.amount]],
        [["APR 12", X.date], ["APR 13", X.postDate], ["PAYMENT THANK YOU", X.desc], ["100.00-", X.amount]],
        [["New Balance", X.date], ["$100.00", X.amount]],
      ],
    ],
    expect: {
      rows: 4,
      opening: 100,
      closing: 100,
      totalCredits: 100,
      totalDebits: 100,
      balancePasses: true,
      columnOrder: "date|postDate|description|amount",
      statementKind: "credit-card",
      source: "text-parser",
      stitched: false,
      note: "legal barrier between pages rejects stitching; neither region reconciles alone, text wins",
    },
  },
];
