import { envConfig } from "../lib/config";
import { emailFooter } from "./emailFooter";
import { emailShell, emailInfoBox, emailParagraph, emailStep } from "./emailShell";
import { buildUnsubscribeUrl } from "./emailSuppression";
import { htmlToPlainText } from "./htmlToText";
export const otpTemp = (OTP: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
        }
        .container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            color: #2c3e50;
        }
        .otp-code {
            background-color: #f8f9fa;
            border: 2px dashed #007bff;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
            border-radius: 8px;
        }
        .otp-number {
            font-size: 32px;
            font-weight: bold;
            color: #007bff;
            letter-spacing: 5px;
        }
        .message {
            text-align: center;
            margin: 20px 0;
        }
        .warning {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            color: #856404;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">Your App Name</div>
        </div>
        
        <div class="message">
            <h2>OTP Verification</h2>
            <p>Your One-Time Password (OTP) for verification is:</p>
        </div>
        
        <div class="otp-code">
            <div class="otp-number">${OTP}</div>
        </div>
        
        <div class="message">
            <p>This OTP will expire in <strong>10 minutes</strong>.</p>
            <p>Please enter this code to complete your verification process.</p>
        </div>
        
        <div class="warning">
            <strong>Security Notice:</strong> Never share this OTP with anyone. Our team will never ask for your OTP.
        </div>
        
        <div class="footer">
            <p>If you didn't request this OTP, please ignore this email.</p>
            <p>© 2024 Your App Name. All rights reserved.</p>
        </div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const welcomeTemp = (email: string, setPasswordUrl: string) => emailShell({
    title: "Welcome to Slingvo",
    preheader: "Your Slingvo account is ready — set your password to activate it.",
    badgeLabel: "Welcome aboard",
    heading: "Your account is ready.",
    bodyHtml:
        emailParagraph(`Your Slingvo account has been created. Activate it below and you can be dialing in about two minutes.`) +
        emailInfoBox([{ label: "Email", value: email }]),
    buttonText: "Set Password",
    buttonUrl: setPasswordUrl,
    footnote: "This link is single-use and stops working the moment you set your password. If you didn't expect this email, please ignore it.",
})

// Merged welcome + payment-setup email. QA finding: sending welcomeTemp and
// the payment-setup email separately fired two emails a second apart with
// conflicting calls to action, handing over account credentials for an
// account the user couldn't use until they paid. One email, two ordered
// steps, one primary button (set password first — that's the blocking step).
export const welcomeWithPaymentSetupTemp = (email: string, setPasswordUrl: string, paymentUrl: string) => emailShell({
    title: "Welcome to Slingvo",
    preheader: "Set your password and complete payment setup to activate your account.",
    badgeLabel: "Welcome aboard",
    heading: "Two steps to activate your account.",
    bodyHtml:
        emailInfoBox([{ label: "Email", value: email }]) +
        emailStep(1, "Set your password", "Click the button below to set your password and verify your account.") +
        emailStep(2, "Complete payment setup", `Your account includes a <strong>30-day free trial</strong> — no charge until it ends. <a href="${paymentUrl}" style="color:#2D5BE3;font-weight:600;">Complete payment setup</a> to keep dialing after the trial.`),
    buttonText: "Set Password",
    buttonUrl: setPasswordUrl,
    footnote: `The set-password link is single-use. If the payment link above doesn't work, copy and paste this into your browser: <a href="${paymentUrl}" style="color:#2D5BE3;word-break:break-all;">${paymentUrl}</a>`,
})

function leadSheetQABlock(question: string, answerHtml: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px 0;background-color:#FFFBF3;border-left:4px solid #FACC15;border-radius:0 8px 8px 0;">
  <tr>
    <td style="padding:16px 20px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <p style="margin:0 0 6px 0;font-weight:600;color:#1A1A1A;font-size:14px;">${question}</p>
      <p style="margin:0;color:#3D3D3D;font-size:14px;">${answerHtml}</p>
    </td>
  </tr>
</table>`;
}

export const leadSheetEmailTemp = (contactName: string, leadSheetTitle: string, questions: { text: string, answer: any }[]) => emailShell({
    title: `Lead Sheet: ${leadSheetTitle}`,
    preheader: `Lead sheet for ${contactName} — ${leadSheetTitle}`,
    badgeLabel: "Lead sheet",
    heading: leadSheetTitle,
    bodyHtml:
        emailParagraph(`Contact: <strong>${contactName}</strong>`) +
        questions.map(q => leadSheetQABlock(
            q.text,
            q.answer
                ? (Array.isArray(q.answer) ? q.answer.join(", ") : q.answer)
                : `<span style="font-style:italic;color:#8A8A8A;">No answer provided</span>`,
        )).join(""),
})

export const newUserSignupTemp = (userEmail: string, signupTime: string) => emailShell({
    title: "New User Signup Notification",
    preheader: `A new user signed up: ${userEmail}`,
    badgeLabel: "New signup",
    heading: "A new user signed up.",
    bodyHtml: emailInfoBox([
        { label: "Email", value: userEmail },
        { label: "Signup time", value: signupTime },
    ]),
})

export const loginAlertTemp = (userEmail: string, loginTime: string) => emailShell({
    title: "User Login Alert",
    preheader: `${userEmail} just logged in to Slingvo.`,
    badgeLabel: "Security",
    heading: "A user logged in.",
    bodyHtml: emailInfoBox([
        { label: "Account", value: userEmail },
        { label: "Login time", value: loginTime },
    ]),
})

export const emailChangeConfirmationTemp = (fullName: string, oldEmail: string, newEmail: string, confirmUrl: string) => emailShell({
    title: "Confirm Your New Email - Slingvo",
    preheader: "Confirm your new Slingvo email address.",
    badgeLabel: "Security",
    heading: "Confirm your email change.",
    bodyHtml:
        emailParagraph(`Hi ${fullName},</br>You requested to change the email address on your Slingvo account. Click below to confirm — until you do, your account keeps using the current address.`) +
        emailInfoBox([
            { label: "Current", value: oldEmail },
            { label: "New", value: newEmail },
        ]),
    buttonText: "Confirm Email Change",
    buttonUrl: confirmUrl,
    footnote: "If you didn't request this, you can safely ignore this email — no change will be made.",
})

// Rewritten to drop the plaintext-password "account details" format entirely
// (P0 security finding — same class of issue already fixed on the invite/
// welcome flows). This is Better Auth's own sendVerificationEmail callback;
// it now uses the real verification URL Better Auth generates for the
// callback, instead of ignoring it and building a fake "login" link that
// carried the account's password in the clear.
export const emailVerificationTemp = (fullName: string, email: string, verifyUrl: string) => emailShell({
    title: "Verify your Slingvo email address",
    preheader: "Please verify your Slingvo email address.",
    badgeLabel: "Security",
    heading: "Verify your email address.",
    bodyHtml: emailParagraph(`Hi ${fullName || "there"}, please confirm <strong>${email}</strong> is your email address by clicking the button below.`),
    buttonText: "Verify Email",
    buttonUrl: verifyUrl,
    footnote: "If you didn't expect this email, you can safely ignore it.",
})

// ── Admin / lifecycle notification templates ──────────────────────────────────

export const memberAddedTemp = (adminName: string, agentName: string, agentEmail: string) => emailShell({
    title: "Member Added - Slingvo",
    preheader: `A new member was added to your workspace.`,
    badgeLabel: "Workspace update",
    heading: "A new team member was added.",
    bodyHtml:
        emailParagraph(`Hi ${adminName}, a new member has been added to your Slingvo workspace.`) +
        emailInfoBox([
            { label: "Name", value: agentName },
            { label: "Email", value: agentEmail },
        ]),
})

export const roleChangedTemp = (userName: string, oldRole: string, newRole: string) => emailShell({
    title: "Role Updated - Slingvo",
    preheader: "Your Slingvo role has been updated.",
    badgeLabel: "Workspace update",
    heading: "Your role has been updated.",
    bodyHtml:
        emailParagraph(`Hi ${userName}, your role in Slingvo has been changed.`) +
        emailInfoBox([
            { label: "Previous role", value: oldRole },
            { label: "New role", value: newRole },
        ]),
})

export const workspaceCreatedTemp = (ownerName: string, adminEmail: string, adminName: string) => emailShell({
    title: "New Workspace - Slingvo",
    preheader: "A new customer workspace has been provisioned.",
    badgeLabel: "Workspace update",
    heading: "A new workspace was created.",
    bodyHtml:
        emailParagraph(`Hi ${ownerName}, a new customer workspace has been provisioned on Slingvo.`) +
        emailInfoBox([
            { label: "Name", value: adminName },
            { label: "Email", value: adminEmail },
        ]),
})

export const inactivityNudgeTemp = (fullName: string, loginUrl: string, email: string) => emailShell({
    title: "We miss you - Slingvo",
    preheader: "We haven't seen you in a while.",
    badgeLabel: "Just checking in",
    heading: "We haven't seen you in a while.",
    bodyHtml: emailParagraph(`Hi ${fullName}, it's been a few days since you last logged in to Slingvo. Your leads and team are waiting — jump back in whenever you're ready.`),
    buttonText: "Log back in",
    buttonUrl: loginUrl,
    unsubscribeUrl: buildUnsubscribeUrl(email),
})

export const subscribeReminderTemp = (fullName: string, subscribeUrl: string, email: string) => emailShell({
    title: "Complete your setup - Slingvo",
    preheader: "Your account is ready — activate it now.",
    badgeLabel: "Account update",
    heading: "Your account is ready — activate it now.",
    bodyHtml: emailParagraph(`Hi ${fullName}, your Slingvo account is set up, but you haven't started your subscription yet. Activate your plan to unlock your dialer, contacts, and team tools.`),
    buttonText: "Activate my plan",
    buttonUrl: subscribeUrl,
    unsubscribeUrl: buildUnsubscribeUrl(email),
})

export const reactivationTemp = (fullName: string, resubscribeUrl: string, email: string) => emailShell({
    title: "Come back to Slingvo",
    preheader: "Your Slingvo access has ended — come back anytime.",
    badgeLabel: "Account update",
    heading: "Your access has ended — come back anytime.",
    bodyHtml: emailParagraph(`Hi ${fullName}, your Slingvo subscription is no longer active. Resubscribe to regain access to your dialer, contacts, and all your team's data.`),
    buttonText: "Resubscribe now",
    buttonUrl: resubscribeUrl,
    unsubscribeUrl: buildUnsubscribeUrl(email),
})

export const paymentFailedTemp = (fullName: string, amount: string, billingUrl: string) => emailShell({
    title: "Payment Failed - Slingvo",
    preheader: "Your Slingvo payment failed — please update your payment method.",
    badgeLabel: "Payment failed",
    heading: "Your payment failed.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, we were unable to process your latest Slingvo subscription payment of <strong>$${amount}</strong>. Please update your payment method to avoid interruption of service.`) +
        emailInfoBox([{ label: "Amount due", value: `$${amount}` }]),
    buttonText: "Update Payment Method",
    buttonUrl: billingUrl,
})

export const paymentSucceededTemp = (fullName: string, amount: string, billingUrl: string) => emailShell({
    title: "Payment Received - Slingvo",
    preheader: "We've received your Slingvo payment.",
    badgeLabel: "Payment received",
    heading: "Payment received.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, thanks — we've received your Slingvo subscription payment.`) +
        emailInfoBox([{ label: "Amount paid", value: `$${amount}` }]),
    buttonText: "View Billing Details",
    buttonUrl: billingUrl,
})

export const subscriptionCancelledTemp = (fullName: string, planName: string, billingUrl: string) => emailShell({
    title: "Subscription Cancelled - Slingvo",
    preheader: "Your Slingvo subscription has been cancelled.",
    badgeLabel: "Billing",
    heading: "Your subscription has been cancelled.",
    bodyHtml: emailParagraph(`Hi ${fullName}, your <strong>${planName}</strong> subscription has been cancelled and your account access has ended. If this wasn't intentional, you can resubscribe at any time.`),
    buttonText: "Resubscribe",
    buttonUrl: billingUrl,
})

export const subscriptionChangedTemp = (
    fullName: string,
    direction: "upgraded" | "downgraded",
    oldPlan: string,
    newPlan: string,
    amount: string,
    billingUrl: string,
) => emailShell({
    title: `Subscription ${direction === "upgraded" ? "Upgraded" : "Downgraded"} - Slingvo`,
    preheader: `Your Slingvo subscription was ${direction}.`,
    badgeLabel: "Billing",
    heading: `Your subscription was ${direction}.`,
    bodyHtml:
        emailParagraph(`Hi ${fullName}, your Slingvo subscription changed from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong>.`) +
        emailInfoBox([{ label: "New amount", value: `$${amount}` }]),
    buttonText: "View Billing Details",
    buttonUrl: billingUrl,
})

export const gettingStartedTemp = (fullName: string, dashboardUrl: string) => emailShell({
    title: "Get Started with Slingvo",
    preheader: "Here's how to get started with Slingvo.",
    badgeLabel: "Getting started",
    heading: "Here's how to get started.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, your Slingvo workspace is ready. Follow these steps to get up and running quickly:`) +
        emailStep(1, "Set up your caller IDs", "Add the phone numbers your agents will dial from. Go to <strong>Settings → Phone Numbers</strong> to configure your lines.") +
        emailStep(2, "Invite your agents", "Add your team under <strong>Team Management</strong>. Each agent gets their own login and call queue.") +
        emailStep(3, "Import your contacts", "Upload a CSV of leads or add contacts manually from <strong>Contacts</strong>. This is what your agents will dial through.") +
        emailStep(4, "Launch a campaign", "Create a campaign, assign contacts and agents, and start dialing. Monitor progress in real time from your <strong>Dashboard</strong>."),
    buttonText: "Go to Dashboard",
    buttonUrl: dashboardUrl,
    footnote: "Need help? Reach out to our support team anytime — we're here to make sure you succeed.",
})

export const trialStartedTemp = (fullName: string, trialEndDate: string, dashboardUrl: string) => emailShell({
    title: "Your Free Trial Has Started - Slingvo",
    preheader: "Your 30-day free trial has started.",
    badgeLabel: "Trial started",
    heading: "Your 30-day free trial has started!",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, welcome to Slingvo! Your free trial is now active — explore every feature for the next 30 days, no charge.`) +
        emailInfoBox([{ label: "Trial ends", value: trialEndDate }]) +
        emailParagraph("After your trial, you'll be moved to your selected plan. You can manage or cancel any time from your billing page."),
    buttonText: "Go to Dashboard",
    buttonUrl: dashboardUrl,
})

export const subscriptionActivatedTemp = (fullName: string, planName: string, dashboardUrl: string) => emailShell({
    title: "Subscription Activated - Slingvo",
    preheader: "Your subscription is now active.",
    badgeLabel: "Billing",
    heading: "Your subscription is now active.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, your Slingvo subscription has been activated. You now have full access to all features on your plan.`) +
        emailInfoBox([{ label: "Active plan", value: planName }]),
    buttonText: "Go to Dashboard",
    buttonUrl: dashboardUrl,
})

export const trialEndingSoonTemp = (fullName: string, daysLeft: number, billingUrl: string) => emailShell({
    title: "Your Trial Ends Soon - Slingvo",
    preheader: `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
    badgeLabel: "Trial ending",
    heading: `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
    bodyHtml:
        emailParagraph(`Hi ${fullName}, your Slingvo free trial is almost over. After it ends, you'll be charged for your selected plan to keep full access.`) +
        emailInfoBox([{ label: "Remaining", value: `${daysLeft} day${daysLeft === 1 ? "" : "s"}` }]) +
        emailParagraph("Make sure your billing details are up to date to continue without interruption."),
    buttonText: "Review Billing",
    buttonUrl: billingUrl,
})

export const subscriptionPausedTemp = (fullName: string, billingUrl: string) => emailShell({
    title: "Subscription Paused - Slingvo",
    preheader: "Your Slingvo subscription has been paused.",
    badgeLabel: "Billing",
    heading: "Your subscription has been paused.",
    bodyHtml: emailParagraph(`Hi ${fullName}, your Slingvo subscription is currently paused. Your account access is limited while the subscription is on hold. To restore full access, visit your billing page and reactivate your plan.`),
    buttonText: "Reactivate Subscription",
    buttonUrl: billingUrl,
})

export const subscriptionExpiredTemp = (fullName: string, billingUrl: string) => emailShell({
    title: "Subscription Expired - Slingvo",
    preheader: "Your Slingvo subscription has expired.",
    badgeLabel: "Billing",
    heading: "Your subscription has expired.",
    bodyHtml: emailParagraph(`Hi ${fullName}, your subscription has expired due to an incomplete payment. Access to Slingvo features has been suspended. Resubscribe at any time to restore your account.`),
    buttonText: "Resubscribe Now",
    buttonUrl: billingUrl,
})

export const paymentReceiptTemp = (fullName: string, amount: string, invoiceNumber: string, billingUrl: string) => emailShell({
    title: "Payment Receipt - Slingvo",
    preheader: "Your Slingvo payment receipt.",
    badgeLabel: "Receipt",
    heading: "Payment Receipt",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, thank you! Your payment has been received. Here is your receipt.`) +
        emailInfoBox([
            { label: "Invoice", value: invoiceNumber },
            { label: "Amount paid", value: `$${amount}` },
        ]),
    buttonText: "View Billing History",
    buttonUrl: billingUrl,
})

export const subscriptionRenewedTemp = (fullName: string, planName: string, amount: string, invoiceNumber: string, billingUrl: string) => emailShell({
    title: "Subscription Renewed - Slingvo",
    preheader: "Your Slingvo subscription has renewed.",
    badgeLabel: "Receipt",
    heading: "Your subscription has renewed.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, your <strong>${planName}</strong> subscription renewed successfully — here's your receipt for this billing cycle.`) +
        emailInfoBox([
            { label: "Invoice", value: invoiceNumber },
            { label: "Amount charged", value: `$${amount}` },
        ]),
    buttonText: "View Billing History",
    buttonUrl: billingUrl,
})


export const refundConfirmationTemp = (fullName: string, amount: string, billingUrl: string) => emailShell({
    title: "Refund Processed - Slingvo",
    preheader: "Your Slingvo refund has been processed.",
    badgeLabel: "Refund",
    heading: "Your refund has been processed.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, we have successfully issued a refund to your payment method on file. Please allow 5–10 business days for the amount to appear on your statement.`) +
        emailInfoBox([{ label: "Refund amount", value: `$${amount}` }]),
    buttonText: "View Billing History",
    buttonUrl: billingUrl,
})

export const invoiceUncollectibleTemp = (fullName: string, amount: string, billingUrl: string) => emailShell({
    title: "Invoice Uncollectible - Slingvo",
    preheader: "We were unable to collect your Slingvo payment.",
    badgeLabel: "Payment failed",
    heading: "We were unable to collect your payment.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, after several attempts, we were unable to collect payment on your Slingvo invoice. As a result, some services associated with this invoice have been paused or removed.`) +
        emailInfoBox([{ label: "Outstanding amount", value: `$${amount}` }]) +
        emailParagraph("To restore full access, please update your payment method and contact support to reinstate any removed services."),
    buttonText: "Update Payment Method",
    buttonUrl: billingUrl,
})

export const paymentMethodAddedTemp = (fullName: string, cardBrand: string, cardLast4: string, billingUrl: string) => emailShell({
    title: "Payment Method Added - Slingvo",
    preheader: "A new payment method was added to your Slingvo account.",
    badgeLabel: "Security",
    heading: "New payment method added.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, a new payment method was added to your Slingvo account. If you made this change, no action is needed.`) +
        emailInfoBox([{ label: "Card", value: `${cardBrand} •••• ${cardLast4}` }]),
    buttonText: "Manage Payment Methods",
    buttonUrl: billingUrl,
    footnote: "If you did not add this card, please update your payment method immediately and contact support.",
})

export const upcomingInvoiceTemp = (fullName: string, amount: string, billingUrl: string) => emailShell({
    title: "Upcoming Invoice - Slingvo",
    preheader: "Your upcoming Slingvo invoice.",
    badgeLabel: "Billing",
    heading: "Your upcoming Slingvo invoice.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, your next Slingvo invoice has been generated and will be charged to your payment method on file shortly.`) +
        emailInfoBox([{ label: "Amount due", value: `$${amount}` }]),
    buttonText: "View Billing Details",
    buttonUrl: billingUrl,
    footnote: "Make sure your payment method is up to date to avoid any interruption in service.",
})

export const cardExpiringTemp = (fullName: string, cardBrand: string, cardLast4: string, expMonth: number, expYear: number, billingUrl: string) => emailShell({
    title: "Payment Method Expiring Soon - Slingvo",
    preheader: "Your Slingvo payment method is expiring soon.",
    badgeLabel: "Billing",
    heading: "Your payment method expires soon.",
    bodyHtml:
        emailParagraph(`Hi ${fullName}, the card on file for your Slingvo subscription is expiring. Please update your payment method to avoid service interruption.`) +
        emailInfoBox([{ label: "Card", value: `${cardBrand} •••• ${cardLast4} — expires ${String(expMonth).padStart(2, "0")}/${expYear}` }]),
    buttonText: "Update Payment Method",
    buttonUrl: billingUrl,
})

// Sent to BOTH the old and new addresses when an admin changes a user's
// email in the Super-Admin UI (bypasses Better Auth's own change-email
// verification flow, so nothing else notifies either party). GA 4.0 audit
// finding: "changing a user's email sends no notification to either address."
export const emailChangedByAdminTemp = (fullName: string, oldEmail: string, newEmail: string, kind: "old" | "new") => emailShell({
    title: "Your Slingvo email address was changed",
    preheader: "Your Slingvo account email address was changed.",
    badgeLabel: "Security",
    heading: "Your email address was changed.",
    bodyHtml:
        emailParagraph(`Hi ${fullName || "there"}, ${kind === "old"
            ? "an administrator has changed the email address on your Slingvo account. Future emails from us will be sent to the new address below."
            : "an administrator has updated your Slingvo account to use this email address. You'll now receive all future account emails here."}`) +
        emailInfoBox([
            { label: "Previous email", value: oldEmail },
            { label: "New email", value: newEmail },
        ]),
    footnote: "If you didn't expect this change, please contact your administrator or reply to support@slingvo.com immediately.",
})

// Sent to the deleted user themselves before their account is removed.
// GA 4.0 audit finding: "deleting a user sends nothing and has no
// confirmation prompt - one click and the account is gone."
export const accountClosedTemp = (fullName: string, closedByRole: "admin" | "system") => emailShell({
    title: "Your Slingvo account has been closed",
    preheader: "Your Slingvo account has been closed.",
    badgeLabel: "Account update",
    heading: "Your account has been closed.",
    bodyHtml: emailParagraph(`Hi ${fullName || "there"}, your Slingvo account has been closed${closedByRole === "admin" ? " by an administrator" : ""}. You will no longer be able to sign in, and this address will not receive further account emails after this one.`),
    footnote: "If you believe this was done in error, please contact support@slingvo.com right away.",
})

import { sendEmail as trackedSendEmail } from "../services/email.service";

export const sendEmail = async (
    to: string,
    subject: string,
    html: string,
    tracking?: {
        userId: string;
        contactId?: string;
        leadId?: string;
        templateId?: string;
        includeUnsubscribe?: boolean;
        companyId?: string;
        replyToEmail?: string;

        // MailerSend dashboard-hosted template. When set, `html` is
        // ignored — MailerSend renders the template itself with these
        // merge variables.
        mailerSendTemplateId?: string;
        variables?: Record<string, string | number | boolean | null>;
    }
) => {
    try {
        // MailerSend dashboard-hosted templates ignore `html` entirely (it's
        // rendered server-side from the template), so there's nothing local
        // to derive text from there — keep the stub for that case only.
        // Every other send builds its HTML from our own emailShell.ts
        // helpers, so a real text alternative can be derived from it instead
        // of the placeholder mail-tester flagged as a spam signal.
        const text = tracking?.mailerSendTemplateId
            ? "Please view this email in an HTML compatible client."
            : (htmlToPlainText(html) || "Please view this email in an HTML compatible client.");

        return await trackedSendEmail({
            to,
            from: envConfig.MAILERSEND_FROM_EMAIL || envConfig.EMAIL_USER || "noreply@slingvo.com",
            subject,
            text,
            html,
            userId: tracking?.userId,
            contactId: tracking?.contactId,
            leadId: tracking?.leadId,
            templateId: tracking?.templateId,
            includeUnsubscribe: tracking?.includeUnsubscribe,
            companyId: tracking?.companyId,
            replyToEmail: tracking?.replyToEmail,
            mailerSendTemplateId: tracking?.mailerSendTemplateId,
            variables: tracking?.variables,
        });
    }
    catch (error) {
        console.log("Error sending email via utils:", error);
        return { error };
    }
}