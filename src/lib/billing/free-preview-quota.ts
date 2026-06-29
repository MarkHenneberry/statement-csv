import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  getPreviewLimits,
  evaluatePreviewAccess,
  previewWindowEnd,
  type PreviewAccessDecision,
  type PreviewUsageSnapshot,
} from "./credits";

// Server-only wiring for the free-preview quota: an opaque HttpOnly cookie (or a
// signed-in user id) identifies the subject, and a rolling-window usage row in
// Postgres enforces the page/attempt limits. Enforcement is ENTIRELY server-side —
// localStorage / client flags are never trusted. We store only a one-way HASH of
// the subject plus quota counters: no cookie value, no user id, no statement
// content (filename, text, rows, balances, images) is ever written here.

export { getPreviewLimits };

/** Opaque, HttpOnly browser cookie holding a random preview id (not the hash). */
const PREVIEW_COOKIE = "scsv_preview_id";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type PreviewSubjectType = "anonymous_cookie" | "user";
export type PreviewSubject = { subjectHash: string; subjectType: PreviewSubjectType };

/**
 * One-way hash of a preview subject. An optional server-side pepper
 * (FREE_PREVIEW_HASH_SECRET) means a leaked DB row can't be reversed to the raw
 * cookie/user id. The raw value is never stored.
 */
export function hashPreviewSubject(raw: string): string {
  const pepper = process.env.FREE_PREVIEW_HASH_SECRET ?? "";
  return createHash("sha256").update(`${pepper}|${raw}`).digest("hex");
}

/**
 * Resolve the subject for this request. Signed-in users key on their user id
 * (so the preview follows the account, not the browser); signed-out visitors key
 * on a server-generated opaque cookie, which is created here if missing. The cookie
 * is HttpOnly, Secure in production, SameSite=Lax, and carries no personal info.
 */
export async function resolvePreviewSubject(userId: string | null): Promise<PreviewSubject> {
  if (userId) {
    return { subjectHash: hashPreviewSubject(`user:${userId}`), subjectType: "user" };
  }
  const store = await cookies();
  let id = store.get(PREVIEW_COOKIE)?.value;
  if (!id) {
    id = randomBytes(18).toString("base64url");
    store.set(PREVIEW_COOKIE, id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
  }
  return { subjectHash: hashPreviewSubject(`cookie:${id}`), subjectType: "anonymous_cookie" };
}

/** The subject's current (non-expired) window row, or null if none is active. */
function getActiveWindow(subjectHash: string, now: Date) {
  return prisma.freePreviewUsage.findFirst({
    where: { subjectHash, windowEnd: { gt: now } },
    orderBy: { windowStart: "desc" },
  });
}

/** Usage recorded against the subject's current window (zeros when none/expired). */
export async function getPreviewUsageSnapshot(
  subjectHash: string,
  now: Date = new Date(),
): Promise<PreviewUsageSnapshot> {
  const w = await getActiveWindow(subjectHash, now);
  return { pagesUsed: w?.pagesUsed ?? 0, attemptsUsed: w?.attemptsUsed ?? 0 };
}

/** Evaluate the subject's quota for a PDF of `pageCount` pages (read-only). */
export async function evaluatePreviewQuota(
  subjectHash: string,
  pageCount: number,
  now: Date = new Date(),
): Promise<PreviewAccessDecision> {
  const limits = getPreviewLimits();
  const usage = await getPreviewUsageSnapshot(subjectHash, now);
  return evaluatePreviewAccess(limits, usage, pageCount);
}

/** Find the active window or open a fresh one starting now. */
async function getOrCreateActiveWindow(
  subjectHash: string,
  subjectType: PreviewSubjectType,
  now: Date,
) {
  const existing = await getActiveWindow(subjectHash, now);
  if (existing) return existing;
  const limits = getPreviewLimits();
  return prisma.freePreviewUsage.create({
    data: {
      subjectHash,
      subjectType,
      windowStart: now,
      windowEnd: previewWindowEnd(now, limits.windowHours),
      pagesUsed: 0,
      attemptsUsed: 0,
    },
  });
}

/**
 * Count one parse attempt against the window (abuse guard). Called once the gate
 * passes, BEFORE the parser runs, so even a failed/empty parse consumes an attempt.
 */
export async function recordPreviewAttempt(
  subjectHash: string,
  subjectType: PreviewSubjectType,
  now: Date = new Date(),
): Promise<void> {
  const w = await getOrCreateActiveWindow(subjectHash, subjectType, now);
  await prisma.freePreviewUsage.update({
    where: { id: w.id },
    data: { attemptsUsed: { increment: 1 } },
  });
}

/**
 * Consume preview PAGES after a usable (verified or review) result. Failed/empty
 * extractions pass 0 and record nothing. Pages are clamped to a non-negative int.
 */
export async function recordPreviewPageUsage(
  subjectHash: string,
  subjectType: PreviewSubjectType,
  pages: number,
  now: Date = new Date(),
): Promise<void> {
  const p = Math.max(0, Math.floor(pages));
  if (p === 0) return;
  const w = await getOrCreateActiveWindow(subjectHash, subjectType, now);
  await prisma.freePreviewUsage.update({
    where: { id: w.id },
    data: { pagesUsed: { increment: p } },
  });
}
