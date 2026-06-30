import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { ensureAppAccount } from "@/lib/billing/account";
import {
  getPreviewLimits,
  isInternalTesterUser,
  getInternalTesterAllowance,
  effectiveMonthlyAllowance,
  effectiveRemainingPages,
} from "@/lib/billing/credits";
import {
  resolvePreviewSubject,
  getPreviewUsageSnapshot,
} from "@/lib/billing/free-preview-quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only status for the upload screen: how many pages the visitor may still
// convert, under either the paid plan (signed-in with an allowance) or the free
// preview (signed-out OR signed-in free). Establishes the anonymous preview cookie
// on first visit. SAFE METADATA ONLY — no statement content, no email, no ids.
export async function GET(): Promise<NextResponse> {
  const authUser = await getAuthenticatedUser();

  // Paid path: signed-in with a monthly allowance (or an internal tester, whose
  // effective allowance is high). Reported as "paid" so the header/upload pill shows
  // the remaining page credits rather than the free-preview count.
  if (authUser) {
    try {
      const { account } = await ensureAppAccount(authUser);
      const internalTester = isInternalTesterUser(authUser.email);
      const testerOpts = { internalTester, testerAllowance: internalTester ? getInternalTesterAllowance() : 0 };
      const allowance = effectiveMonthlyAllowance(account, testerOpts);
      if (allowance > 0) {
        return NextResponse.json({
          mode: "paid" as const,
          signedIn: true,
          paidPagesRemaining: effectiveRemainingPages(account, testerOpts),
          monthlyPageAllowance: allowance,
        });
      }
    } catch {
      // Fall through to the free-preview status below.
    }
  }

  // Free-preview path (signed-out, or signed-in without an allowance). This also
  // sets the HttpOnly cookie for anonymous visitors on first load.
  const limits = getPreviewLimits();
  let previewPagesRemaining = limits.pageLimit;
  try {
    const subject = await resolvePreviewSubject(authUser?.id ?? null);
    const usage = await getPreviewUsageSnapshot(subject.subjectHash);
    previewPagesRemaining = Math.max(0, limits.pageLimit - usage.pagesUsed);
  } catch {
    // No DB / transient error: report the full allowance (the parse route still
    // enforces the real quota server-side before any work).
  }

  return NextResponse.json({
    mode: "preview" as const,
    signedIn: authUser != null,
    previewPageLimit: limits.pageLimit,
    previewWindowHours: limits.windowHours,
    previewPagesRemaining,
  });
}
