import cron from "node-cron";
import prisma from "../lib/prisma";
import { syncLeadsForLeadStore } from "../services/myPlusLeads.service";

export function startMyPlusLeadsSyncWorker() {
  // Runs at the top of every hour, US Central Time. MPL keeps adding new
  // leads throughout the US business day; the old 12/2/6 AM schedule left a
  // ~17-hour gap where same-day leads only landed the next morning. Hourly
  // sync + MPL's dateFrom/isForUser filter (see fetchListings) keeps the
  // window ≤1h without hammering the API — each run only pulls listings
  // added since lastSyncAt-48h, and dedup by MLS makes overlap free.
  cron.schedule("0 * * * *", async () => {
    console.log("[MyPlusLeads] Starting scheduled lead sync...");

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
  }, { timezone: "America/Chicago" });
}
