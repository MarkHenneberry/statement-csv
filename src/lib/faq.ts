export type FaqItem = {
  question: string;
  answer: string;
};

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
      "StatementCSV is designed so your statement is used only to create your spreadsheet file. We do not keep your uploaded statement, store your extracted transactions for marketing, sell your data, or use it for ads. This deletion and logging behavior must be verified in the production parser pipeline before launch.",
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
    question: "Which banks are supported?",
    answer:
      "The converter is designed to work with statements from major banks, and we publish dedicated guides for banks like RBC and TD. If your statement is a standard text-based PDF, it will generally convert even if your bank is not listed yet.",
  },
  {
    question: "Is this free?",
    answer:
      "You can run a free preview of up to 3 pages, with no account required, to see how your statement converts. Full conversions use a monthly plan: Starter is $5/month for 50 pages, Plus is $10/month for 150 pages, and Pro is $20/month for 500 pages.",
  },
  {
    question: "Why is there no ad-supported version?",
    answer:
      "Bank statements contain sensitive financial data. An ad-supported model creates pressure to track and monetize that data. We charge a small, transparent monthly fee instead so we never need to sell or profile your transactions.",
  },
  {
    question: "What are balance checks?",
    answer:
      "A balance check compares the transactions we extract against the opening and closing balances printed on your statement. When the running total does not line up, we flag it so you can spot a missing or misread transaction before you export. It is a sanity check to help catch errors, not a guarantee of perfect accuracy or any kind of financial advice.",
  },
  {
    question: "Does AI read my bank statement?",
    answer:
      "AI-assisted extraction may be used to help interpret messy or inconsistent statement layouts so transactions land in the right columns. If it is used, it is only to help structure the statement into rows for your conversion — not to train models or to target ads. You always review the extracted transactions before downloading. Any AI use must be clearly disclosed and verified before launch.",
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
      "Yes. A generic PDF-to-Excel tool tries to pull tables out of any document. StatementCSV is built specifically for bank statements, so it focuses on transaction rows, debit and credit columns, running balances, repeated page headers across multi-page statements, and review warnings — with balance checks to help catch missing or misread transactions.",
  },
  {
    question: "Can I use the file for bookkeeping?",
    answer:
      "Yes. A clean CSV is a good starting point for bookkeeping and reconciliation. You can categorize transactions, total expenses, and prepare the data before importing it into your accounting workflow. Always review the rows first, since we do not claim perfect accuracy.",
  },
  {
    question: "Can I import the CSV into QuickBooks or Xero?",
    answer:
      "The CSV is designed to be a clean, spreadsheet-ready file you can prepare for import into tools like QuickBooks, Xero, or Wave. StatementCSV is not an official integration or partner — it produces a standard CSV that you map to your accounting tool's import format.",
  },
  {
    question: "Is this safe for bank statements?",
    answer:
      "StatementCSV is designed for handling sensitive financial documents: there is no bank login, no ads, and no selling of transaction data. Your statement is used only to create your spreadsheet file. The deletion and logging behavior of the production pipeline must be verified before launch — see the security page for details.",
  },
  {
    question: "Do you keep my bank statement data?",
    answer:
      "No. StatementCSV is designed so your statement is used only to create your spreadsheet file. We do not sell transaction data, use it for ads, or keep financial records for marketing. Before launch, this deletion and logging behavior must be verified in the production parser pipeline.",
  },
  {
    question: "Do you use my statement data for ads or training?",
    answer:
      "No. StatementCSV does not use your transaction data for ads. If AI-assisted extraction is used, it should only be used to help structure the statement into rows for your conversion. This must be clearly disclosed and verified before launch.",
  },
];
