import prisma from "../lib/prisma";
import { syncLeadsForUser } from "../services/myPlusLeads.service";

/**
 * One-time backfill: sync leads for every existing user who has a connected
 * MyPlusLeads account but has NEVER had a successful sync (lastSyncAt is null).
 *
 * Runs once at server startup. Safe to re-deploy — the `lastSyncAt` check
 * ensures already-synced users are skipped automatically.
 *
 * Each user is processed sequentially (not in parallel) to avoid hammering
 * the MyPlusLeads API with concurrent requests.
 */
export async function backfillMyPlusLeadsExistingUsers(): Promise<void> {
  const unsynced = await prisma.myPlusLeadsConfig.findMany({
    where: {
      status: "CONNECTED",
      lastSyncAt: null,          // never synced
      subAccountEmail: { not: null },
      subAccountPassword: { not: null },
    },
    select: { userId: true },
  });

  if (unsynced.length === 0) {
    console.log("[MyPlusLeads Backfill] No unsynced users found. Nothing to do.");
    return;
  }

  console.log(`[MyPlusLeads Backfill] Found ${unsynced.length} user(s) with no prior sync. Starting backfill...`);

  for (const { userId } of unsynced) {
    try {
      const result = await syncLeadsForUser(userId);
      console.log(`[MyPlusLeads Backfill] ✅ userId=${userId} — imported: ${result.imported}, skipped: ${result.skipped}`);
    } catch (err: any) {
      console.error(`[MyPlusLeads Backfill] ❌ userId=${userId} — ${err?.message ?? err}`);
      // Log the error on the config so the admin can see it in the UI,
      // but don't let one failure stop the rest of the backfill.
      await prisma.myPlusLeadsConfig.update({
        where: { userId },
        data: { errorMessage: err?.message ?? String(err) },
      }).catch(() => {});
    }
  }

  console.log("[MyPlusLeads Backfill] Done.");
}
