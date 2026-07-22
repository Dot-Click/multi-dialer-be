import cron from "node-cron";
import prisma from "../lib/prisma";
import { syncLeadsForLeadStore } from "../services/myPlusLeads.service";

export function startMyPlusLeadsSyncWorker() {
  cron.schedule("0 6 * * *", async () => {
    console.log("[MyPlusLeads] Starting daily lead sync...");

    const leadStores = await prisma.leadStore.findMany({
      where: {
        status: "ACTIVE",
        assignedPackage: { not: null },
        myPlusLeadsConfig: { status: "CONNECTED", autoSync: true },
      },
    });

    for (const leadStore of leadStores) {
      try {
        await syncLeadsForLeadStore(leadStore.id);
        console.log(`[MyPlusLeads] Synced leads for user ${leadStore.userId} (leadStore ${leadStore.id})`);
      } catch (err) {
        console.error(`[MyPlusLeads] Sync failed for user ${leadStore.userId} (leadStore ${leadStore.id}):`, err);
        await prisma.leadStore.update({
          where: { id: leadStore.id },
          data: { syncErrorMessage: String(err) },
        });
      }
    }

    console.log("[MyPlusLeads] Daily sync complete.");
  });
}
