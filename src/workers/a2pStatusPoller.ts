import cron from "node-cron";
import prisma from "../lib/prisma";
import { a2pRegistrationService } from "../services/a2pRegistrationService";

/**
 * Worker to poll Twilio for A2P status updates every 6 hours.
 */
export function startA2PStatusPoller() {
    console.log("[A2P Poller] Starting status poller worker (every 6 hours)");

    // Cron schedule: 0 */6 * * * (At minute 0 of every 6th hour)
    cron.schedule("0 */6 * * *", async () => {
        console.log("[A2P Poller] Running A2P status check...");

        try {
            // Find all registrations that are PENDING
            const pendingRegistrations = await prisma.a2P_Registration.findMany({
                where: { status: "PENDING" }
            });

            for (const reg of pendingRegistrations) {
                console.log(`[A2P Poller] Checking status for user: ${reg.userId}`);
                await a2pRegistrationService.checkA2PStatus(reg.userId);
                // Implementation in checkA2PStatus would update the DB and send emails
            }

        } catch (error: any) {
            console.error("[A2P Poller] Worker execution failed:", error.message);
        }
    });
}
