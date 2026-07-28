import { Request, Response } from "express";
import crypto from "crypto";
import prisma from "../../lib/prisma";
import { envConfig } from "../../lib/config";
import { addSuppression } from "../../utils/emailSuppression";
import { EmailStatus } from "@prisma/client";

/**
 * Handles MailerSend activity webhooks (Sent/Delivered/Opened/Clicked/
 * Soft Bounce/Hard Bounce/Unsubscribed/Spam Complaint).
 *
 * Mounted with express.raw() so the exact bytes MailerSend signed are
 * available for HMAC verification — parsing through express.json() first
 * would re-serialize the body and break the signature check.
 *
 * MailerSend signs the raw request body with HMAC-SHA256 using the signing
 * secret shown once when the webhook is created in the dashboard, sent in
 * the `Signature` header.
 */
function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = envConfig.MAILERSEND_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured — refuse to process unauthenticated webhook traffic.
    console.error("[MailerSend webhook] MAILERSEND_WEBHOOK_SECRET is not set — rejecting.");
    return false;
  }
  if (!signatureHeader) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const handleMailerSendWebhook = async (req: Request, res: Response): Promise<void> => {
  const rawBody = req.body as Buffer;

  if (!verifySignature(rawBody, req.headers["signature"] as string | undefined)) {
    res.status(401).send("Invalid signature");
    return;
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }

  // Always 200 once the signature is verified — MailerSend retries on non-2xx,
  // and a downstream DB hiccup shouldn't cause repeated redelivery storms.
  res.status(200).send("Processed");

  try {
    const data = event?.data;
    const activityType: string | undefined = data?.type || event?.type?.replace(/^activity\./, "");
    const email: string | undefined = data?.email || data?.recipient?.email;
    const messageId: string | undefined = data?.message_id;

    if (!activityType || !email) {
      console.warn("[MailerSend webhook] Missing type/email in payload:", event?.type);
      return;
    }

    console.log(`[MailerSend webhook] ${activityType}: ${email} (message_id=${messageId})`);

    switch (activityType) {
      case "hard_bounced":
        await addSuppression(email, "BOUNCE", data?.bounce?.description || data?.reason || "Hard bounce");
        if (messageId) {
          await prisma.emailLog.updateMany({
            where: { messageId },
            data: { status: EmailStatus.FAILED, error: "Hard bounce (MailerSend)" },
          });
        }
        break;

      case "spam_complaint":
        await addSuppression(email, "COMPLAINT", "Recipient marked as spam");
        break;

      case "unsubscribed":
        await addSuppression(email, "UNSUBSCRIBE", "Unsubscribed via MailerSend link/header");
        break;

      // Soft bounces are transient (mailbox full, temporary DNS issue, etc.) —
      // matches the prior SES handler's behavior of only suppressing permanent
      // bounces. Logged for visibility, no suppression or status change.
      case "soft_bounced":
      case "sent":
      case "delivered":
      case "opened":
      case "clicked":
        break;

      default:
        console.log(`[MailerSend webhook] Unhandled activity type: ${activityType}`);
    }
  } catch (err: any) {
    console.error("[MailerSend webhook] Error processing event:", err?.message || err);
  }
};
