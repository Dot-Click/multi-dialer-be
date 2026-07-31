// import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";
import nodemailer from "nodemailer";
import { envConfig } from "../lib/config";
import prisma from "../lib/prisma";
import { EmailStatus } from "@prisma/client";
import { getSuppression, buildUnsubscribeUrl } from "../utils/emailSuppression";
import { decryptSmtpPassword } from "../utils/encryption";
import { maskEmail } from "../utils/maskEmail";

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
  templateId?: string;
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

/**
 * Resolves which transporter to send a given email through: the company's own
 * verified SMTP config if one exists for `companyId`, otherwise the shared
 * MailerSend account. Callers that don't care about the distinction can just
 * call sendEmail() — this is exposed separately for the SMTP test-send endpoint.
 */
export async function getEmailTransporter(companyId?: string): Promise<EmailTransport> {
  if (companyId) {
    const smtpConfig = await prisma.smtpConfig.findUnique({ where: { companyId } });
    if (smtpConfig) {
      const smtpSecure = smtpConfig.port === 465 ? true : false;
      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpSecure,
        requireTLS: !smtpSecure,
        tls: { rejectUnauthorized: false },
        auth: {
          user: smtpConfig.username,
          pass: decryptSmtpPassword(smtpConfig.password),
        },
      });
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

  // Suppression gate — re-checked on every attempt so a bounce registered
  // after the initial enqueue is respected on retry.
  const suppression = await getSuppression(to);
  if (suppression && (suppression !== "UNSUBSCRIBE" || options.includeUnsubscribe)) {
    const reason = `Recipient suppressed (${suppression})`;
    console.warn(`[EmailService] Skipped send to ${maskEmail(to)} — ${reason}`);
    return { success: false, error: reason, suppressed: true };
  }

  // Marketing emails get an unsubscribe footer (CAN-SPAM).
  let htmlBody = html || text;
  if (options.includeUnsubscribe) {
    const url = buildUnsubscribeUrl(to);
    htmlBody += `<br/><br/><div style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;">If you no longer wish to receive these emails, <a href="${url}" style="color:#9ca3af;">unsubscribe here</a>.</div>`;
  }

  const transport = await getEmailTransporter(companyId);
  const fromEmail = transport.kind === "smtp" ? transport.fromEmail : (envConfig.MAILERSEND_FROM_EMAIL || envConfig.EMAIL_USER || "noreply@slingvo.com");
  const fromName  = transport.kind === "smtp" ? transport.fromName  : (options.fromName || envConfig.MAILERSEND_FROM_NAME || "Dialer System");
  const fromHeader = `${fromName} <${fromEmail}>`;
  const replyTo = transport.kind === "smtp" ? fromEmail : (replyToEmail || from || undefined);

  console.log(`[EmailService] Sending to ${maskEmail(to)} via ${transport.kind}`);

  try {
    let messageId: string | null = null;

    if (transport.kind === "smtp") {
      const info = await transport.transporter.sendMail({ from: fromHeader, to, replyTo, subject, text, html: htmlBody });
      messageId = info.messageId || null;
    } else {
      // --- Retired SES send path (kept for reference / easy rollback) ---
      // const command = new SendEmailCommand({ ... });
      // const response = await ses.send(command);
      // messageId = response.MessageId || null;

      const sentFrom = new Sender(fromEmail, fromName);
      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo([new Recipient(to)])
        .setSubject(subject)
        .setHtml(htmlBody)
        .setText(text);
      if (replyTo) emailParams.setReplyTo(new Sender(replyTo));

      const response = await mailerSend.email.send(emailParams);
      messageId =
        (response?.headers as any)?.["x-message-id"] ||
        (response?.body as any)?.message_id ||
        null;
    }

    console.log(`[EmailService] Delivered to ${maskEmail(to)} (messageId: ${messageId})`);
    return { success: true, messageId };
  } catch (error: any) {
    // MailerSend SDK errors arrive as { statusCode, body: { message, errors } }
    // rather than a standard Error, so error.message is often undefined.
    const bodyMsg =
      error?.body?.message ||
      (typeof error?.body === "string" ? error.body : null);
    const msg =
      error?.message ||
      (bodyMsg ? `MailerSend API ${error?.statusCode ?? "error"}: ${bodyMsg}` : null) ||
      (error?.statusCode ? `MailerSend HTTP ${error.statusCode}` : null) ||
      `Unknown ${transport.kind === "smtp" ? "SMTP" : "MailerSend"} error`;
    console.error(`[EmailService] Dispatch failed for ${maskEmail(to)}:`, msg);
    // Log the raw error body when we had to fall back to a generic message,
    // so the actual MailerSend reason is visible in the logs.
    if (!error?.message) {
      console.error(`[EmailService] Raw error detail:`, JSON.stringify(error ?? null));
    }
    return { success: false, error: msg };
  }
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

  const result = await dispatchEmail(options);

  // ── Log outcome to EmailLog ───────────────────────────────────────────────
  if (userId) {
    try {
      await prisma.emailLog.create({
        data: {
          to, from, subject,
          content: html || text,
          status:    result.success ? EmailStatus.SENT : EmailStatus.FAILED,
          error:     result.success ? null : (result.error ?? null),
          messageId: result.success ? (result.messageId ?? null) : null,
          userId, contactId, leadId, templateId,
        },
      });
    } catch (dbErr) {
      console.error("[EmailService] Failed to write EmailLog:", dbErr);
    }
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
 * Generates a premium HTML email template.
 */
export function getBaseEmailTemplate(title: string, content: string) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f7fa; }
        .container { max-width: 600px; margin: 40px auto; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.1); background-color: #ffffff; border: 1px solid #e2e8f0; }
        .content { padding: 40px; background-color: #ffffff; }
        .content h2 { color: #1f2937; margin-top: 0; font-size: 22px; font-weight: 600; }
        .content p { color: #4b5563; font-size: 16px; margin-bottom: 24px; line-height: 1.8; }
        .info-card { background-color: #f8fafc; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0; margin: 30px 0; }
        .info-item { margin-bottom: 12px; font-size: 15px; display: flex; align-items: center; }
        .info-label { font-weight: 700; color: #64748b; width: 120px; text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; }
        .info-value { color: #1e293b; font-weight: 500; flex: 1; }
        .footer { background-color: #f8fafc; color: #94a3b8; padding: 30px; text-align: center; font-size: 13px; border-top: 1px solid #f1f5f9; }
        .footer p { margin: 5px 0; }
        .highlight { color: #4f46e5; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="content">
          <h2>${title}</h2>
          ${content}
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} CallScout. All rights reserved.</p>
          <p>Professional Appointment Management</p>
        </div>
      </div>
    </body>
    </html>
  `;
}
