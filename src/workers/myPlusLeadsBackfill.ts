import prisma from "../lib/prisma";
import { syncLeadsForConfig } from "../services/myPlusLeads.service";
import { notifyClients } from "../services/leadStoreNotify.service";

/**
 * One-time backfill: sync leads for every existing MyPlusLeads account that is
 * CONNECTED but has never had a successful sync (lastSyncAt is null).
 *
 * Runs once at server startup. Safe to re-deploy — the `lastSyncAt` check
 * ensures already-synced accounts are skipped automatically.
 *
 * Accounts in a FAILED state are no longer auto-repaired (credentials are now
 * entered manually by Client) — instead Client is notified to fix them.
 *
 * Each account is processed sequentially (not in parallel) to avoid hammering
 * the MyPlusLeads API with concurrent requests.
 */
export async function backfillMyPlusLeadsExistingUsers(): Promise<void> {
  const neverSynced = await prisma.myPlusLeadsConfig.findMany({
    where: { status: "CONNECTED", lastSyncAt: null },
    select: { id: true, userId: true },
  });

  console.log(`[MyPlusLeads Backfill] Found ${neverSynced.length} connected-but-never-synced account(s).`);

  for (const { id, userId } of neverSynced) {
    try {
      const result = await syncLeadsForConfig(id);
      console.log(`[MyPlusLeads Backfill] ✅ userId=${userId} config=${id} — imported: ${result.imported}, skipped: ${result.skipped}`);
    } catch (err: any) {
      console.error(`[MyPlusLeads Backfill] ❌ userId=${userId} config=${id} — ${err?.message ?? err}`);
      await prisma.myPlusLeadsConfig.update({
        where: { id },
        data: { errorMessage: err?.message ?? String(err) },
      }).catch(() => {});
    }
  }

  const failed = await prisma.myPlusLeadsConfig.findMany({
    where: { status: "FAILED" },
    select: { id: true, userId: true, label: true },
  });

  if (failed.length > 0) {
    console.log(`[MyPlusLeads Backfill] ${failed.length} account(s) in FAILED state — notifying Client.`);
    await notifyClients(
      "MyPlusLeads accounts need attention",
      `${failed.length} linked MyPlusLeads account(s) are in a FAILED state and need to be fixed or relinked: ${failed
        .map((f) => f.label || f.id)
        .join(", ")}.`,
      "myplusleads_failed",
    ).catch((err) => console.error("[MyPlusLeads Backfill] Failed to notify Client:", err));
  }

  console.log("[MyPlusLeads Backfill] Done.");
}
