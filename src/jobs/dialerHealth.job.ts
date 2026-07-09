import cron from "node-cron";
import prisma from "../lib/prisma";
import { getNumberReputation } from "../services/twilio-lookup";
import { getUserPlanLimits } from "../services/planLimits.service";

/**
 * Dialer Health Job
 * Runs twice daily (at 00:00 and 12:00) to refresh Caller ID reputation status.
 * Plan gate: only numbers owned by an admin whose plan has
 * advancedDeliverabilityEnabled get their reputation tracked — everyone
 * else's CallerId rows are left untouched (reputationScore/Status stay null,
 * so the frontend dialer-health UI has nothing to show them).
 */
export const startDialerHealthJob = () => {
    // 00:00 and 12:00 every day
    cron.schedule("0 0,12 * * *", async () => {
        console.log("[Job] Running Dialer Health Check (Twice Daily)...");

        try {
            const callerIds = await prisma.callerId.findMany({
                where: { twillioNumber: { not: null } },
                include: { systemSetting: { select: { userId: true } } },
            });

            if (callerIds.length === 0) return;

            const planCache = new Map<string, boolean>();
            let updatedCount = 0;
            let skippedCount = 0;
            for (const cid of callerIds) {
                if (!cid.twillioNumber) continue;

                const adminId = cid.systemSetting.userId;
                let enabled = planCache.get(adminId);
                if (enabled === undefined) {
                    enabled = await getUserPlanLimits(adminId).then(l => l.advancedDeliverabilityEnabled).catch(() => true);
                    planCache.set(adminId, enabled);
                }
                if (!enabled) {
                    skippedCount++;
                    continue;
                }

                const result = await getNumberReputation(cid.twillioNumber);
                if (result) {
                    await prisma.callerId.update({
                        where: { id: cid.id },
                        data: {
                            reputationStatus: result.status,
                            reputationScore: result.score,
                            lastReputationCheck: new Date()
                        }
                    });
                    updatedCount++;
                }
            }
            console.log(`[Job] Dialer Health Check finished. Updated ${updatedCount} numbers, skipped ${skippedCount} (plan doesn't include advanced deliverability).`);
        } catch (error) {
            console.error("[Job] Critical error in Dialer Health Job:", error);
        }
    });
};
