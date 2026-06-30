import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isInternalTesterUser } from "@/lib/billing/credits";
import { prisma } from "@/lib/db";
import {
  buildSafeDiagnosticSummary,
  formatDiagnosticSummary,
  type DiagnosticSummaryInput,
} from "@/lib/diagnostics-report";
import { sendDiagnosticEmail } from "@/lib/diagnostics-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// INTERNAL-TESTER-ONLY: email a SAFE aggregate diagnostic summary for a flagged
// conversion. Tester status is verified server-side from the validated Supabase email
// (never trusted from the client). The incoming summary is RE-sanitized through a
// strict whitelist, so no statement content, prompts, responses, or ids can ride
// along. Nothing is stored.
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });

  // Server-side authorization — the client cannot claim tester status.
  if (!isInternalTesterUser(user.email)) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
  }
  const summaryInput = (body as { summary?: DiagnosticSummaryInput })?.summary ?? {};

  // Re-sanitize (whitelist) regardless of what the client sent.
  const safe = buildSafeDiagnosticSummary(summaryInput);

  // If a conversionId is present, it must belong to this tester.
  if (safe.conversionId) {
    const conv = await prisma.conversion.findUnique({ where: { id: safe.conversionId } }).catch(() => null);
    if (conv && conv.userId !== user.id) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
  }

  const environmentLabel = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const text = formatDiagnosticSummary(safe, {
    testerEmail: user.email,
    timestamp: new Date().toISOString(),
    environmentLabel,
  });
  const subject = `[StatementCSV diag] ${safe.status} / ${safe.source}${safe.conversionId ? ` / ${safe.conversionId}` : ""}`;

  const result = await sendDiagnosticEmail(subject, text);
  if (!result.ok) {
    // Safe label only (not-configured / send-failed). Never expose provider internals.
    return NextResponse.json({ ok: false, error: "SEND_FAILED" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
