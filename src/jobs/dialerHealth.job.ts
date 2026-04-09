import cron from "node-cron";
import prisma from "../lib/prisma";
import { getNumberReputation } from "../services/twilio-lookup";

/**
 * Dialer Health Job
 * Runs twice daily (at 00:00 and 12:00) to refresh Caller ID reputation status.
 */
export const startDialerHealthJob = () => {
    // 00:00 and 12:00 every day
    cron.schedule("0 0,12 * * *", async () => {
        console.log("[Job] Running Dialer Health Check (Twice Daily)...");

        try {
            const callerIds = await prisma.callerId.findMany({
                where: { twillioNumber: { not: null } }
            });

            if (callerIds.length === 0) return;

            let updatedCount = 0;
            for (const cid of callerIds) {
                if (cid.twillioNumber) {
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
            }
            console.log(`[Job] Dialer Health Check finished. Updated ${updatedCount} numbers.`);
        } catch (error) {
            console.error("[Job] Critical error in Dialer Health Job:", error);
        }
    });
};
