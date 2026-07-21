import cron from "node-cron";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";
import { getStripeClient } from "../lib/stripe";
import { notifyClients } from "../services/leadStoreNotify.service";

const REMINDER_HOURS = Number(envConfig.LEAD_STORE_REMINDER_HOURS) || 48;
const PAUSE_HOURS = Number(envConfig.LEAD_STORE_PAUSE_HOURS) || 72;

/**
 * Chases Client for Lead Store purchases stuck in PENDING_SETUP: a reminder
 * at REMINDER_HOURS, then a billing pause (never an auto-refund) at
 * PAUSE_HOURS if still unlinked.
 */
export function startLeadStoreReminderWorker() {
  cron.schedule("0 * * * *", async () => {
    const now = Date.now();
    const pending = await prisma.leadStore.findMany({
      where: { status: "PENDING_SETUP" },
      include: { user: { select: { fullName: true, email: true } }, service: { select: { name: true } } },
    });

    for (const leadStore of pending) {
      const ageHours = (now - leadStore.createdAt.getTime()) / (1000 * 60 * 60);
      const who = leadStore.user.fullName || leadStore.user.email;

      try {
        if (ageHours >= PAUSE_HOURS && !leadStore.billingPaused) {
          if (leadStore.stripeSubscriptionId) {
            await getStripeClient().subscriptions.update(leadStore.stripeSubscriptionId, {
              pause_collection: { behavior: "void" },
            });
          }
          await prisma.leadStore.update({ where: { id: leadStore.id }, data: { billingPaused: true } });
          await notifyClients(
            "Lead Store billing paused — setup overdue",
            `"${leadStore.service.name}" for ${who} has been pending setup for over ${PAUSE_HOURS}h. Billing has been paused until you link a MyPlusLeads account.`,
            "lead_store_billing_paused",
          );
          console.log(`[LeadStoreReminder] Paused billing for leadStoreId=${leadStore.id}`);
        } else if (ageHours >= REMINDER_HOURS && !leadStore.reminderSentAt) {
          await prisma.leadStore.update({ where: { id: leadStore.id }, data: { reminderSentAt: new Date() } });
          await notifyClients(
            "Reminder: Lead Store setup still pending",
            `"${leadStore.service.name}" for ${who} has been waiting ${Math.round(ageHours)}h for a MyPlusLeads account to be linked.`,
            "lead_store_reminder",
          );
          console.log(`[LeadStoreReminder] Sent reminder for leadStoreId=${leadStore.id}`);
        }
      } catch (err) {
        console.error(`[LeadStoreReminder] Failed processing leadStoreId=${leadStore.id}:`, err);
      }
    }
  });
}
