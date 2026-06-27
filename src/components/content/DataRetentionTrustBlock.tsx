import { Container } from "@/components/Container";

/*
  Core trust message: your statement is processed only to create your
  conversion, and is not sold or used for marketing/ads. Guided AI verification
  works from rendered statement images, not your original PDF.

  TODO(launch-blocker): any retention/deletion wording is a launch-blocker until
  the real upload/parser pipeline verifies ALL of the following in production:
    - uploaded files are not permanently stored
    - extracted transaction text is not stored
    - generated rows are not stored
    - temporary files are deleted after processing
    - production logs do not include statement contents, transaction
      descriptions, balances, account numbers, or extracted rows
  Wording is deliberately "designed so" / "we do not" rather than "instantly
  deleted" until the above are implemented and verified.
*/
export function DataRetentionTrustBlock({
  heading = "Your statement is used only to create your conversion",
  body = "Your statement is processed to create your spreadsheet file and is not sold or used for marketing or ads. We avoid using your original PDF directly as the AI input — when guided AI verification is used, it works from rendered statement evidence. Review our privacy and security pages for how uploads and conversion data are handled.",
  dark = true,
}: {
  heading?: string;
  body?: string;
  dark?: boolean;
}) {
  if (dark) {
    return (
      <section className="bg-slate-900">
        <Container className="py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {heading}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-300">{body}</p>
            <p className="mt-6 text-sm font-medium text-slate-400">
              No bank login. Not used for marketing.
            </p>
          </div>
        </Container>
      </section>
    );
  }

  return (
    <section className="bg-white">
      <Container className="py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {heading}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">{body}</p>
          <p className="mt-6 text-sm font-medium text-slate-500">
            No bank login. Not used for marketing.
          </p>
        </div>
      </Container>
    </section>
  );
}
