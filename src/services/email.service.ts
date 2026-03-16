import sgMail from "@sendgrid/mail";
import { envConfig } from "../lib/config";

export interface SendEmailOptions {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends an email using SendGrid.
 * The sender email must be a verified sender in SendGrid.
 */
export async function sendEmail(options: SendEmailOptions) {
  const { to, from, subject, text, html } = options;

  const msg = {
    to,
    from: {
      email: envConfig.EMAIL_USER || "noreply@dialersaas.com",
      name: options.fromName || "Dialer System",
    },
    replyTo: from,
    subject,
    text,
    html: html || text,
  };

  console.log("[EmailService] Attempting to send email:", JSON.stringify({ ...msg, html: "[HTML_CONTENT]" }, null, 2));

  try {
    await sgMail.send(msg);
    console.log(`[EmailService] Email sent to ${to} from ${from}`);
    return { success: true };
  } catch (error: any) {
    console.error("[EmailService] Error sending email:", error);
    if (error.response) {
      console.error(error.response.body);
    }
    return { success: false, error: error.message };
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
