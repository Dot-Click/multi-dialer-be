import { Request, Response } from "express";
import axios from "axios";
import { addSuppression } from "../../utils/emailSuppression";
import { envConfig } from "../../lib/config";

/**
 * Handles Amazon SNS notifications produced by the SES configuration set's
 * bounce/complaint event destination.
 *
 * Mounted with express.text() so the raw SNS JSON (sent as text/plain) is
 * available as a string. Flow:
 *   - SubscriptionConfirmation → confirm by GET-ing the SubscribeURL
 *   - Notification → suppress permanently-bounced and complained recipients
 */
export const handleSesNotification = async (req: Request, res: Response): Promise<void> => {
  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }

  const type = body?.Type || (req.headers["x-amz-sns-message-type"] as string);

  // Optional hardening: if a topic ARN is configured, only accept that topic.
  const allowedArn = envConfig.SES_SNS_TOPIC_ARN;
  if (allowedArn && body?.TopicArn && body.TopicArn !== allowedArn) {
    console.warn("[SES webhook] Rejected notification from unexpected topic:", body.TopicArn);
    res.status(403).send("Unexpected topic");
    return;
  }

  try {
    if (type === "SubscriptionConfirmation") {
      if (body.SubscribeURL) {
        await axios.get(body.SubscribeURL);
        console.log("[SES webhook] SNS subscription confirmed");
      }
      res.status(200).send("Subscription confirmed");
      return;
    }

    if (type === "Notification") {
      const message =
        typeof body.Message === "string" ? JSON.parse(body.Message) : body.Message;
      const notificationType = message?.notificationType || message?.eventType;

      if (notificationType === "Bounce") {
        // Only suppress permanent (hard) bounces — transient bounces may recover.
        if (message.bounce?.bounceType === "Permanent") {
          for (const r of message.bounce.bouncedRecipients || []) {
            await addSuppression(
              r.emailAddress,
              "BOUNCE",
              r.diagnosticCode || "Permanent bounce"
            );
          }
        }
      } else if (notificationType === "Complaint") {
        for (const r of message.complaint?.complainedRecipients || []) {
          await addSuppression(r.emailAddress, "COMPLAINT", "Recipient marked as spam");
        }
      }

      res.status(200).send("Processed");
      return;
    }

    res.status(200).send("Ignored");
  } catch (err: any) {
    console.error("[SES webhook] Error processing notification:", err?.message || err);
    // Return 200 so SNS doesn't retry indefinitely on a parse/logic error.
    res.status(200).send("Error logged");
  }
};
