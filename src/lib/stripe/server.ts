import "server-only";
import Stripe from "stripe";

// Server-only Stripe client. The secret key + webhook secret are read from server
// env only and are NEVER exposed to the browser. The client is created lazily so
// the app builds without Stripe configured.

let cached: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }
  if (!cached) {
    // Omit apiVersion so the SDK uses its pinned default (avoids version drift).
    cached = new Stripe(key);
  }
  return cached;
}

export function getWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET ?? null;
}
