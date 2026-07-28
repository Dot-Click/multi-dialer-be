import cron from "node-cron";
import prisma from "../lib/prisma";
import { dispatchEmail } from "../services/email.service";
import { EmailStatus } from "@prisma/client";

// Back-off delay (minutes) for attempt index 0, 1, 2 …
// Attempt 1 failed → wait 2 min before attempt 2
// Attempt 2 failed → wait 10 min before attempt 3
// Attempt 3 failed → DEAD (no more retries)
const BACKOFF_MINUTES = [2, 10, 30];

const BATCH_SIZE = 20;

export const startEmailQueueJob = () => {
  // On startup reset any items left PROCESSING from a previous crash so they
  // are re-tried on the next tick rather than stuck forever.
  prisma.emailQueue
    .updateMany({
      where:  { status: "PROCESSING" },
      data:   { status: "PENDING", nextRetryAt: new Date() },
    })
    .catch(err => console.error("[EmailQueue] Failed to reset stuck PROCESSING items:", err?.message));

  // Run every 30 seconds — "*\/30 * * * * *" uses the 6-field cron syntax that
  // node-cron supports when the seconds field is included.
  cron.schedule("*/30 * * * * *", async () => {
    const now = new Date();

    // Claim a batch of due items.
    const items = await prisma.emailQueue.findMany({
      where:   { status: "PENDING", nextRetryAt: { lte: now } },
      take:    BATCH_SIZE,
      orderBy: { nextRetryAt: "asc" },
    }).catch(err => {
      console.error("[EmailQueue] Failed to fetch pending items:", err?.message);
      return [];
    });

    if (items.length === 0) return;

    // Mark the whole batch as PROCESSING atomically before touching any of them
    // so a concurrent cron tick (or server restart during processing) can't
    // double-deliver.
    await prisma.emailQueue.updateMany({
      where: { id: { in: items.map(i => i.id) } },
      data:  { status: "PROCESSING" },
    }).catch(err => console.error("[EmailQueue] Failed to mark items PROCESSING:", err?.message));

    console.log(`[EmailQueue] Processing ${items.length} queued email(s)…`);

    for (const item of items) {
      try {
        const result = await dispatchEmail({
          to:                 item.to,
          from:               item.from,
          fromName:           item.fromName   ?? undefined,
          subject:            item.subject,
          text:               item.text,
          html:               item.html       ?? undefined,
          replyToEmail:       item.replyToEmail ?? undefined,
          includeUnsubscribe: item.includeUnsubscribe,
          companyId:          item.companyId  ?? undefined,
          userId:             item.userId     ?? undefined,
          contactId:          item.contactId  ?? undefined,
          leadId:             item.leadId     ?? undefined,
          templateId:         item.templateId ?? undefined,
        });

        if (result.success) {
          // Mark delivered and write a success EmailLog entry so the tracking
          // dashboard shows the eventual delivery.
          await prisma.emailQueue.update({
            where: { id: item.id },
            data:  { status: "SENT", messageId: result.messageId ?? null, updatedAt: new Date() },
          });

          if (item.userId) {
            await prisma.emailLog.create({
              data: {
                to:        item.to,
                from:      item.from,
                subject:   item.subject,
                content:   item.html || item.text,
                status:    EmailStatus.SENT,
                messageId: result.messageId ?? null,
                userId:    item.userId,
                contactId: item.contactId ?? null,
                leadId:    item.leadId    ?? null,
                templateId: item.templateId ?? null,
              },
            }).catch(err => console.error(`[EmailQueue] Failed to write success EmailLog for item ${item.id}:`, err?.message));
          }

          console.log(`[EmailQueue] ✓ Delivered to ${item.to} (item=${item.id}, attempt=${item.attempts + 1})`);
        } else {
          const newAttempts = item.attempts + 1;

          if (result.suppressed || newAttempts >= item.maxAttempts) {
            // Permanently undeliverable — move to dead-letter.
            await prisma.emailQueue.update({
              where: { id: item.id },
              data:  {
                status:    "DEAD",
                attempts:  newAttempts,
                lastError: result.error ?? "Max retries reached",
                updatedAt: new Date(),
              },
            });
            console.warn(`[EmailQueue] ✗ DEAD: ${item.to} (item=${item.id}, reason=${result.error})`);
          } else {
            // Transient failure — back off and try again later.
            const delayMinutes = BACKOFF_MINUTES[newAttempts - 1] ?? 30;
            const nextRetryAt  = new Date(Date.now() + delayMinutes * 60 * 1000);

            await prisma.emailQueue.update({
              where: { id: item.id },
              data:  {
                status:     "PENDING",
                attempts:   newAttempts,
                nextRetryAt,
                lastError:  result.error ?? null,
                updatedAt:  new Date(),
              },
            });
            console.warn(`[EmailQueue] ↻ Retry ${newAttempts}/${item.maxAttempts} for ${item.to} in ${delayMinutes}m (item=${item.id})`);
          }
        }
      } catch (err: any) {
        // Unexpected error — leave as PROCESSING so the startup reset rescues it
        // on the next deploy/restart rather than silently dropping it.
        console.error(`[EmailQueue] Unexpected error on item ${item.id}:`, err?.message);
      }
    }
  });

  console.log("[EmailQueue] Retry job started (every 30s, batch size: " + BATCH_SIZE + ")");
};
