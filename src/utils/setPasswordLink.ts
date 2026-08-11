import crypto from "crypto";
import { envConfig } from "../lib/config";

// HMAC-signed, stateless "set your password" link — same pattern as
// verifyEmailLink and buildUnsubscribeUrl. Bound to the account's current
// password hash so a link becomes invalid the moment the password is set
// (single-use without any DB tracking table). Used by admin-created accounts
// so we never email a plaintext password.

const SECRET =
  envConfig.SESSION_SECRET ||
  envConfig.BETTER_AUTH_SECRET ||
  "slingvo-set-password-secret";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

// Signature covers (email + current password hash) so once the user sets a
// new password the old link automatically stops working — no separate
// "used_at" table needed.
export function setPasswordSignature(email: string, currentPasswordHash: string | null): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${normalize(email)}::${currentPasswordHash ?? ""}`)
    .digest("hex");
}

export function isSetPasswordSignatureValid(
  email: string,
  currentPasswordHash: string | null,
  sig: string,
): boolean {
  if (!email || !sig) return false;
  const expected = setPasswordSignature(email, currentPasswordHash);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildSetPasswordUrl(email: string, currentPasswordHash: string | null): string {
  const base = (envConfig.BACKEND_URL || "").replace(/\/$/, "");
  const sig = setPasswordSignature(email, currentPasswordHash);
  return `${base}/api/user/set-password?email=${encodeURIComponent(normalize(email))}&sig=${sig}`;
}
