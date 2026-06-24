import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { UploadFlow } from "@/components/upload/UploadFlow";

export const metadata: Metadata = {
  title: "Convert a statement",
  description:
    "Upload a digital PDF Canadian bank or credit card statement to preview the conversion, review the extracted transactions, run balance checks, and download a CSV or Excel file. We do not keep your bank statement data.",
  // Tool page, not a content page. Keep it out of search results until the
  // parser and payment flow are production-ready.
  robots: { index: false, follow: true },
};

// TODO(launch-blocker): The MVP parser prototype exists, but payment, auth, and
// the data-handling guarantees below are NOT verified. Before launch, confirm:
// uploaded files are not permanently stored, extracted text and rows are not
// stored, temporary files are deleted after processing, and production logs do
// not include statement contents, descriptions, balances, account numbers, or
// extracted rows.
export default function UploadPage() {
  return (
    // Wider, denser container than the marketing pages so the review table can use
    // most of the screen width on desktop.
    <Container size="review" className="py-6 sm:py-8">
      <UploadFlow />
      <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-slate-500">
        <span className="font-semibold text-slate-700">
          No bank login. No stored statement data.
        </span>{" "}
        StatementCSV is parser-first. Your original PDF is never handed directly to AI.
        When guided AI verification is needed, it receives limited, relevant statement
        evidence instead of the full document, and your statement is used only to create
        your spreadsheet file.
      </p>
    </Container>
  );
}
