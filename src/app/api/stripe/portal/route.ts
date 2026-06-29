import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { isStripeConfigured, getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opens a Stripe Billing Portal session for the authenticated user (manage/cancel
// their subscription). Requires an existing Stripe customer id on their account.
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ error: "not-configured" }, { status: 503 });

  const account = await prisma.billingAccount.findUnique({
    where: { userId: user.id },
    select: { stripeCustomerId: true },
  });
  if (!account?.stripeCustomerId) {
    return NextResponse.json({ error: "no-customer" }, { status: 400 });
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${appUrl}/account`,
    });
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "portal-failed" }, { status: 500 });
  }
}
