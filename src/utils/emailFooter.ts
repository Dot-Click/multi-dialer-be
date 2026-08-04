import { envConfig } from "../lib/config";

/**
 * Shared company-identity footer appended to every outgoing email template
 * (utils/email.ts templates + services/email.service.ts's getBaseEmailTemplate).
 * Purely additive — inserted just before each template's container closes, below
 * whatever per-template footer/copyright line already exists there. Doesn't touch
 * unsubscribe links: those are appended separately at send time (dispatchEmail
 * for SMTP sends; MailerSend's own {{unsubscribe}} footer for MailerSend sends).
 *
 * Logo: served as a static file by this backend (public/slingvo-logo.png,
 * via express.static("public") in index.ts) at BACKEND_URL/slingvo-logo.png —
 * the same env var buildUnsubscribeUrl already uses to build absolute links.
 * EMAIL_LOGO_URL can override this with a dedicated CDN/R2 URL later if
 * wanted; if neither is resolvable, the <img> is omitted rather than
 * rendering a broken-image icon.
 */
export function emailFooter(): string {
  const logoUrl =
    envConfig.EMAIL_LOGO_URL ||
    (envConfig.BACKEND_URL ? `${envConfig.BACKEND_URL.replace(/\/$/, "")}/slingvo-logo.png` : undefined);
  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="Slingvo" style="max-height:32px;margin:0 auto 12px;display:block;" />`
    : "";

  return `
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;">
            ${logoBlock}
            <p style="margin:4px 0;font-size:12px;color:#94a3b8;font-weight:600;">Slingvo LLC</p>
            <p style="margin:2px 0;font-size:12px;color:#94a3b8;">102 Wonder World Dr, San Marcos, TX 78666</p>
            <p style="margin:2px 0;font-size:12px;color:#94a3b8;">Phone: (737) 237-9535</p>
        </div>`;
}
