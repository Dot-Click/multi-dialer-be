import crypto from "crypto";
import { envConfig } from "../lib/config";

// HMAC-signed, stateless verify-email link — same pattern as the unsubscribe
// link in emailSuppression.ts. Used for admin-created accounts (agents and
// manually-created admins via /admin/create-user), which bypass Better Auth's
// own sign-up/verification flow entirely, so there's no token/session to
// piggyback on.
//
// The real MailerSend template's copy promises "this activation link
// expires in {{expiry_hours}} hours" — the link previously had no time
// component at all and never actually expired. Signature now covers
// (email + issuedAt) so it can be checked for age at verification time.

const SECRET =
  envConfig.SESSION_SECRET ||
  envConfig.BETTER_AUTH_SECRET ||
  "slingvo-verify-email-secret";

export const VERIFY_EMAIL_EXPIRY_HOURS = 48;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export function verifyEmailSignature(email: string, issuedAt: number): string {
  return crypto.createHmac("sha256", SECRET).update(`${normalize(email)}:${issuedAt}`).digest("hex");
}

export function isVerifyEmailSignatureValid(email: string, issuedAt: number, sig: string): boolean {
  if (!email || !sig || !issuedAt || Number.isNaN(issuedAt)) return false;

  const ageMs = Date.now() - issuedAt;
  if (ageMs < 0 || ageMs > VERIFY_EMAIL_EXPIRY_HOURS * 60 * 60 * 1000) return false;

  const expected = verifyEmailSignature(email, issuedAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildVerifyEmailUrl(email: string): string {
  const base = (envConfig.BACKEND_URL || "").replace(/\/$/, "");
  const issuedAt = Date.now();
  const sig = verifyEmailSignature(email, issuedAt);
  return `${base}/api/user/verify-email?email=${encodeURIComponent(normalize(email))}&sig=${sig}&t=${issuedAt}`;
}
