import type { Metadata } from "next";
import { Section } from "@/components/Section";
import { Container } from "@/components/Container";
import { UploadFlow } from "@/components/upload/UploadFlow";

export const metadata: Metadata = {
  title: "Convert a Statement",
  description:
    "Upload a digital PDF bank statement to preview the conversion to CSV, review the extracted transactions, run balance checks, and download a spreadsheet-ready file. We do not keep your bank statement data.",
  // Tool page, not a content page — keep it out of search results until the
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
    <Section>
      <UploadFlow />
      <Container className="mt-12">
        <p className="mx-auto max-w-2xl text-center text-sm text-slate-500">
          <span className="font-semibold text-slate-700">
            No bank login. No stored statement data.
          </span>{" "}
          StatementCSV is designed so your bank statement is used only to create your
          spreadsheet file. We do not keep your bank statement data.
        </p>
      </Container>
    </Section>
  );
}
