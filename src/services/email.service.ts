import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import { envConfig } from "../lib/config";
import prisma from "../lib/prisma";
import { EmailStatus } from "@prisma/client";
import { getSuppression, buildUnsubscribeUrl } from "../utils/emailSuppression";
import { decryptSmtpPassword } from "../utils/encryption";

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
  // SES account.
  companyId?: string;

  // Explicit Reply-To address (e.g. the individual agent's email). Applied
  // regardless of which transporter (SMTP or SES) ends up sending the mail.
  // Falls back to `from` if not provided, preserving prior behavior.
  replyToEmail?: string;

  // Tracking (Optional: Only log if userId is provided)
  userId?: string;
  contactId?: string;
  leadId?: string;
  templateId?: string;
}

// SES v2 client (singleton). If explicit keys are provided we use them,
// otherwise the SDK falls back to the default credential chain (env / IAM role).
const ses = new SESv2Client({
  region: envConfig.AWS_REGION,
  ...(envConfig.AWS_ACCESS_KEY_ID && envConfig.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: envConfig.AWS_ACCESS_KEY_ID,
          secretAccessKey: envConfig.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

type EmailTransport =
  | { kind: "smtp"; transporter: nodemailer.Transporter; fromEmail: string; fromName: string }
  | { kind: "ses" };

/**
 * Resolves which transporter to send a given email through: the company's own
 * verified SMTP config if one exists for `companyId`, otherwise the shared SES
 * account. Callers that don't care about the distinction can just call
 * sendEmail() — this is exposed separately for the SMTP test-send endpoint.
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

  return { kind: "ses" };
}

/**
 * Sends an email via the resolved transporter (company SMTP if configured and
 * verified, otherwise AWS SES) and logs it to EmailLog if userId is provided.
 * `replyToEmail` (falling back to `from`) is applied as the Reply-To header
 * regardless of which transporter is used.
 */
export async function sendEmail(options: SendEmailOptions) {
  const { to, from, subject, text, html, userId, contactId, leadId, templateId, companyId, replyToEmail } = options;

  const replyTo = replyToEmail || from || undefined;

  let status: EmailStatus = EmailStatus.SENT;
  let errorMsg: string | null = null;
  let messageId: string | null = null;

  // Suppression gate. BOUNCE/COMPLAINT block ALL mail to the address.
  // UNSUBSCRIBE blocks only marketing mail (transactional, e.g. OTP, still sends).
  const suppression = await getSuppression(to);
  if (suppression && (suppression !== "UNSUBSCRIBE" || options.includeUnsubscribe)) {
    status = EmailStatus.FAILED;
    errorMsg = `Recipient suppressed (${suppression})`;
    console.warn(`[EmailService] Skipped send to ${to} — ${errorMsg}`);
    if (userId) {
      try {
        await prisma.emailLog.create({
          data: { to, from, subject, content: html || text, status, error: errorMsg, messageId: null, userId, contactId, leadId, templateId },
        });
      } catch (dbError) {
        console.error("[EmailService] Failed to log suppressed email:", dbError);
      }
    }
    return { success: false, error: errorMsg };
  }

  // Marketing emails get an unsubscribe footer (CAN-SPAM).
  let htmlBody = html || text;
  if (options.includeUnsubscribe) {
    const url = buildUnsubscribeUrl(to);
    htmlBody += `<br/><br/><div style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;">If you no longer wish to receive these emails, <a href="${url}" style="color:#9ca3af;">unsubscribe here</a>.</div>`;
  }

  const transport = await getEmailTransporter(companyId);

  const fromEmail = transport.kind === "smtp" ? transport.fromEmail : (envConfig.SES_FROM_EMAIL || envConfig.EMAIL_USER || "noreply@slingvo.com");
  const fromName = transport.kind === "smtp" ? transport.fromName : (options.fromName || envConfig.SES_FROM_NAME || "Dialer System");
  const fromHeader = `${fromName} <${fromEmail}>`;

  console.log(`[EmailService] Sending email to ${to} from ${fromHeader} via ${transport.kind} (replyTo: ${replyTo})`);

  try {
    if (transport.kind === "smtp") {
      const info = await transport.transporter.sendMail({
        from: fromHeader,
        to,
        replyTo,
        subject,
        text,
        html: htmlBody,
      });
      messageId = info.messageId || null;
    } else {
      const command = new SendEmailCommand({
        FromEmailAddress: fromHeader,
        Destination: { ToAddresses: [to] },
        ReplyToAddresses: replyTo ? [replyTo] : undefined,
        ...(envConfig.SES_CONFIGURATION_SET
          ? { ConfigurationSetName: envConfig.SES_CONFIGURATION_SET }
          : {}),
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: htmlBody, Charset: "UTF-8" },
              Text: { Data: text, Charset: "UTF-8" },
            },
          },
        },
      });

      const response = await ses.send(command);
      messageId = response.MessageId || null;
    }

    console.log(`[EmailService] Email sent to ${to} (messageId: ${messageId})`);
    return { success: true };
  } catch (error: any) {
    status = EmailStatus.FAILED;
    errorMsg = error?.message || `Unknown ${transport.kind === "smtp" ? "SMTP" : "SES"} error`;
    console.error(`[EmailService] Error sending email via ${transport.kind}:`, error);
    return { success: false, error: errorMsg };
  } finally {
    // Log to DB only if userId is provided
    if (userId) {
      try {
        await prisma.emailLog.create({
          data: {
            to,
            from,
            subject,
            content: html || text,
            status,
            error: errorMsg,
            messageId,
            userId,
            contactId,
            leadId,
            templateId
          }
        });
      } catch (dbError) {
        console.error("[EmailService] Failed to log email history to DB:", dbError);
      }
    }
  }
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
