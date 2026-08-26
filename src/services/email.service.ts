// import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { envConfig } from "../lib/config";
import prisma from "../lib/prisma";
import { EmailStatus } from "@prisma/client";
import { getSuppression, buildUnsubscribeUrl } from "../utils/emailSuppression";
import { decryptSmtpPassword, SmtpPasswordDecryptError } from "../utils/encryption";
import { maskEmail } from "../utils/maskEmail";
import { emailBrandedFooter, LOGO_URL as BRAND_LOGO_URL } from "../utils/emailShell";

export interface SendEmailOptions {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  text: string;
  html?: string;

  // Marketing emails (template sends) set this — adds an unsubscribe footer and
  // makes the address eligible for UNSUBSCRIBE-based suppression.
  includeUnsubscribe?: boolean;

  // When provided, and the company has a verified SmtpConfig, the email is
  // sent through that company's own SMTP connection instead of the shared
  // MailerSend account.
  companyId?: string;

  // Explicit Reply-To address (e.g. the individual agent's email). Applied
  // regardless of which transporter (SMTP or MailerSend) ends up sending the mail.
  // Falls back to `from` if not provided, preserving prior behavior.
  replyToEmail?: string;

  // Tracking (Optional: Only log if userId is provided)
  userId?: string;
  contactId?: string;
  leadId?: string;
  templateId?: string;   // Our EmailTemplate table row (for analytics)

  // ─── MailerSend-hosted template send ──────────────────────────────────────
  // When set + transport is MailerSend, the email is rendered from the
  // dashboard-hosted template rather than our inline HTML. `variables` are
  // the merge tag values. Ignored for SMTP transport (SMTP sends fall back
  // to html/text). Distinct from `templateId` above, which is our own
  // EmailTemplate row id — MailerSend's IDs live in their dashboard.
  mailerSendTemplateId?: string;
  variables?: Record<string, string | number | boolean | null>;
}

// SES v2 client (singleton) — retired in favor of MailerSend, kept here for
// reference / easy rollback. If explicit keys are provided we use them,
// otherwise the SDK falls back to the default credential chain (env / IAM role).
// const ses = new SESv2Client({
//   region: envConfig.AWS_REGION,
//   ...(envConfig.AWS_ACCESS_KEY_ID && envConfig.AWS_SECRET_ACCESS_KEY
//     ? {
//         credentials: {
//           accessKeyId: envConfig.AWS_ACCESS_KEY_ID,
//           secretAccessKey: envConfig.AWS_SECRET_ACCESS_KEY,
//         },
//       }
//     : {}),
// });

const mailerSend = new MailerSend({ apiKey: envConfig.MAILERSEND_API_KEY || "" });

type EmailTransport =
  | { kind: "smtp"; transporter: nodemailer.Transporter; fromEmail: string; fromName: string }
  | { kind: "mailersend" };

// Tracks consecutive tenant-SMTP failures per company. Kept in memory (not DB)
// so we don't need a schema migration for this fallback; the counter resets on
// restart, which is fine — the goal is "stop hammering a dead SMTP host during
// one process's lifetime," not durable state. After SMTP_FAILURE_THRESHOLD
// misses in a row we flip SmtpConfig.isVerified=false so subsequent sends
// route straight to MailerSend and the UI can prompt the user to re-verify.
const smtpFailureCounts = new Map<string, number>();
const SMTP_FAILURE_THRESHOLD = 3;

/**
 * Resolves which transporter to send a given email through: the company's own
 * verified SMTP config if one exists for `companyId`, otherwise the shared
 * MailerSend account. Callers that don't care about the distinction can just
 * call sendEmail() — this is exposed separately for the SMTP test-send endpoint.
 */
export async function getEmailTransporter(companyId?: string): Promise<EmailTransport> {
  console.log(`[Email:transport] resolving transporter (companyId=${companyId ?? "<none>"})`);
  if (companyId) {
    const smtpConfig = await prisma.smtpConfig.findUnique({ where: { companyId } });
    if (!smtpConfig) {
      console.log(`[Email:transport] no SmtpConfig row for company ${companyId} → MailerSend`);
    } else {
      console.log(
        `[Email:transport] SmtpConfig loaded — host=${smtpConfig.host} port=${smtpConfig.port} ` +
        `secure=${smtpConfig.secure} username=${smtpConfig.username} fromEmail=${smtpConfig.fromEmail} ` +
        `isVerified=${smtpConfig.isVerified}`
      );
    }
    // Only route real sends through the tenant SMTP after it's been verified
    // via the Save & Test flow — an unverified config (freshly saved, edited
    // but never retested, or previously failing) falls back to MailerSend so
    // outbound mail keeps working instead of silently breaking.
    if (smtpConfig && !smtpConfig.isVerified) {
      console.warn(`[Email:transport] SmtpConfig for company ${companyId} is NOT verified → falling back to MailerSend`);
    }
    if (smtpConfig && smtpConfig.isVerified) {
      // Decrypt first — if SMTP_ENCRYPTION_KEY was rotated (or was never set
      // when this row was written) the stored password is unusable. Fall back
      // to MailerSend so mail keeps flowing, and log loudly so the operator
      // knows the tenant needs to re-enter their password.
      let smtpPassword: string;
      try {
        smtpPassword = decryptSmtpPassword(smtpConfig.password);
      } catch (err) {
        if (err instanceof SmtpPasswordDecryptError) {
          console.error(
            `[EmailService] Tenant SMTP for company ${companyId} could not be decrypted — falling back to MailerSend. ` +
            `The user must re-enter their SMTP password in Settings.`
          );
          return { kind: "mailersend" };
        }
        throw err;
      }
      // Honor the user's "Secure (TLS/SSL)" toggle. Port 465 is implicit TLS;
      // any other port with encryption on uses STARTTLS. With the toggle off,
      // send plaintext — some legacy servers require this and forcing STARTTLS
      // would fail the handshake.
      const useImplicitTls = smtpConfig.secure && smtpConfig.port === 465;
      // `family: 4` is accepted by nodemailer at runtime (forwarded to
      // net.createConnection) but not declared on SMTPTransport.Options —
      // see the matching cast in settings/smtp/service.ts for details.
      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: useImplicitTls,
        requireTLS: smtpConfig.secure && !useImplicitTls,
        tls: { rejectUnauthorized: false },
        auth: {
          user: smtpConfig.username,
          pass: smtpPassword,
        },
        // Timeouts are deliberately generous — some tenant SMTP hosts (Exim
        // on shared-hosting providers, in particular) reply in 2–3 second
        // chunks per command, so a full sendMail cycle can run 15–25s on a
        // good day and longer under load. Nodemailer's own defaults (2min
        // connect, 10min socket) are too long — we want to fail into the
        // retry queue eventually — but the earlier 10/10/15s values were
        // tuned for fast providers and tripped on slower hosts before the
        // send even reached DATA. family: 4 forces IPv4 at the socket
        // layer, since Railway has no outbound IPv6 route and reordering
        // DNS results via dns.setDefaultResultOrder isn't enough on its
        // own.
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 60000,
        family: 4,
      } as SMTPTransport.Options);
      console.log(
        `[Email:transport] using tenant SMTP — secure=${useImplicitTls} requireTLS=${smtpConfig.secure && !useImplicitTls}`
      );
      return { kind: "smtp", transporter, fromEmail: smtpConfig.fromEmail, fromName: smtpConfig.fromName };
    }
  }

  return { kind: "mailersend" };
}

export interface DispatchResult {
  success: boolean;
  messageId?: string | null;
  error?: string;
}

/**
 * Raw send — resolves transporter, applies unsubscribe footer, and delivers.
 * Does NOT touch EmailLog or EmailQueue. Called by sendEmail() on the hot path
 * and by the EmailQueue retry job on the cold path.
 *
 * Returns suppression errors without throwing so callers can handle them
 * without retry (suppressed addresses should go straight to DEAD).
 */
export async function dispatchEmail(options: SendEmailOptions): Promise<DispatchResult & { suppressed?: true }> {
  const { to, from, subject, text, html, companyId, replyToEmail } = options;
  console.log(
    `[Email:dispatch] start to=${maskEmail(to)} from=${from} companyId=${companyId ?? "<none>"} ` +
    `replyTo=${replyToEmail ?? "<none>"} includeUnsubscribe=${!!options.includeUnsubscribe} ` +
    `userId=${options.userId ?? "<none>"} templateId=${options.templateId ?? "<none>"}`
  );

  // Suppression gate — re-checked on every attempt so a bounce registered
  // after the initial enqueue is respected on retry.
  const suppression = await getSuppression(to);
  console.log(`[Email:dispatch] suppression check → ${suppression ?? "none"}`);
  if (suppression && (suppression !== "UNSUBSCRIBE" || options.includeUnsubscribe)) {
    const reason = `Recipient suppressed (${suppression})`;
    console.warn(`[EmailService] Skipped send to ${maskEmail(to)} — ${reason}`);
    return { success: false, error: reason, suppressed: true };
  }

  const transport = await getEmailTransporter(companyId);

  // Marketing emails get an unsubscribe mechanism (CAN-SPAM). MailerSend's
  // domain-level "Track unsubscribes" is on and auto-attaches its own
  // List-Unsubscribe header/link — that's the one whose clicks fire
  // activity.unsubscribed back to our webhook, keeping the suppression list
  // in sync automatically. Appending our own signed link here would give
  // recipients a second, competing unsubscribe path that bypasses MailerSend
  // entirely (silently, since our /api/email/unsubscribe route still "works"),
  // so it's only added for the SMTP path below, where MailerSend never sees
  // the send and therefore can't do this for us.
  let htmlBody = html || text;
  if (options.includeUnsubscribe && transport.kind === "smtp") {
    const url = buildUnsubscribeUrl(to);
    htmlBody += `<br/><br/><div style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;">If you no longer wish to receive these emails, <a href="${url}" style="color:#9ca3af;">unsubscribe here</a>.</div>`;
  }
  const fromEmail = transport.kind === "smtp" ? transport.fromEmail : (envConfig.MAILERSEND_FROM_EMAIL || envConfig.EMAIL_USER || "noreply@slingvo.com");
  const fromName  = transport.kind === "smtp" ? transport.fromName  : (options.fromName || envConfig.MAILERSEND_FROM_NAME || "Slingvo");
  const fromHeader = `${fromName} <${fromEmail}>`;
  const replyTo = transport.kind === "smtp" ? fromEmail : (replyToEmail || from || undefined);

  console.log(`[EmailService] Sending to ${maskEmail(to)} via ${transport.kind}`);
  console.log(`[Email:dispatch] envelope from="${fromHeader}" replyTo="${replyTo ?? "<none>"}" subject="${subject}"`);

  // Attempt the primary transport. On SMTP failure the caller path below falls
  // back to MailerSend so action-plan / drip mail still reaches the recipient
  // when a tenant's SMTP host is timing out or rate-limiting.
  try {
    let messageId: string | null = null;

    if (transport.kind === "smtp") {
      console.log(`[Email:dispatch] handing off to nodemailer.sendMail…`);
      const info = await transport.transporter.sendMail({ from: fromHeader, to, replyTo, subject, text, html: htmlBody });
      console.log(
        `[Email:dispatch] nodemailer accepted=${JSON.stringify(info.accepted)} ` +
        `rejected=${JSON.stringify(info.rejected)} response="${info.response}"`
      );
      messageId = info.messageId || null;
      // Successful tenant SMTP send resets the failure streak.
      if (companyId) smtpFailureCounts.set(companyId, 0);
    } else {
      messageId = await sendViaMailerSend({ to, subject, text, htmlBody, replyTo, options });
    }

    console.log(`[EmailService] Delivered to ${maskEmail(to)} (messageId: ${messageId})`);
    return { success: true, messageId };
  } catch (error: any) {
    const msg = formatSendError(error, transport.kind);
    console.error(`[EmailService] Dispatch failed for ${maskEmail(to)} via ${transport.kind}:`, msg);
    if (!error?.message) {
      console.error(`[EmailService] Raw error detail:`, JSON.stringify(error ?? null));
    }

    // Tenant SMTP just failed. Track the streak, and if we've crossed the
    // threshold flip isVerified=false so subsequent sends skip the SMTP path
    // outright until the user re-runs Save & Test. Either way, immediately
    // retry this same send through MailerSend so the recipient still gets
    // their email — an action-plan drip failing silently is what got us here.
    if (transport.kind === "smtp" && companyId) {
      const streak = (smtpFailureCounts.get(companyId) ?? 0) + 1;
      smtpFailureCounts.set(companyId, streak);
      console.warn(`[Email:dispatch] tenant SMTP failure streak for company ${companyId}: ${streak}`);
      if (streak >= SMTP_FAILURE_THRESHOLD) {
        try {
          await prisma.smtpConfig.update({
            where: { companyId },
            data: { isVerified: false, verifiedAt: null },
          });
          smtpFailureCounts.delete(companyId);
          console.warn(
            `[Email:dispatch] flipped SmtpConfig.isVerified=false for company ${companyId} ` +
            `after ${SMTP_FAILURE_THRESHOLD} consecutive failures — future sends will use MailerSend until re-verified.`
          );
        } catch (dbErr: any) {
          console.error(`[Email:dispatch] failed to flip isVerified: ${dbErr?.message}`);
        }
      }
    }

    if (transport.kind === "smtp") {
      console.warn(`[Email:dispatch] falling back to MailerSend for ${maskEmail(to)}`);
      try {
        // Build MailerSend-appropriate From: even if the tenant configured a
        // custom fromEmail, MailerSend rejects arbitrary senders — use the
        // shared workspace sender and preserve the tenant's Reply-To so
        // replies still land in the right inbox.
        const fbFromEmail = envConfig.MAILERSEND_FROM_EMAIL || envConfig.EMAIL_USER || "noreply@slingvo.com";
        const fbFromName  = options.fromName || envConfig.MAILERSEND_FROM_NAME || "Slingvo";
        const fbReplyTo   = replyToEmail || fromEmail;
        const messageId = await sendViaMailerSend({
          to, subject, text, htmlBody,
          replyTo: fbReplyTo,
          options: { ...options, fromName: fbFromName },
          fromEmail: fbFromEmail,
          fromName: fbFromName,
        });
        console.log(`[EmailService] Delivered via MailerSend fallback to ${maskEmail(to)} (messageId: ${messageId})`);
        return { success: true, messageId };
      } catch (fbErr: any) {
        const fbMsg = formatSendError(fbErr, "mailersend");
        console.error(`[EmailService] MailerSend fallback ALSO failed for ${maskEmail(to)}:`, fbMsg);
        return { success: false, error: `SMTP: ${msg} | MailerSend: ${fbMsg}` };
      }
    }

    return { success: false, error: msg };
  }
}

// Extracted so the fallback branch above can reuse the exact MailerSend send
// path without duplicating the setFrom/setTo/setSubject wiring.
async function sendViaMailerSend(args: {
  to: string;
  subject: string;
  text: string;
  htmlBody: string;
  replyTo?: string;
  options: SendEmailOptions;
  fromEmail?: string;
  fromName?: string;
}): Promise<string | null> {
  const fromEmail = args.fromEmail ?? envConfig.MAILERSEND_FROM_EMAIL ?? envConfig.EMAIL_USER ?? "noreply@slingvo.com";
  const fromName  = args.fromName  ?? args.options.fromName ?? envConfig.MAILERSEND_FROM_NAME ?? "Slingvo";
  const sentFrom = new Sender(fromEmail, fromName);
  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo([new Recipient(args.to)])
    .setSubject(args.subject);

  if (args.options.mailerSendTemplateId) {
    emailParams
      .setTemplateId(args.options.mailerSendTemplateId)
      .setPersonalization([{ email: args.to, data: args.options.variables ?? {} }]);
  } else {
    emailParams.setHtml(args.htmlBody).setText(args.text);
  }
  if (args.replyTo) emailParams.setReplyTo(new Sender(args.replyTo));

  const response = await mailerSend.email.send(emailParams);
  return (
    (response?.headers as any)?.["x-message-id"] ||
    (response?.body as any)?.message_id ||
    null
  );
}

function formatSendError(error: any, kind: "smtp" | "mailersend"): string {
  const bodyMsg =
    error?.body?.message ||
    (typeof error?.body === "string" ? error.body : null);
  return (
    error?.message ||
    (bodyMsg ? `MailerSend API ${error?.statusCode ?? "error"}: ${bodyMsg}` : null) ||
    (error?.statusCode ? `MailerSend HTTP ${error.statusCode}` : null) ||
    `Unknown ${kind === "smtp" ? "SMTP" : "MailerSend"} error`
  );
}

// Exponential-backoff delays (minutes) for each retry attempt index (0-based).
const RETRY_BACKOFF_MINUTES = [2, 10, 30];

/**
 * Sends an email via the resolved transporter and logs it to EmailLog.
 * On transient failure the email is automatically enqueued for up to
 * 3 retries with exponential back-off (2 → 10 → 30 minutes).
 *
 * Suppressed addresses are logged as FAILED immediately — they are never
 * retried since suppression is a permanent/intentional state.
 */
export async function sendEmail(options: SendEmailOptions) {
  const { to, from, subject, text, html, userId, contactId, leadId, templateId } = options;
  console.log(
    `[Email:send] enter to=${maskEmail(to)} subject="${subject}" ` +
    `userId=${userId ?? "<none>"} contactId=${contactId ?? "<none>"} templateId=${templateId ?? "<none>"}`
  );

  const result = await dispatchEmail(options);
  console.log(
    `[Email:send] dispatch result — success=${result.success} suppressed=${!!result.suppressed} ` +
    `messageId=${result.messageId ?? "<none>"} error=${result.error ?? "<none>"}`
  );

  // ── Log outcome to EmailLog ───────────────────────────────────────────────
  if (userId) {
    // For MailerSend-hosted template sends, html/text are empty (the
    // template is rendered server-side by MailerSend). Store a marker + the
    // merge variables so the analytics dashboard still shows *something*
    // meaningful instead of a blank content column.
    const content = options.mailerSendTemplateId
      ? `[MailerSend template ${options.mailerSendTemplateId}]\n${JSON.stringify(options.variables ?? {}, null, 2)}`
      : (html || text);
    try {
      const log = await prisma.emailLog.create({
        data: {
          to, from, subject,
          content,
          status:    result.success ? EmailStatus.SENT : EmailStatus.FAILED,
          error:     result.success ? null : (result.error ?? null),
          messageId: result.success ? (result.messageId ?? null) : null,
          userId, contactId, leadId, templateId,
        },
      });
      console.log(`[Email:send] EmailLog row ${log.id} written status=${log.status}`);
    } catch (dbErr) {
      console.error("[EmailService] Failed to write EmailLog:", dbErr);
    }
  } else {
    console.log(`[Email:send] no userId on options → skipping EmailLog write`);
  }

  // ── On failure, enqueue for retry (unless suppressed — those are permanent) ─
  if (!result.success && !result.suppressed) {
    try {
      const nextRetryAt = new Date(Date.now() + RETRY_BACKOFF_MINUTES[0] * 60 * 1000);
      await prisma.emailQueue.create({
        data: {
          to, from,
          fromName:           options.fromName           ?? null,
          subject,
          text,
          html:               html                       ?? null,
          replyToEmail:       options.replyToEmail       ?? null,
          includeUnsubscribe: options.includeUnsubscribe ?? false,
          companyId:          options.companyId          ?? null,
          userId:             userId                     ?? null,
          contactId:          contactId                  ?? null,
          leadId:             leadId                     ?? null,
          templateId:         templateId                 ?? null,
          attempts:   1,
          maxAttempts: 3,
          nextRetryAt,
          lastError: result.error ?? null,
        },
      });
      console.log(`[EmailService] Queued retry for ${maskEmail(to)} (next attempt in ${RETRY_BACKOFF_MINUTES[0]}m)`);
    } catch (queueErr) {
      console.error("[EmailService] Failed to enqueue retry:", queueErr);
    }
  }

  return { success: result.success, error: result.error };
}

/**
 * Generates the branded HTML shell used by the appointment/task reminder
 * jobs and Lead Store owner notifications. These shipped as plain Arial
 * on #f4f4f4 with a generic footer — nothing like the branded emailShell.ts
 * templates the rest of the app sends (design audit finding). Kept as a
 * (title, content) function so existing callers don't need to change; the
 * `.info-card`/`.info-item`/`.info-label`/`.info-value`/`.highlight` classes
 * their content HTML already uses are restyled here to the same palette
 * (cream background, yellow accent, black footer) as emailShell.ts.
 */
export function getBaseEmailTemplate(title: string, content: string) {
  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { margin:0; padding:0; background-color:#F5F1E8; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
  .content h2 { font-family:'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; color:#1A1A1A; margin:0 0 16px 0; font-size:24px; font-weight:800; }
  .content p { color:#3D3D3D; font-size:16px; margin-bottom:16px; line-height:26px; }
  .info-card { background-color:#FFFBF3; border-left:4px solid #FACC15; border-radius:0 8px 8px 0; padding:20px 22px; margin:22px 0; }
  .info-item { margin-bottom:10px; font-size:14px; }
  .info-label { font-weight:700; color:#8A8A8A; text-transform:uppercase; font-size:12px; letter-spacing:0.5px; display:inline-block; min-width:90px; }
  .info-value { color:#1A1A1A; font-weight:600; }
  .highlight { color:#B45309; }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F5F1E8;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F1E8;">
    <tr>
      <td align="center" style="padding:28px 12px 40px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">
          <tr>
            <td align="left" style="padding:4px 0 20px 4px;">
              <a href="https://slingvo.com" style="text-decoration:none;"><img src="${BRAND_LOGO_URL}" width="150" alt="Slingvo" style="width:150px;height:auto;display:block;border:0;" /></a>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF;border-radius:14px;border:1px solid #E6E1D6;overflow:hidden;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="height:5px;background-color:#FACC15;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="content" style="padding:36px 40px 40px 40px;">
                    <h2>${title}</h2>
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              ${emailBrandedFooter()}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
