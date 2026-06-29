import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { chargeReviewExport } from "@/lib/billing/charge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deducts page credits for exporting a REVIEW-highlighted conversion. Required
// before the client exports such a conversion. Idempotent: repeated calls return
// success without charging again. The user can only charge their OWN conversion.
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
  }
  const conversionId = (body as { conversionId?: unknown })?.conversionId;
  if (typeof conversionId !== "string" || conversionId.length === 0) {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = await chargeReviewExport(conversionId, user.id);
  if (!result.ok) {
    const status =
      result.error === "FORBIDDEN"
        ? 403
        : result.error === "NOT_FOUND"
          ? 404
          : result.error === "INSUFFICIENT_PAGE_CREDITS"
            ? 402
            : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    chargedPages: result.chargedPages,
    pagesRemaining: result.pagesRemaining,
    alreadyCharged: result.alreadyCharged,
  });
}
