import crypto from "crypto";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";

export type SuppressionReason = "BOUNCE" | "COMPLAINT" | "UNSUBSCRIBE" | "MANUAL";

const SECRET =
  envConfig.SESSION_SECRET ||
  envConfig.BETTER_AUTH_SECRET ||
  "slingvo-unsubscribe-secret";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Returns the suppression reason for an email, or null if not suppressed.
 * Uses raw SQL so it works even before the Prisma client is regenerated.
 */
export async function getSuppression(
  email: string
): Promise<SuppressionReason | null> {
  if (!email) return null;
  const rows = await prisma.$queryRaw<{ reason: string }[]>`
    SELECT reason FROM email_suppressions WHERE email = ${normalize(email)} LIMIT 1
  `;
  return (rows[0]?.reason as SuppressionReason) ?? null;
}

/** Adds (or updates) an address on the suppression list. Idempotent. */
export async function addSuppression(
  email: string,
  reason: SuppressionReason,
  detail?: string
): Promise<void> {
  if (!email) return;
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO email_suppressions (id, email, reason, detail, "createdAt")
    VALUES (${id}, ${normalize(email)}, ${reason}, ${detail ?? null}, now())
    ON CONFLICT (email)
    DO UPDATE SET reason = ${reason}, detail = ${detail ?? null}
  `;
  console.log(`[Suppression] ${normalize(email)} suppressed (${reason})`);
}

/** Removes an address from the suppression list (e.g. manual re-subscribe). */
export async function removeSuppression(email: string): Promise<void> {
  if (!email) return;
  await prisma.$executeRaw`
    DELETE FROM email_suppressions WHERE email = ${normalize(email)}
  `;
}

// ── Unsubscribe link (HMAC-signed, stateless) ──────────────────────────────

export function unsubscribeSignature(email: string): string {
  return crypto.createHmac("sha256", SECRET).update(normalize(email)).digest("hex");
}

export function verifyUnsubscribe(email: string, sig: string): boolean {
  if (!email || !sig) return false;
  const expected = unsubscribeSignature(email);
  // constant-time compare
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildUnsubscribeUrl(email: string): string {
  const base = (envConfig.BACKEND_URL || "").replace(/\/$/, "");
  const sig = unsubscribeSignature(email);
  return `${base}/api/email/unsubscribe?email=${encodeURIComponent(
    normalize(email)
  )}&sig=${sig}`;
}
