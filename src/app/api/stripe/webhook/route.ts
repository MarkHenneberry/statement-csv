import type Stripe from "stripe";
import { getStripe, isStripeConfigured, getWebhookSecret } from "@/lib/stripe/server";
import { planKeyForPriceId, stripeStatusToInternalStatus } from "@/lib/stripe/config";
import {
  applyStripeSubscription,
  resolveUserId,
  markPastDue,
  downgradeToFree,
  type SubscriptionSnapshot,
} from "@/lib/billing/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const customerId = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null =>
  typeof c === "string" ? c : c?.id ?? null;

// Period bounds moved from the subscription to its items across Stripe API versions;
// read the item value first, then fall back to the subscription-level field.
function periodFromSubscription(sub: Stripe.Subscription): { start: number; end: number } | null {
  const item = sub.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  const subAny = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const start = item?.current_period_start ?? subAny.current_period_start;
  const end = item?.current_period_end ?? subAny.current_period_end;
  if (typeof start === "number" && typeof end === "number") return { start, end };
  return null;
}

/** Build a BillingAccount snapshot from a Stripe subscription (or null if unusable). */
async function snapshotFromSubscription(
  sub: Stripe.Subscription,
): Promise<SubscriptionSnapshot | null> {
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const planKey = priceId ? planKeyForPriceId(priceId) : null;
  const period = periodFromSubscription(sub);
  const cust = customerId(sub.customer);
  if (!planKey || !period || !cust) return null;

  const userId = await resolveUserId({
    metadataUserId: sub.metadata?.userId ?? null,
    stripeCustomerId: cust,
  });
  if (!userId) return null;

  return {
    userId,
    stripeCustomerId: cust,
    stripeSubscriptionId: sub.id,
    planKey,
    status: stripeStatusToInternalStatus(sub.status),
    periodStart: new Date(period.start * 1000),
    periodEnd: new Date(period.end * 1000),
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!isStripeConfigured() || !getWebhookSecret()) {
    return new Response("stripe-not-configured", { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing-signature", { status: 400 });

  const stripe = getStripe();
  const rawBody = await request.text(); // raw body required for signature verification

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, getWebhookSecret()!);
  } catch {
    return new Response("invalid-signature", { status: 400 });
  }

  // Log the event TYPE only — never the payload (no customer/payment details).
  console.log(`[stripe-webhook] ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          const snap = await snapshotFromSubscription(sub);
          if (snap) await applyStripeSubscription(snap);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const snap = await snapshotFromSubscription(sub);
        if (snap) await applyStripeSubscription(snap);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId({
          metadataUserId: sub.metadata?.userId ?? null,
          stripeCustomerId: customerId(sub.customer),
        });
        if (userId) await downgradeToFree(userId);
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
        const id = typeof subId === "string" ? subId : subId?.id;
        if (id) {
          const sub = await stripe.subscriptions.retrieve(id);
          const snap = await snapshotFromSubscription(sub);
          if (snap) await applyStripeSubscription(snap); // handles renewal reset
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const userId = await resolveUserId({
          stripeCustomerId: customerId(invoice.customer),
        });
        if (userId) await markPastDue(userId);
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe does not retry forever.
        break;
    }
  } catch {
    // Safe label only. Returning 500 lets Stripe retry; handlers are idempotent.
    console.error(`[stripe-webhook] handler error for ${event.type}`);
    return new Response("handler-error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
