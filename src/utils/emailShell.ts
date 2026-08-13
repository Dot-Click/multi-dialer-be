import { envConfig } from "../lib/config";

// Shared shell replicating the client's real MailerSend-designed templates
// (sampled from the live "Team member removed" template, 3 Aug 2026).
// Every email that doesn't have its own MailerSend-hosted template uses this
// so they're visually identical to the ones that do — same card, same
// black footer, same button/badge treatment — without needing a design
// pass from Jason for each one.
//
// Variables use {{double_brace}} syntax deliberately (matches the source
// template's own convention) so this HTML would also work unmodified if
// ever uploaded as a literal MailerSend template later.

export const LOGO_URL = envConfig.EMAIL_LOGO_URL
  || (envConfig.BACKEND_URL ? `${envConfig.BACKEND_URL.replace(/\/$/, "")}/slingvo-logo.png` : "");

/** Simple {{key}} -> value substitution. Missing keys are left as-is. */
export function renderTemplate(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
}

/** The small uppercase pill at the top of the card (e.g. "SECURITY", "WELCOME ABOARD"). */
export function emailBadge(label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
  <tr>
    <td style="background-color:#FACC15;border-radius:4px;padding:5px 11px;font-family:'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;color:#000000;text-transform:uppercase;">${label}</td>
  </tr>
</table>`;
}

/** The label/value info card (e.g. Member / Email / Removed by / When). */
export function emailInfoBox(rows: { label: string; value: string }[]): string {
  const rowsHtml = rows.map(r => `
            <tr>
              <td style="padding:6px 14px 6px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#8A8A8A;white-space:nowrap;vertical-align:top;">${r.label}</td>
              <td style="padding:6px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#1A1A1A;font-weight:600;vertical-align:top;">${r.value}</td>
            </tr>`).join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 22px 0;background-color:#FFFBF3;border-left:4px solid #FACC15;border-radius:0 8px 8px 0;">
  <tr>
    <td style="padding:20px 22px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rowsHtml}
      </table>
    </td>
  </tr>
</table>`;
}

/** A numbered step row (e.g. onboarding "Getting Started" checklists). */
export function emailStep(n: number, title: string, description: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px 0;">
  <tr>
    <td width="40" valign="top" style="padding-right:14px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="32" height="32" style="background-color:#FACC15;border-radius:16px;">
        <tr><td align="center" valign="middle" style="font-family:'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#000000;">${n}</td></tr>
      </table>
    </td>
    <td valign="top">
      <p style="margin:0 0 4px 0;font-family:'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#1A1A1A;">${title}</p>
      <p style="margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#3D3D3D;">${description}</p>
    </td>
  </tr>
</table>`;
}

/** Standard body paragraph — matches the template's exact text styling. */
export function emailParagraph(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#3D3D3D;">${html}</p>`;
}

/** Small gray footnote below the button. */
export function emailFootnote(html: string): string {
  return `<p style="margin:0 0 14px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:21px;color:#8A8A8A;">${html}</p>`;
}

export interface EmailShellOptions {
  title: string;
  preheader: string;
  badgeLabel?: string;
  heading: string;
  bodyHtml: string;
  buttonText?: string;
  buttonUrl?: string;
  footnote?: string;
  /** Omit to hide the unsubscribe/preferences row entirely — used for
   * transactional/security emails (password reset, verify email, etc.)
   * that shouldn't carry an unsubscribe link at all. */
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

/**
 * The branded black footer (SLINGVO wordmark, contact info, postal address,
 * copyright, optional unsubscribe row) — extracted so getBaseEmailTemplate()
 * in email.service.ts can reuse the exact same footer instead of the plain
 * "© year Slingvo" line it shipped with (mail-tester/design audit finding:
 * those templates weren't using the branded system at all).
 */
export function emailBrandedFooter(unsubRowHtml: string = ""): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;background-color:#000000;border-radius:14px;">
  <tr>
    <td class="pad" style="padding:28px 40px 26px 40px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <p style="margin:0 0 12px 0;font-family:'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#FACC15;letter-spacing:0.4px;">SLINGVO</p>
      <p style="margin:0 0 12px 0;font-size:13px;line-height:21px;color:#C9C9C9;">
        Questions? Reply to this email, or reach us at<br />
        <a href="mailto:support@slingvo.com" style="color:#FACC15;text-decoration:none;">support@slingvo.com</a>
        <span style="color:#4A4A4A;"> &nbsp;·&nbsp; </span>
        <a href="tel:+17372379535" style="color:#FACC15;text-decoration:none;">(737) 237-9535</a>
      </p>
      <p style="margin:0 0 16px 0;font-size:12px;line-height:19px;color:#8A8A8A;">
        Slingvo LLC · 102 Wonder World Dr, San Marcos, TX 78666
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="border-top:1px solid #262626;padding-top:14px;font-size:12px;line-height:19px;color:#8A8A8A;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">© 2026 Slingvo. All rights reserved. &nbsp;·&nbsp;
            <a href="https://slingvo.com" style="color:#8A8A8A;text-decoration:underline;">slingvo.com</a>${unsubRowHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function emailShell(opts: EmailShellOptions): string {
  const {
    title, preheader, badgeLabel, heading, bodyHtml,
    buttonText, buttonUrl, footnote, unsubscribeUrl, preferencesUrl,
  } = opts;

  const badgeBlock = badgeLabel ? emailBadge(badgeLabel) : "";

  const buttonBlock = (buttonText && buttonUrl) ? `
                    <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px 0;">
                      <tr>
                        <td align="center" bgcolor="#FACC15" style="border-radius:8px;">
                          <!--[if mso]>&nbsp;<![endif]-->
                          <a href="${buttonUrl}" style="display:inline-block;padding:15px 34px;font-family:'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#000000;text-decoration:none;border-radius:8px;letter-spacing:0.2px;">${buttonText}</a>
                          <!--[if mso]>&nbsp;<![endif]-->
                        </td>
                      </tr>
                    </table>` : "";

  const footnoteBlock = footnote ? emailFootnote(footnote) : "";

  const unsubRow = unsubscribeUrl ? `
                          <br />
                          <a href="${unsubscribeUrl}" style="color:#8A8A8A;text-decoration:underline;">Unsubscribe</a>
                          <span style="color:#4A4A4A;"> &nbsp;·&nbsp; </span>
                          <a href="${preferencesUrl || `${envConfig.FRONTEND_URL}/admin/system-settings`}" style="color:#8A8A8A;text-decoration:underline;">Email preferences</a>` : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${title}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style type="text/css">
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; display:block; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background-color:#F5F1E8; }
  a { color:#2D5BE3; }
  @media screen and (max-width:620px) {
    .wrap { width:100% !important; }
    .pad { padding-left:24px !important; padding-right:24px !important; }
    .h1 { font-size:26px !important; line-height:32px !important; }
    .btn a { display:block !important; width:auto !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F5F1E8;">
  <div style="display:none;font-size:1px;color:#F5F1E8;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F1E8;">
    <tr>
      <td align="center" style="padding:28px 12px 40px 12px;">
        <table role="presentation" class="wrap" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">
          <tr>
            <td align="left" style="padding:4px 0 20px 4px;">
              <a href="https://slingvo.com" style="text-decoration:none;"><img src="${LOGO_URL}" width="150" alt="Slingvo" style="width:150px;height:auto;display:block;border:0;" /></a>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF;border-radius:14px;border:1px solid #E6E1D6;overflow:hidden;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="height:5px;background-color:#FACC15;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="pad" style="padding:36px 40px 40px 40px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
                    ${badgeBlock}
                    <h1 class="h1" style="margin:0 0 16px 0;font-family:'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:30px;line-height:36px;font-weight:800;color:#1A1A1A;letter-spacing:-0.4px;">${heading}</h1>
                    ${bodyHtml}
                    ${buttonBlock}
                    ${footnoteBlock}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              ${emailBrandedFooter(unsubRow)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
