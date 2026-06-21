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
  expect: {
    rows: number;
    opening: number | null;
    closing: number | null;
    totalCredits: number;
    totalDebits: number;
    balancePasses: boolean;
    columnOrder: string;
    statementKind: "credit-card" | "bank-account";
    /** Substrings that must NOT appear in any parsed row description. */
    noDescriptionIncludes?: string[];
    note?: string;
  };
};

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
];
