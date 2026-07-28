import cron from "node-cron";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";
import { sendEmail } from "../services/email.service";
import { inactivityNudgeTemp, subscribeReminderTemp, reactivationTemp } from "../utils/email";

/**
 * User Lifecycle Email Job — runs daily at 09:00 UTC.
 *
 * Three nudges, each sent at most once per user per window:
 *
 * 1. Inactivity        — ADMIN/AGENT last logged in 3–4 days ago (daily job
 *                        catches a 1-day window so the email fires exactly once).
 * 2. No subscription   — ADMIN created ≥7 days ago with no active subscription.
 * 3. Reactivation      — UserSubscription cancelled 3–4 days ago (same 1-day
 *                        window trick).
 */
export const startUserLifecycleJob = () => {
  cron.schedule("0 9 * * *", async () => {
    console.log("[UserLifecycle] Running daily lifecycle email job...");

    const now = new Date();

    // ── 1. Inactivity nudge ───────────────────────────────────────────────────
    try {
      const inactiveFrom = new Date(now);
      inactiveFrom.setDate(now.getDate() - 4);
      const inactiveTo = new Date(now);
      inactiveTo.setDate(now.getDate() - 3);

      const inactiveUsers = await prisma.user.findMany({
        where: {
          role: { in: ["ADMIN", "AGENT"] },
          isSubscribed: true,
          lastLogin: { gte: inactiveFrom, lt: inactiveTo },
        },
        select: { id: true, email: true, fullName: true },
      });

      for (const user of inactiveUsers) {
        await sendEmail({
          to: user.email,
          from: envConfig.MAILERSEND_FROM_EMAIL || "noreply@slingvo.com",
          subject: "We haven't seen you in a while — Slingvo",
          text: `Hi ${user.fullName || "there"}, it's been a few days since you logged in to Slingvo.`,
          html: inactivityNudgeTemp(
            user.fullName || "there",
            `${envConfig.FRONTEND_URL}/admin/login`,
          ),
          userId: user.id,
        }).catch(err => console.error(`[UserLifecycle] Inactivity email failed for ${user.email}:`, err?.message));
      }

      console.log(`[UserLifecycle] Inactivity nudge sent to ${inactiveUsers.length} user(s).`);
    } catch (err: any) {
      console.error("[UserLifecycle] Inactivity job error:", err?.message);
    }

    // ── 2. No-subscription reminder ───────────────────────────────────────────
    try {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(now.getDate() - 7);

      const unsubscribedAdmins = await prisma.user.findMany({
        where: {
          role: "ADMIN",
          isSubscribed: false,
          createdAt: { lte: sevenDaysAgo },
          userSubscription: { none: {} },
        },
        select: { id: true, email: true, fullName: true },
      });

      for (const user of unsubscribedAdmins) {
        await sendEmail({
          to: user.email,
          from: envConfig.MAILERSEND_FROM_EMAIL || "noreply@slingvo.com",
          subject: "Your Slingvo account is ready — activate it now",
          text: `Hi ${user.fullName || "there"}, your Slingvo account is set up but you haven't subscribed yet.`,
          html: subscribeReminderTemp(
            user.fullName || "there",
            `${envConfig.FRONTEND_URL}/admin/billing`,
          ),
          userId: user.id,
        }).catch(err => console.error(`[UserLifecycle] Subscribe reminder failed for ${user.email}:`, err?.message));
      }

      console.log(`[UserLifecycle] Subscribe reminder sent to ${unsubscribedAdmins.length} admin(s).`);
    } catch (err: any) {
      console.error("[UserLifecycle] Subscribe reminder job error:", err?.message);
    }

    // ── 3. Reactivation nudge ─────────────────────────────────────────────────
    try {
      const cancelledFrom = new Date(now);
      cancelledFrom.setDate(now.getDate() - 4);
      const cancelledTo = new Date(now);
      cancelledTo.setDate(now.getDate() - 3);

      const cancelledSubs = await prisma.userSubscription.findMany({
        where: {
          status: "CANCELLED",
          updatedAt: { gte: cancelledFrom, lt: cancelledTo },
        },
        include: {
          user: { select: { id: true, email: true, fullName: true, role: true } },
        },
      });

      for (const sub of cancelledSubs) {
        if (sub.user.role === "OWNER") continue;
        await sendEmail({
          to: sub.user.email,
          from: envConfig.MAILERSEND_FROM_EMAIL || "noreply@slingvo.com",
          subject: "Come back to Slingvo — resubscribe anytime",
          text: `Hi ${sub.user.fullName || "there"}, your Slingvo subscription has ended. Resubscribe to regain access.`,
          html: reactivationTemp(
            sub.user.fullName || "there",
            `${envConfig.FRONTEND_URL}/admin/billing`,
          ),
          userId: sub.user.id,
        }).catch(err => console.error(`[UserLifecycle] Reactivation email failed for ${sub.user.email}:`, err?.message));
      }

      console.log(`[UserLifecycle] Reactivation nudge sent to ${cancelledSubs.length} user(s).`);
    } catch (err: any) {
      console.error("[UserLifecycle] Reactivation job error:", err?.message);
    }

    console.log("[UserLifecycle] Daily lifecycle job complete.");
  });
};
