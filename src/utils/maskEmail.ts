/**
 * Redacts an email address for logging — keeps enough to spot a pattern
 * (e.g. "which account/domain") without writing full recipient PII to
 * plaintext application logs.
 *
 * "jo***@example.com" for a normal address, "***@example.com" for a
 * 1-2 char local part, "invalid-email" passed through unchanged.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return String(email);
  const at = email.indexOf("@");
  if (at <= 0) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length > 2 ? local.slice(0, 2) : "";
  return `${visible}***@${domain}`;
}
