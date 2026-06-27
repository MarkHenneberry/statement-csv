import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { UploadFlow } from "@/components/upload/UploadFlow";

export const metadata: Metadata = {
  title: "Convert a statement",
  description:
    "Upload a digital PDF Canadian bank or credit card statement to preview the conversion, review the extracted transactions, run balance checks, and download a CSV or Excel file. Your statement is processed to create your conversion and is not used for marketing.",
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
    <Container size="review" className="py-4 sm:py-6">
      <UploadFlow />
      <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-slate-500">
        <span className="font-semibold text-slate-700">
          No bank login. Not used for marketing.
        </span>{" "}
        StatementCSV is parser-first. We avoid using your original PDF directly as the AI
        input — when guided AI verification is used, it works from rendered statement
        images, and your statement is processed to create your spreadsheet file.
      </p>
    </Container>
  );
}
