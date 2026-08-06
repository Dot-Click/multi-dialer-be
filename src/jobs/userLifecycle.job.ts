import cron from "node-cron";
import prisma from "../lib/prisma";
import { envConfig } from "../lib/config";
import { sendEmail } from "../services/email.service";
import { maskEmail } from "../utils/maskEmail";
import {
  inactivityNudgeTemp,
  subscribeReminderTemp,
  reactivationTemp,
  trialEndingSoonTemp,
  cardExpiringTemp,
} from "../utils/email";

export const startUserLifecycleJob = () => {
  cron.schedule("0 9 * * *", async () => {
    console.log("[UserLifecycle] Running daily lifecycle email job...");

    const now = new Date();

    // ── 1. Inactivity nudge ───────────────────────────────────────────────────
    // Respects: emailPreferences.inactivityNudges (default true)
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
        select: {
          id: true, email: true, fullName: true,
          emailPreferences: { select: { inactivityNudges: true } },
        },
      });

      let sent = 0;
      for (const user of inactiveUsers) {
        if (user.emailPreferences?.inactivityNudges === false) continue;
        await sendEmail({
          to: user.email,
          from: envConfig.MAILERSEND_FROM_EMAIL || "noreply@slingvo.com",
          subject: "We haven't seen you in a while — Slingvo",
          text: `Hi ${user.fullName || "there"}, it's been a few days since you logged in to Slingvo.`,
          html: inactivityNudgeTemp(user.fullName || "there", `${envConfig.FRONTEND_URL}/admin/login`),
          userId: user.id,
        }).catch(err => console.error(`[UserLifecycle] Inactivity email failed for ${maskEmail(user.email)}:`, err?.message));
        sent++;
      }

      console.log(`[UserLifecycle] Inactivity nudge sent to ${sent}/${inactiveUsers.length} user(s).`);
    } catch (err: any) {
      console.error("[UserLifecycle] Inactivity job error:", err?.message);
    }

    // ── 2. No-subscription reminder ───────────────────────────────────────────
    // Respects: emailPreferences.marketingEmails (default true)
    //
    // Window must be bounded like the trial/inactivity jobs below — an
    // unbounded "createdAt <= 7 days ago" matches the same still-unsubscribed
    // user on every single run forever, not once. Confirmed in production:
    // the same 9 accounts got this email daily for 9 straight days before
    // this fix (GA 4.0 duplicate-send finding).
    try {
      const sevenDaysFrom = new Date(now);
      sevenDaysFrom.setDate(now.getDate() - 8);
      const sevenDaysTo = new Date(now);
      sevenDaysTo.setDate(now.getDate() - 7);

      const unsubscribedAdmins = await prisma.user.findMany({
        where: {
          role: "ADMIN",
          isSubscribed: false,
          createdAt: { gte: sevenDaysFrom, lt: sevenDaysTo },
          userSubscriptions: { none: {} },
        },
        select: {
          id: true, email: true, fullName: true,
          emailPreferences: { select: { marketingEmails: true } },
        },
      });

      let sent = 0;
      for (const user of unsubscribedAdmins) {
        if (user.emailPreferences?.marketingEmails === false) continue;
        await sendEmail({
          to: user.email,
          from: envConfig.MAILERSEND_FROM_EMAIL || "noreply@slingvo.com",
          subject: "Your Slingvo account is ready — activate it now",
          text: `Hi ${user.fullName || "there"}, your Slingvo account is set up but you haven't subscribed yet.`,
          html: subscribeReminderTemp(user.fullName || "there", `${envConfig.FRONTEND_URL}/admin/billing`),
          userId: user.id,
        }).catch(err => console.error(`[UserLifecycle] Subscribe reminder failed for ${maskEmail(user.email)}:`, err?.message));
        sent++;
      }

      console.log(`[UserLifecycle] Subscribe reminder sent to ${sent}/${unsubscribedAdmins.length} admin(s).`);
    } catch (err: any) {
      console.error("[UserLifecycle] Subscribe reminder job error:", err?.message);
    }

    // ── 3. Reactivation nudge ─────────────────────────────────────────────────
    // Respects: emailPreferences.marketingEmails (default true)
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
          user: {
            select: {
              id: true, email: true, fullName: true, role: true,
              emailPreferences: { select: { marketingEmails: true } },
            },
          },
        },
      });

      let sent = 0;
      for (const sub of cancelledSubs) {
        if (sub.user.role === "OWNER") continue;
        if (sub.user.emailPreferences?.marketingEmails === false) continue;
        await sendEmail({
          to: sub.user.email,
          from: envConfig.MAILERSEND_FROM_EMAIL || "noreply@slingvo.com",
          subject: "Come back to Slingvo — resubscribe anytime",
          text: `Hi ${sub.user.fullName || "there"}, your Slingvo subscription has ended. Resubscribe to regain access.`,
          html: reactivationTemp(sub.user.fullName || "there", `${envConfig.FRONTEND_URL}/admin/billing`),
          userId: sub.user.id,
        }).catch(err => console.error(`[UserLifecycle] Reactivation email failed for ${maskEmail(sub.user.email)}:`, err?.message));
        sent++;
      }

      console.log(`[UserLifecycle] Reactivation nudge sent to ${sent}/${cancelledSubs.length} user(s).`);
    } catch (err: any) {
      console.error("[UserLifecycle] Reactivation job error:", err?.message);
    }

    // ── 4. Trial ending soon ──────────────────────────────────────────────────
    // Respects: emailPreferences.trialReminders (default true)
    try {
      const trialWindowFrom = new Date(now);
      trialWindowFrom.setDate(now.getDate() - 28);
      const trialWindowTo = new Date(now);
      trialWindowTo.setDate(now.getDate() - 27);

      const trialUsers = await prisma.user.findMany({
        where: {
          role: "ADMIN",
          trialStatus: "ACTIVE",
          createdAt: { gte: trialWindowFrom, lt: trialWindowTo },
        },
        select: {
          id: true, email: true, fullName: true, createdAt: true,
          emailPreferences: { select: { trialReminders: true } },
        },
      });

      let sent = 0;
      for (const user of trialUsers) {
        if (user.emailPreferences?.trialReminders === false) continue;
        const trialEndMs = new Date(user.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000;
        const daysLeft = Math.max(1, Math.round((trialEndMs - now.getTime()) / (1000 * 60 * 60 * 24)));
        await sendEmail({
          to: user.email,
          from: envConfig.MAILERSEND_FROM_EMAIL || "noreply@slingvo.com",
          subject: `Your Slingvo trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          text: `Hi ${user.fullName || "there"}, your Slingvo trial is ending soon.`,
          html: trialEndingSoonTemp(user.fullName || "there", daysLeft, `${envConfig.FRONTEND_URL}/admin/billing`),
          userId: user.id,
        }).catch(err => console.error(`[UserLifecycle] Trial-ending-soon email failed for ${maskEmail(user.email)}:`, err?.message));
        sent++;
      }

      console.log(`[UserLifecycle] Trial ending soon sent to ${sent}/${trialUsers.length} user(s).`);
    } catch (err: any) {
      console.error("[UserLifecycle] Trial-ending-soon job error:", err?.message);
    }

    // ── 5. Card expiring ──────────────────────────────────────────────────────
    // Critical billing alert — always sent, no preference toggle.
    try {
      const nextMonth = now.getMonth() + 2; // getMonth() is 0-based; cards use 1-based months
      const cardTargetMonth = nextMonth > 12 ? nextMonth - 12 : nextMonth;
      const cardTargetYear  = nextMonth > 12 ? now.getFullYear() + 1 : now.getFullYear();

      const expiringSubs = await prisma.userSubscription.findMany({
        where: {
          status: "ACTIVE",
          cardExpMonth: cardTargetMonth,
          cardExpYear:  cardTargetYear,
        },
        include: {
          user: { select: { id: true, email: true, fullName: true, role: true } },
        },
      });

      let sent = 0;
      for (const sub of expiringSubs) {
        if (sub.user.role === "OWNER") continue;
        if (!sub.cardBrand || !sub.cardLast4 || !sub.cardExpMonth || !sub.cardExpYear) continue;

        // cardExpMonth/Year match stays true for the whole current calendar
        // month, so without this check the same card triggers a resend on
        // every single day's run — same duplicate-send bug class as the
        // no-subscription reminder above. No dedicated "last reminded" field
        // exists, so use EmailLog itself as the dedup source of truth.
        const alreadyReminded = await prisma.emailLog.findFirst({
          where: {
            userId: sub.user.id,
            subject: "Your Slingvo payment card expires soon",
            createdAt: { gte: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true },
        });
        if (alreadyReminded) continue;

        await sendEmail({
          to: sub.user.email,
          from: envConfig.MAILERSEND_FROM_EMAIL || "noreply@slingvo.com",
          subject: "Your Slingvo payment card expires soon",
          text: `Hi ${sub.user.fullName || "there"}, your ${sub.cardBrand} card ending in ${sub.cardLast4} expires soon.`,
          html: cardExpiringTemp(
            sub.user.fullName || "there",
            sub.cardBrand, sub.cardLast4,
            sub.cardExpMonth, sub.cardExpYear,
            `${envConfig.FRONTEND_URL}/admin/billing`,
          ),
          userId: sub.user.id,
        }).catch(err => console.error(`[UserLifecycle] Card-expiring email failed for ${maskEmail(sub.user.email)}:`, err?.message));
        sent++;
      }

      console.log(`[UserLifecycle] Card expiring email sent to ${sent}/${expiringSubs.length} subscription(s).`);
    } catch (err: any) {
      console.error("[UserLifecycle] Card-expiring job error:", err?.message);
    }

    console.log("[UserLifecycle] Daily lifecycle job complete.");
  });
};
