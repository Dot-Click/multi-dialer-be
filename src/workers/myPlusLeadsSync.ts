import cron from "node-cron";
import prisma from "../lib/prisma";
import { syncLeadsForUser } from "../services/myPlusLeads.service";

export function startMyPlusLeadsSyncWorker() {
  cron.schedule("0 6 * * *", async () => {
    console.log("[MyPlusLeads] Starting daily lead sync...");

    const configs = await prisma.myPlusLeadsConfig.findMany({
      where: { status: "CONNECTED", autoSync: true },
    });

    for (const config of configs) {
      try {
        await syncLeadsForUser(config.userId);
        console.log(`[MyPlusLeads] Synced leads for user ${config.userId}`);
      } catch (err) {
        console.error(`[MyPlusLeads] Sync failed for user ${config.userId}:`, err);
        await prisma.myPlusLeadsConfig.update({
          where: { userId: config.userId },
          data: { errorMessage: String(err) },
        });
      }
    }

    console.log("[MyPlusLeads] Daily sync complete.");
  });
}
