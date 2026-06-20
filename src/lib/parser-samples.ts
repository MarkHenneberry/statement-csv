// Synthetic, FAKE statement text samples for validating the parser helpers.
//
// None of this is real bank statement data. It exists only to exercise the
// parsing heuristics deterministically (locally or via scripts/parser-samples.mts).
//
// This module is intentionally dependency-free (no runtime imports) so it can be
// run by a plain Node script with type stripping.

export type ParserSample = {
  name: string;
  description: string;
  text: string;
  expect: {
    kind?: "credit-card" | "bank-account" | "unknown";
    family?: "credit-card-table" | "bank-account-table" | "unknown";
    candidate?: "credit-card-simple" | "credit-card-sectioned" | "bank-account" | "fallback";
    minRows: number;
    maxRows?: number;
    opening?: boolean;
    closing?: boolean;
    /** Minimum number of rows that should have a credit value. */
    creditRows?: number;
    /** Minimum number of rows that should have a debit value. */
    debitRows?: number;
    /** Assert that NO row has a credit value. */
    noCredit?: boolean;
    /** Assert that NO row has a debit value. */
    noDebit?: boolean;
    balancePasses?: boolean;
    /** Every row's Balance column should be null (credit cards have no running balance). */
    balanceNull?: boolean;
    note?: string;
  };
};

// Fake RBC-style credit card header. Carries the signals statement-kind
// detection relies on (Visa, payment due date, minimum payment) and the year.
const CC_HEADER = [
  "RBC ROYAL BANK VISA",
  "STATEMENT FROM APR 24 TO MAY 25, 2026",
  "PAYMENT DUE DATE MAY 21, 2026",
  "MINIMUM PAYMENT $10.00",
].join("\n");

export const parserSamples: ParserSample[] = [
  // ----- Bank-account style (existing line-based parser) -----
  {
    name: "simple-debit-with-balance",
    description: "Simple date / description / debit / running balance",
    text: "2024-05-03 Grocery Mart Purchase 84.20 4,115.80",
    expect: { minRows: 1, note: "debit row with a running balance" },
  },
  {
    name: "credit-deposit-row",
    description: "Credit / deposit row (keyword-driven direction)",
    text: "2024-05-02 Payroll Deposit 2,200.00 4,200.00",
    expect: { minRows: 1, creditRows: 1, note: "should be a credit, not a debit" },
  },
  {
    name: "running-balance-row",
    description: "Row where a running balance follows the amount",
    text: "2024-05-07 Hydro One Pre-Auth Payment 142.50 3,967.55",
    expect: { minRows: 1, note: "last value should be treated as balance" },
  },
  {
    name: "month-name-date-row",
    description: "Month-name date (MMM DD)",
    text: "Statement period 2024\nMay 5 Coffee Roasters Purchase 5.75 4,110.05",
    expect: { minRows: 1, note: "fallback year 2024 from the header line" },
  },
  {
    name: "bank-tiny-statement",
    description: "Small end-to-end bank statement (balance should balance)",
    text: [
      "Synthetic Account Statement 2024",
      "Opening Balance 2,000.00",
      "2024-05-02 Payroll Deposit 2,200.00 4,200.00",
      "2024-05-03 Grocery Mart Purchase 84.20 4,115.80",
      "2024-05-05 Coffee Roasters Purchase 5.75 4,110.05",
      "Closing Balance 4,110.05",
    ].join("\n"),
    expect: {
      kind: "bank-account",
      minRows: 3,
      opening: true,
      closing: true,
      balancePasses: true,
    },
  },

  // ----- RBC-style credit card (new parser path) -----
  {
    name: "cc-basic-purchase",
    description: "Credit card basic purchase block",
    text: [
      CC_HEADER,
      "APR 22",
      "APR 24 SUNNYSIDE MARKET TORONTO ON",
      "74514206113043605105569",
      "$25.25",
    ].join("\n"),
    expect: { kind: "credit-card", minRows: 1, maxRows: 1, debitRows: 1 },
  },
  {
    name: "cc-payment-credit",
    description: "Credit card payment / credit with negative amount",
    text: [
      CC_HEADER,
      "APR 29",
      "APR 29 PAYMENT - THANK YOU / PAIEMENT - MERCI",
      "74510106119619981303108",
      "-$150.00",
    ].join("\n"),
    expect: { kind: "credit-card", minRows: 1, maxRows: 1, creditRows: 1 },
  },
  {
    name: "cc-multiline-merchant",
    description: "Credit card multi-line merchant description",
    text: [
      CC_HEADER,
      "MAY 11",
      "MAY 11 DOORDASHTHEMILLSTON DOWNTOWN",
      "TOROON",
      "74083426131100006867404",
      "$125.49",
    ].join("\n"),
    expect: { kind: "credit-card", minRows: 1, maxRows: 1, debitRows: 1 },
  },
  {
    name: "cc-foreign-currency-note",
    description: "Credit card row with a foreign currency detail line",
    text: [
      CC_HEADER,
      "MAY 02",
      "MAY 03 NETFLIX.COM SUBSCRIPTION",
      "USD 9.99",
      "EXCHANGE RATE 1.36",
      "74000000000000000000001",
      "$13.59",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 1,
      maxRows: 1,
      debitRows: 1,
      note: "FX lines must not become separate transactions",
    },
  },
  {
    name: "cc-interest-charge",
    description: "Credit card interest charge (debit)",
    text: [
      CC_HEADER,
      "MAY 25",
      "MAY 25 INTEREST CHARGE ON PURCHASES",
      "74000000000000000000002",
      "$4.12",
    ].join("\n"),
    expect: { kind: "credit-card", minRows: 1, maxRows: 1, debitRows: 1 },
  },
  {
    name: "cc-previous-account-balance",
    description: "Detect Previous Account Balance as opening",
    text: [
      "RBC ROYAL BANK VISA",
      "STATEMENT FROM APR 24 TO MAY 25, 2026",
      "Previous Account Balance $1,000.00",
    ].join("\n"),
    expect: { kind: "credit-card", minRows: 0, opening: true },
  },
  {
    name: "cc-new-balance",
    description: "Detect New Balance as closing",
    text: [
      "RBC ROYAL BANK VISA",
      "STATEMENT FROM APR 24 TO MAY 25, 2026",
      "New Balance $1,234.56",
    ].join("\n"),
    expect: { kind: "credit-card", minRows: 0, closing: true },
  },
  {
    name: "cc-total-account-balance",
    description: "Detect Total Account Balance as closing fallback",
    text: [
      "RBC ROYAL BANK VISA",
      "STATEMENT FROM APR 24 TO MAY 25, 2026",
      "Total Account Balance $2,345.67",
    ].join("\n"),
    expect: { kind: "credit-card", minRows: 0, closing: true },
  },
  {
    name: "cc-end-stop",
    description: "End-of-transactions stop: TOTAL then hard stops, no rows after",
    text: [
      CC_HEADER,
      "APR 22",
      "APR 24 SUNNYSIDE MARKET TORONTO ON",
      "74514206113043605105569",
      "$25.25",
      "TOTAL ACCOUNT BALANCE $1,234.56",
      "Time to Pay",
      "INTEREST RATE CHART",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 1,
      maxRows: 1,
      closing: true,
      note: "TOTAL with no transactions after it is the real end",
    },
  },
  {
    name: "rbc-regress-sidebar-continue",
    description: "Sidebar TOTAL ACCOUNT BALANCE mid-table must not stop parsing",
    text: [
      "RBC ROYAL BANK VISA",
      "STATEMENT FROM APR 24 TO MAY 25, 2026",
      "MINIMUM PAYMENT $10.00",
      "Previous Account Balance $0.00",
      "TRANSACTION DATE POSTING DATE ACTIVITY DESCRIPTION AMOUNT ($)",
      "APR 22 APR 24 FAKE STORE ONE",
      "12345678901234567890",
      "$25.00",
      "TOTAL ACCOUNT BALANCE $100.00",
      "APR 25 APR 26 FAKE STORE TWO",
      "12345678901234567890",
      "$50.00",
      "APR 27 APR 28 FAKE STORE THREE",
      "12345678901234567890",
      "$25.00",
      "New Balance $100.00",
      "TOTAL ACCOUNT BALANCE $100.00",
      "Time to Pay",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 3,
      maxRows: 3,
      opening: true,
      closing: true,
      debitRows: 3,
      balanceNull: true,
      balancePasses: true,
      note: "first TOTAL is sidebar (ignored); second TOTAL is the real end",
    },
  },
  {
    name: "rbc-regress-positive-credit-word",
    description: "Positive amount whose merchant name contains 'CREDIT' stays a Debit",
    text: [
      CC_HEADER,
      "APR 29 APR 30 FAKE CHATGPT CREDIT EXAMPLE.COM CA",
      "12345678901234567890",
      "$64.01",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 1,
      maxRows: 1,
      debitRows: 1,
      noCredit: true,
      balanceNull: true,
      note: "the word 'credit' in a merchant name must not flip a positive charge",
    },
  },
  // ----- RBC regression: real extracted layout (same-line dates) -----
  {
    name: "rbc-regress-same-line-purchase",
    description: "Same-line dates + reference + amount on separate lines",
    text: [
      CC_HEADER,
      "APR 22 APR 24 FAKE STORE HALIFAX NS",
      "12345678901234567890",
      "$25.25",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 1,
      maxRows: 1,
      debitRows: 1,
      balanceNull: true,
    },
  },
  {
    name: "rbc-regress-same-line-payment",
    description: "Same-line dates payment with negative amount (credit)",
    text: [
      CC_HEADER,
      "APR 29 APR 29 PAYMENT - THANK YOU / PAIEMENT - MERCI",
      "12345678901234567890",
      "-$150.00",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 1,
      maxRows: 1,
      creditRows: 1,
      balanceNull: true,
    },
  },
  {
    name: "rbc-regress-same-line-multiline-desc",
    description: "Same-line dates with a wrapped continuation description line",
    text: [
      CC_HEADER,
      "MAY 11 MAY 11 FAKE RESTAURANT DOWNTOWN",
      "TORONTO",
      "12345678901234567890",
      "$125.49",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 1,
      maxRows: 1,
      debitRows: 1,
      balanceNull: true,
    },
  },
  {
    name: "rbc-regress-same-line-foreign-currency",
    description: "Same-line dates with a foreign currency detail line",
    text: [
      CC_HEADER,
      "APR 28 APR 29 FAKE ONLINE SUBSCRIPTION EXAMPLE.COM CA",
      "12345678901234567890",
      "Foreign Currency - USD 22.80 Exchange rate - 1.403070",
      "$31.99",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 1,
      maxRows: 1,
      debitRows: 1,
      balanceNull: true,
      note: "FX detail line must not become a separate transaction",
    },
  },
  {
    name: "rbc-regress-inline-amount",
    description: "Same-line dates with reference and amount all on one line",
    text: [
      CC_HEADER,
      "APR 22 APR 24 FAKE STORE HALIFAX NS 12345678901234567890 $25.25",
      "APR 25 APR 26 ANOTHER FAKE MERCHANT 98765432109876543210 $51.49",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 2,
      maxRows: 2,
      debitRows: 2,
      balanceNull: true,
      note: "everything on one line: dates, description, reference, amount",
    },
  },
  {
    name: "rbc-regress-summary-before-header",
    description: "Summary box (with TOTAL ACCOUNT BALANCE) before the transaction header",
    text: [
      "RBC ROYAL BANK VISA",
      "STATEMENT FROM APR 24 TO MAY 25, 2026",
      "PAYMENT DUE DATE MAY 21, 2026",
      "MINIMUM PAYMENT $10.00",
      "Previous Account Balance $100.00",
      "New Balance $176.74",
      "TOTAL ACCOUNT BALANCE $176.74",
      "TRANSACTION DATE POSTING DATE ACTIVITY DESCRIPTION AMOUNT ($)",
      "APR 22 APR 24 FAKE STORE HALIFAX NS",
      "12345678901234567890",
      "$25.25",
      "APR 25 APR 26 ANOTHER FAKE MERCHANT",
      "12345678901234567890",
      "$51.49",
      "TOTAL ACCOUNT BALANCE $176.74",
      "Time to Pay",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 2,
      maxRows: 2,
      opening: true,
      closing: true,
      debitRows: 2,
      balanceNull: true,
      balancePasses: true,
      note: "summary TOTAL ACCOUNT BALANCE must not stop parsing before the header",
    },
  },
  {
    name: "cc-full-statement",
    description: "End-to-end credit card statement; balance check should pass",
    text: [
      "RBC ROYAL BANK VISA",
      "STATEMENT FROM APR 24 TO MAY 25, 2026",
      "PAYMENT DUE DATE MAY 21, 2026",
      "MINIMUM PAYMENT $10.00",
      "Previous Account Balance $100.00",
      "APR 25",
      "APR 26 SUNNYSIDE MARKET TORONTO ON",
      "74000000000000000000010",
      "$50.00",
      "APR 29",
      "APR 29 PAYMENT - THANK YOU / PAIEMENT - MERCI",
      "74000000000000000000011",
      "-$30.00",
      "New Balance $120.00",
      "Total Account Balance $120.00",
      "TIME TO PAY",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      minRows: 2,
      maxRows: 2,
      opening: true,
      closing: true,
      debitRows: 1,
      creditRows: 1,
      balancePasses: true,
    },
  },

  // ----- Candidate scoring: simple vs sectioned (RBC Visa regression guard) -----
  {
    name: "cc-simple-vs-sectioned-sidebar",
    description:
      "A 'Payments & credits' sidebar heading must NOT flip the whole table to credit. The simple candidate (positive=debit) should win via reconciliation.",
    text: [
      "RBC ROYAL BANK VISA",
      "STATEMENT FROM APR 24 TO MAY 25, 2026",
      "Previous Account Balance $100.00",
      "Payments & credits",
      "APR 25 APR 26 STORE ONE $50.00",
      "APR 26 APR 27 STORE TWO $30.00",
      "APR 27 APR 28 PAYMENT - THANK YOU / PAIEMENT - MERCI -$80.00",
      "New Balance $100.00",
      "TIME TO PAY",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      family: "credit-card-table",
      minRows: 3,
      maxRows: 3,
      opening: true,
      closing: true,
      debitRows: 2, // both positive purchases stay debit
      creditRows: 1, // only the negative payment is credit
      balanceNull: true,
      balancePasses: true,
      note: "candidate scoring picks the simple strategy; sidebar heading does not flip purchases",
    },
  },

  // ----- Layout family A: sectioned credit-card table (CIBC-style) -----
  {
    name: "layout-cc-table-sections",
    description:
      "Sectioned credit-card table: far-right amount without $, payment slip + out-of-period date + spend report ignored, Total balance as closing; sectioned candidate wins over simple",
    text: [
      "SOME CREDIT UNION MASTERCARD",
      "Statement period January 1 to February 9, 2026",
      "Previous Balance $100.00",
      "Minimum payment due by MAR 05, 2026 $41.58",
      "Trans date Post date Description Spend Categories Amount($)",
      "Your payments",
      "JAN 05 JAN 06 PAYMENT THANK YOU Payment 100.00",
      "Your new charges and credits",
      "JAN 07 JAN 08 FAKE GROCERY STORE Groceries 50.00",
      "JAN 09 JAN 10 FAKE RESTAURANT Restaurants 30.00",
      "Your interest",
      "JAN 31 JAN 31 INTEREST ON PURCHASES Interest 5.00",
      "Total balance $85.00",
      "MAR 05 MAR 05 , 2026 41.58",
      "Spend Report",
      "Time to Pay",
    ].join("\n"),
    expect: {
      kind: "credit-card",
      family: "credit-card-table",
      candidate: "credit-card-sectioned",
      minRows: 4,
      maxRows: 4,
      opening: true,
      closing: true,
      creditRows: 1, // the payment
      debitRows: 3, // groceries, restaurant, interest
      balanceNull: true,
      balancePasses: true,
      note: "out-of-period MAR 05 slip row ignored; Total balance closing; sectioned wins via reconciliation + signal bonus",
    },
  },

  // ----- Layout family B: generic bank-account table (withdrawals/deposits/balance) -----
  {
    name: "layout-bank-table-withdrawals-deposits",
    description:
      "Bank-account table with header/period/phone junk ignored, activity-section gating, date carry-forward, and a wrapped description",
    text: [
      "SOME BANK CHEQUING ACCOUNT",
      "Statement period January 1 to January 31, 2026",
      "Account number 12345 678 9",
      "1-800-769-2511",
      "Details of your account activity",
      "Date Description Withdrawals Deposits Balance",
      "Opening Balance 2,000.00",
      "Jan 3 Payroll Deposit 1,500.00 3,500.00",
      "Jan 5 Hydro One 120.00 3,380.00",
      "Grocery Store 80.00 3,300.00",
      "Jan 9 Pre-Authorized",
      "Insurance Payment 100.00 3,200.00",
      "Jan 12 e-Transfer Received 300.00 3,500.00",
      "Closing Balance 3,500.00",
      "Important information about your account",
      "Some legal footer text with a 555.00 number.",
    ].join("\n"),
    expect: {
      kind: "bank-account",
      family: "bank-account-table",
      minRows: 5,
      maxRows: 5,
      opening: true,
      closing: true,
      creditRows: 2, // payroll, e-transfer (balance went up)
      debitRows: 3, // hydro, grocery, insurance (balance went down)
      balanceNull: false, // bank rows carry a running balance
      balancePasses: true,
      note: "headers/period/phone ignored via gating; withdrawals=debit, deposits=credit via balance delta",
    },
  },

  // ----- Bank-account balance-segment solver (amount-only rows between balances) -----
  {
    name: "bank-segment-solver",
    description:
      "Bank-account rows where several amounts appear before the next running balance. The segment solver assigns debit/credit so each segment reconciles, with carry-forward and a wrapped description.",
    text: [
      "SOME BANK CHEQUING ACCOUNT",
      "From June 1 to June 30, 2026",
      "Details of your account activity",
      "Date Description Withdrawals Deposits Balance",
      "Opening Balance 1,000.00",
      "Jun 2 Payroll Deposit 2,000.00",
      "Interac Received 500.00 3,500.00",
      "Jun 5 Pre-Authorized",
      "Hydro Payment 200.00",
      "Grocery Purchase 100.00 3,200.00",
      "Jun 8 e-Transfer Received 400.00",
      "Jun 9 ATM Withdrawal 150.00 3,450.00",
      "Closing Balance 3,450.00",
      "Important information about your account",
      "Some footer legal text 999.00",
    ].join("\n"),
    expect: {
      kind: "bank-account",
      family: "bank-account-table",
      candidate: "bank-account",
      minRows: 6,
      maxRows: 6,
      opening: true,
      closing: true,
      creditRows: 3, // payroll, interac, e-transfer
      debitRows: 3, // hydro, grocery, atm
      balanceNull: false,
      balancePasses: true,
      note: "all-credit, all-debit, and mixed segments reconcile; carry-forward + wrap join; footer ignored",
    },
  },
];
