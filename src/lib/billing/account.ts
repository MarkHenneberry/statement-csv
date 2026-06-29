import "server-only";
import { prisma } from "@/lib/db";
import { defaultFreeAccountFields } from "./credits";

/**
 * Link a validated Supabase auth user to app metadata, idempotently:
 *   - upsert a Prisma `User` keyed by the Supabase user id (so identity stays 1:1),
 *   - ensure a default free `BillingAccount` exists (created once, never duplicated).
 *
 * Called server-side with the AUTHENTICATED user only (never a client-provided id).
 * Safe to call on every account view / sign-in — the upserts are no-ops after the
 * first time. Stores only email + safe billing metadata; no statement content.
 */
export async function ensureAppAccount(authUser: { id: string; email: string }) {
  const user = await prisma.user.upsert({
    where: { id: authUser.id },
    update: { email: authUser.email },
    create: { id: authUser.id, email: authUser.email },
  });

  const account = await prisma.billingAccount.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, ...defaultFreeAccountFields() },
  });

  return { user, account };
}
