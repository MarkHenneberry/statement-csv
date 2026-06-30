import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { ensureAppAccount } from "@/lib/billing/account";
import { prisma } from "@/lib/db";
import { isStripeConfigured, getStripe } from "@/lib/stripe/server";
import { isPaidPlanKey, priceIdForPlanKey } from "@/lib/stripe/config";
import type { PlanKey } from "@/lib/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts a Stripe subscription Checkout Session for the AUTHENTICATED user. The
// price ID is resolved server-side from the validated plan key — the client never
// supplies a Stripe price ID, customer id, or user id.
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  const planKey = (body as { planKey?: unknown })?.planKey;
  if (!isPaidPlanKey(planKey)) {
    return NextResponse.json({ error: "invalid-plan" }, { status: 400 });
  }

  const priceId = priceIdForPlanKey(planKey as PlanKey);
  if (!priceId) {
    return NextResponse.json({ error: "plan-not-configured" }, { status: 500 });
  }

  try {
    const { account } = await ensureAppAccount(user);
    const stripe = getStripe();

    // Reuse the existing Stripe customer, or create one tied to this user.
    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.billingAccount.update({
        where: { userId: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Show the "Add promotion code" field so customers can redeem a Stripe
      // promotion code (e.g. a first-month-free outreach code). Codes/coupons are
      // created manually in the Stripe Dashboard, never by the app.
      allow_promotion_codes: true,
      success_url: `${appUrl}/account?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
      client_reference_id: user.id,
      metadata: { userId: user.id, planKey },
      subscription_data: { metadata: { userId: user.id, planKey } },
    });

    return NextResponse.json({ url: session.url });
  } catch {
    // Safe label only — never echo Stripe errors / ids.
    return NextResponse.json({ error: "checkout-failed" }, { status: 500 });
  }
}
