import crypto from "crypto";
import { envConfig } from "../lib/config";

// HMAC-signed, stateless verify-email link — same pattern as the unsubscribe
// link in emailSuppression.ts. Used for admin-created accounts (agents and
// manually-created admins via /admin/create-user), which bypass Better Auth's
// own sign-up/verification flow entirely, so there's no token/session to
// piggyback on.

const SECRET =
  envConfig.SESSION_SECRET ||
  envConfig.BETTER_AUTH_SECRET ||
  "slingvo-verify-email-secret";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export function verifyEmailSignature(email: string): string {
  return crypto.createHmac("sha256", SECRET).update(normalize(email)).digest("hex");
}

export function isVerifyEmailSignatureValid(email: string, sig: string): boolean {
  if (!email || !sig) return false;
  const expected = verifyEmailSignature(email);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildVerifyEmailUrl(email: string): string {
  const base = (envConfig.BACKEND_URL || "").replace(/\/$/, "");
  const sig = verifyEmailSignature(email);
  return `${base}/api/user/verify-email?email=${encodeURIComponent(normalize(email))}&sig=${sig}`;
}
