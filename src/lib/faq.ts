export type FaqItem = {
  question: string;
  answer: string;
};

// Homepage FAQ cluster — the high-intent conversion questions. Kept honest: no
// "when needed" phrasing, outcome-based result wording, and no unverified claims.
export const homeFaqs: FaqItem[] = [
  {
    question: "How do I convert a bank statement PDF to CSV?",
    answer:
      "Upload your PDF bank or credit-card statement, let StatementCSV extract the transactions, review the rows, and download a CSV with Date, Description, Debit, Credit, Amount, and Balance. It uses parser-first extraction with guided AI verification, then balance checks the result before you export.",
  },
  {
    question: "Can I convert a bank statement PDF to Excel?",
    answer:
      "Yes. You can export your reviewed transactions as CSV (opens in Excel, Google Sheets, and Numbers) or as an Excel (.xlsx) file, so you can sort, filter, and total the data for bookkeeping and review.",
  },
  {
    question: "Can I convert credit card statements to CSV?",
    answer:
      "Yes. StatementCSV handles credit-card statements as well as chequing and savings statements, pulling purchases, payments, fees, and interest into the same clean CSV or Excel structure.",
  },
  {
    question: "Does StatementCSV support Canadian bank statements?",
    answer:
      "It is designed for common Canadian bank and credit-card statement formats, including patterns like Interac e-Transfers, debits, credits, fees, and card payments. It works best with digital, text-based PDFs downloaded from your bank. We do not claim every bank or format, so anything uncertain is highlighted for review before export.",
  },
  {
    question: "What happens if the balance check does not reconcile?",
    answer:
      "A balance gap is never shown as a verified conversion. When extracted totals do not match the statement's opening and closing balances, StatementCSV asks you to review highlighted rows rather than producing a falsely balanced result. It does not invent balancing rows to force a match.",
  },
  {
    question: "Can I review transactions before exporting?",
    answer:
      "Yes. Every conversion is shown for review first. You can edit any cell, delete rows, or add a missing transaction, and uncertain rows are highlighted so you can check them before downloading the CSV or Excel file.",
  },
  {
    question: "Can I import the CSV into QuickBooks or Xero?",
    answer:
      "StatementCSV produces a standard, spreadsheet-ready CSV that you can prepare for import into accounting tools like QuickBooks, Xero, or Wave. It is not an official integration or partner; it gives you a clean file that you map to your accounting tool's import format.",
  },
];

export const generalFaqs: FaqItem[] = [
  {
    question: "Can I convert a PDF bank statement to CSV?",
    answer:
      "Yes. StatementCSV reads the transactions in a PDF bank statement and turns them into a CSV file you can open in Excel, Google Sheets, or any accounting tool. You upload the PDF, review the extracted transactions, and download the CSV.",
  },
  {
    question: "Do I need to connect my bank account?",
    answer:
      "No. You never connect a bank account or share online banking credentials. You only upload the PDF statement you already have, which keeps your login details private.",
  },
  {
    question: "Is my bank statement stored?",
    answer:
      "Your statement is processed to create your spreadsheet file and is not sold or used for marketing or ads. A formal retention, deletion, and logging policy is being finalized and must be verified in the production parser pipeline before launch.",
  },
  {
    question: "What columns are included in the CSV?",
    answer:
      "A typical export includes the transaction date, description, and amount, with separate debit and credit or a signed amount column where the statement supports it. A running balance is included when the statement lists one.",
  },
  {
    question: "Does it work with scanned statements?",
    answer:
      "Scanned bank statement support is not available yet. The converter currently works best with digital PDF statements where the transaction text is selectable. Scanning adds an image layer instead of text, so a digital download from your bank gives the most reliable result.",
  },
  {
    question: "Can I use the CSV in Excel or Google Sheets?",
    answer:
      "Yes. CSV is a universal spreadsheet format. The file opens directly in Excel, Google Sheets, Numbers, and bookkeeping tools such as QuickBooks, Xero, and Wave.",
  },
  {
    question: "Which Canadian banks are supported?",
    answer:
      "StatementCSV is built for Canadian statements first and is designed for RBC, TD, BMO, CIBC, Scotiabank, credit unions, and more. It supports common Canadian bank and credit-card statement patterns, including Interac e-Transfers, credits, debits, fees, and card payments. We do not guarantee every bank or every format yet, so when a statement needs review we show it clearly before export. Standard text-based PDFs generally convert even if your bank is not listed.",
  },
  {
    question: "Is this free?",
    answer:
      "You can run a free preview of up to 3 pages, with no account required, to see how your statement converts. Full conversions use a monthly plan: Starter is $5/month for 50 pages, Plus is $10/month for 150 pages, and Pro is $20/month for 500 pages.",
  },
  {
    question: "How does StatementCSV make money?",
    answer:
      "StatementCSV charges a small, transparent monthly fee for conversions. Because bank statements contain sensitive financial data, a paid model means we never need to sell, profile, or monetize your transactions.",
  },
  {
    question: "What are balance checks?",
    answer:
      "A balance check compares the transactions we extract against the opening and closing balances printed on your statement. When the running total does not line up, we flag it so you can spot a missing or misread transaction before you export. It is a sanity check to help catch errors, not a guarantee of perfect accuracy or any kind of financial advice.",
  },
  {
    question: "How does AI fit into the conversion?",
    answer:
      "StatementCSV is parser-first. A statement-specific parser does the extraction, and guided AI verification helps structure the result. We avoid using your original PDF directly as the AI input. When guided AI verification is used, it works from rendered statement images sent to a third-party AI provider, and the result is re-checked with balance validation. AI is used to help structure your conversion, not to train models or target ads, and you always review the rows before downloading.",
  },
  {
    question: "Are scanned statements supported?",
    answer:
      "Scanned bank statement support is not available yet. The converter currently works best with digital PDF statements where the transaction text is selectable.",
  },
  {
    question: "What happens if a statement does not convert correctly?",
    answer:
      "You review the extracted transactions before exporting, and balance checks help highlight missing or misread rows. If a statement does not convert cleanly, you can re-upload the original digital PDF from your bank, which usually gives the most reliable result. We do not claim perfect accuracy, so always review the output before relying on it.",
  },
  {
    question: "Can I convert a bank statement to Excel?",
    answer:
      "Yes. You can export your reviewed transactions as a CSV that opens directly in Excel, and Excel export is included on the Pro plan. CSV also opens in Google Sheets and Numbers, so you can sort, filter, and total the data in whatever spreadsheet you prefer.",
  },
  {
    question: "What data is extracted from the bank statement?",
    answer:
      "StatementCSV extracts the transaction rows: the date, description, debit, credit, a calculated amount, and the running balance where the statement lists one. It is focused on transaction data rather than copying the whole document.",
  },
  {
    question: "Is this different from a normal PDF to Excel converter?",
    answer:
      "Yes. A generic PDF-to-Excel tool tries to pull tables out of any document. StatementCSV is built specifically for Canadian bank statements, so it focuses on transaction rows, debit and credit columns, running balances, repeated page headers across multi-page statements, and review warnings, with balance checks to help catch missing or misread transactions.",
  },
  {
    question: "Can I use the file for bookkeeping?",
    answer:
      "Yes. A clean CSV is a good starting point for bookkeeping and reconciliation. You can categorize transactions, total expenses, and prepare the data before importing it into your accounting workflow. Always review the rows first, since we do not claim perfect accuracy.",
  },
  {
    question: "Can I import the CSV into QuickBooks or Xero?",
    answer:
      "The CSV is designed to be a clean, spreadsheet-ready file you can prepare for import into tools like QuickBooks, Xero, or Wave. StatementCSV is not an official integration or partner. It produces a standard CSV that you map to your accounting tool's import format.",
  },
  {
    question: "Is this safe for bank statements?",
    answer:
      "StatementCSV is designed for handling sensitive financial documents: there is no bank login and no selling of transaction data. Your statement is processed to create your spreadsheet file and is not used for marketing. The retention, deletion, and logging behavior of the production pipeline must be verified before launch. See the security page for details.",
  },
  {
    question: "Do you keep my bank statement data?",
    answer:
      "Your statement is processed to create your spreadsheet file; it is not sold, used for ads, or kept for marketing. A formal retention and deletion guarantee is being finalized and must be verified in the production parser pipeline before launch.",
  },
  {
    question: "Do you use my statement data for ads or training?",
    answer:
      "No. StatementCSV does not use your transaction data for ads or model training. We avoid using your original PDF directly as the AI input. When guided AI verification is used, it works from rendered statement images sent to a third-party AI provider to help structure your conversion. This handling must be clearly disclosed and verified before launch.",
  },
];
