import prisma from "../lib/prisma";
import { syncLeadsForUser, repairAndSyncUser } from "../services/myPlusLeads.service";

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
  // Case 1: CONNECTED but never synced — try a straight sync first.
  // Case 2: FAILED or missing credentials — use repair (re-provisions credentials).
  const allPending = await prisma.myPlusLeadsConfig.findMany({
    where: {
      OR: [
        // Never synced but apparently connected
        { status: "CONNECTED", lastSyncAt: null },
        // Failed provisioning — credentials may be missing
        { status: "FAILED" },
      ],
    },
    select: { userId: true, status: true, subAccountEmail: true, subAccountPassword: true },
  });

  if (allPending.length === 0) {
    console.log("[MyPlusLeads Backfill] No pending users found. Nothing to do.");
    return;
  }

  console.log(`[MyPlusLeads Backfill] Found ${allPending.length} user(s) needing sync/repair.`);

  for (const cfg of allPending) {
    const { userId } = cfg;
    const needsRepair = cfg.status === "FAILED" || !cfg.subAccountEmail || !cfg.subAccountPassword;

    try {
      let result;
      if (needsRepair) {
        console.log(`[MyPlusLeads Backfill] Repairing credentials for userId=${userId}...`);
        result = await repairAndSyncUser(userId);
      } else {
        result = await syncLeadsForUser(userId);
      }
      console.log(`[MyPlusLeads Backfill] ✅ userId=${userId} — imported: ${result.imported}, skipped: ${result.skipped}`);
    } catch (err: any) {
      console.error(`[MyPlusLeads Backfill] ❌ userId=${userId} — ${err?.message ?? err}`);
      await prisma.myPlusLeadsConfig.update({
        where: { userId },
        data: { errorMessage: err?.message ?? String(err) },
      }).catch(() => {});
    }
  }

  console.log("[MyPlusLeads Backfill] Done.");
}
