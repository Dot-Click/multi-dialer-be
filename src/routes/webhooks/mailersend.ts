import { Request, Response } from "express";
import crypto from "crypto";
import prisma from "../../lib/prisma";
import { envConfig } from "../../lib/config";
import { addSuppression } from "../../utils/emailSuppression";
import { EmailStatus, BounceType } from "@prisma/client";
import { maskEmail } from "../../utils/maskEmail";

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
    if (process.env.NODE_ENV === "production") {
      // Never accept unsigned webhook traffic in production — fail closed.
      // Anyone could otherwise POST fake bounce/complaint/unsubscribe events
      // and force real recipients onto the suppression list.
      console.error("[MailerSend webhook] MAILERSEND_WEBHOOK_SECRET is not set in production — rejecting request.");
      return false;
    }
    // Non-production only: secret not yet configured (e.g. during initial
    // webhook registration in MailerSend's dashboard, which validates the
    // URL before a signing secret exists). Allow through so registration
    // succeeds, but log a warning so it's visible.
    console.warn("[MailerSend webhook] MAILERSEND_WEBHOOK_SECRET is not set — skipping signature check (non-production only).");
    return true;
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

    // The event type always lives on the webhook envelope (e.g. "activity.sent")
    // — that's the one field MailerSend guarantees across every event category,
    // so it's the primary source. data.type usually mirrors it but isn't a safe
    // fallback-of-first-resort since some event categories don't set it.
    const activityType: string | undefined =
      event?.type?.replace(/^activity\./, "") || data?.type;

    // MailerSend has shipped more than one shape for the recipient address —
    // `data.email` is a plain string in the documented "sent" example, but an
    // object with the address nested under `recipient` in others (this is what
    // was actually silently breaking every event: `data.email` was truthy as an
    // *object*, so `!email` never caught it, and downstream just no-opped).
    // Try every known shape instead of assuming one.
    const email: string | undefined =
      (typeof data?.email === "string" ? data.email : undefined) ||
      data?.email?.recipient?.email ||
      data?.recipient?.email ||
      data?.email?.email;

    // Same story for the id used to match back to our EmailLog row.
    const messageId: string | undefined =
      data?.message_id || data?.email?.message?.id || data?.email_id;

    // Always log the raw payload (address masked) so the next payload-shape
    // surprise is a 2-minute diagnosis instead of a multi-day silent drop.
    console.log(
      "[MailerSend webhook] raw payload:",
      JSON.stringify(event, (key, value) =>
        key === "email" && typeof value === "string" ? maskEmail(value) : value
      )
    );

    if (!activityType || !email) {
      console.warn(
        `[MailerSend webhook] Could not extract type/email — type=${activityType ?? "MISSING"} email=${email ? "present" : "MISSING"} envelopeType=${event?.type}`
      );
      return;
    }

    console.log(`[MailerSend webhook] ${activityType}: ${maskEmail(email)} (message_id=${messageId})`);

    switch (activityType) {
      case "hard_bounced":
        await addSuppression(
          email,
          "BOUNCE",
          data?.bounce?.description || data?.email?.bounce?.description || data?.reason || "Hard bounce"
        );
        if (messageId) {
          await prisma.emailLog.updateMany({
            where: { messageId },
            data: { status: EmailStatus.FAILED, error: "Hard bounce (MailerSend)", bounceType: BounceType.HARD },
          });
        }
        break;

      // Soft bounces are transient (mailbox full, temporary DNS issue, etc.) —
      // matches the prior SES handler's behavior of only suppressing permanent
      // bounces. No suppression/status change, but now recorded on the log
      // row so bounce rate can distinguish soft from hard.
      case "soft_bounced":
        if (messageId) {
          await prisma.emailLog.updateMany({
            where: { messageId },
            data: { bounceType: BounceType.SOFT },
          });
        }
        break;

      case "spam_complaint":
        await addSuppression(email, "COMPLAINT", "Recipient marked as spam");
        break;

      case "unsubscribed":
        await addSuppression(email, "UNSUBSCRIBE", "Unsubscribed via MailerSend link/header");
        break;

      case "delivered":
        if (messageId) {
          await prisma.emailLog.updateMany({
            where: { messageId },
            data: { deliveredAt: new Date() },
          });
        }
        break;

      case "opened":
        if (messageId) {
          // Only stamp openedAt the first time — later opens just bump the count.
          await prisma.emailLog.updateMany({
            where: { messageId, openedAt: null },
            data: { openedAt: new Date() },
          });
          await prisma.emailLog.updateMany({
            where: { messageId },
            data: { openCount: { increment: 1 } },
          });
        }
        break;

      case "clicked":
        if (messageId) {
          await prisma.emailLog.updateMany({
            where: { messageId, clickedAt: null },
            data: { clickedAt: new Date() },
          });
          await prisma.emailLog.updateMany({
            where: { messageId },
            data: { clickCount: { increment: 1 } },
          });
        }
        break;

      case "sent":
        // Send-time state is already recorded by email.service.ts when the
        // message was dispatched — nothing further to do here.
        break;

      default:
        console.log(`[MailerSend webhook] Unhandled activity type: ${activityType}`);
    }
  } catch (err: any) {
    console.error("[MailerSend webhook] Error processing event:", err?.message || err);
  }
};
