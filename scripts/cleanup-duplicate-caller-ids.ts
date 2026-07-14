/**
 * Cleanup duplicate CallerId rows for ONE client.
 *
 * The `caller_id` table has no unique constraint on twillioNumber, so the same
 * physical Twilio number can end up as multiple separate CallerId rows (seen
 * in production for at least one client). The number-selection modal on the
 * frontend renders one checkbox per ROW but tracks selection by NUMBER VALUE,
 * so duplicate rows make "N boxes checked" collapse to fewer unique numbers
 * once sent to the backend — the exact bug reported: 31 rows picked, 19
 * distinct numbers arrived.
 *
 * This script finds duplicate CallerId rows (same twillioNumber, same
 * systemSettingId) for a single client (identified by email), and merges each
 * duplicate cluster down to one row:
 *   - keeper = the row with the most CallRecord history (tie-break: highest
 *     callCount, then earliest createdAt) — i.e. the row real usage lives on.
 *   - every CallRecord, default-caller-id reference, and agent assignment on
 *     the losing row(s) is re-pointed to the keeper BEFORE the loser is
 *     deleted, so no history or assignment is lost.
 *   - callCount is summed across the cluster; frozen/cooldown state is taken
 *     from whichever row is CURRENTLY frozen with the latest unfreezeAt, so a
 *     live cooldown is never accidentally cleared by the merge.
 *
 * SAFE BY DEFAULT: running with no flags only REPORTS what it would do. Nothing
 * is written to the database unless you pass --confirm.
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-caller-ids.ts --email=json@slingmo.com
 *   npx tsx scripts/cleanup-duplicate-caller-ids.ts --email=json@slingmo.com --confirm
 */

import prisma from "../src/lib/prisma";

function parseArgs() {
  const args = process.argv.slice(2);
  const email = args.find((a) => a.startsWith("--email="))?.split("=")[1];
  const confirm = args.includes("--confirm");
  return { email, confirm };
}

/** Strip everything but digits so "+18303609778" and "18303609778" group together. */
function normalizeNumber(n: string | null | undefined): string {
  return (n || "").replace(/\D/g, "");
}

async function resolveTenantRootId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, createdById: true },
  });
  if (!user) return userId;
  return user.role === "AGENT" && user.createdById ? user.createdById : user.id;
}

type CallerIdRow = {
  id: string;
  label: string;
  twillioNumber: string | null;
  callCount: number;
  frozenAt: Date | null;
  unfreezeAt: Date | null;
  createdAt: Date;
  systemSettingId: string;
  agents: { id: string; fullName: string | null; email: string }[];
  _count: { callRecords: number; defaultForUsers: number };
};

async function main() {
  const { email, confirm } = parseArgs();
  if (!email) {
    console.error("Usage: tsx scripts/cleanup-duplicate-caller-ids.ts --email=<client email> [--confirm]");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const rootId = await resolveTenantRootId(user.id);
  const systemSetting = await prisma.system_Setting.findFirst({ where: { userId: rootId } });
  if (!systemSetting) {
    console.error(`No System_Setting found for root user ${rootId} (from ${email}).`);
    process.exit(1);
  }

  console.log(`Client: ${email} (userId=${user.id}, role=${user.role})`);
  console.log(`Resolved tenant root: ${rootId}, systemSettingId: ${systemSetting.id}\n`);

  const rows = (await prisma.callerId.findMany({
    where: { systemSettingId: systemSetting.id },
    select: {
      id: true,
      label: true,
      twillioNumber: true,
      callCount: true,
      frozenAt: true,
      unfreezeAt: true,
      createdAt: true,
      systemSettingId: true,
      agents: { select: { id: true, fullName: true, email: true } },
      _count: { select: { callRecords: true, defaultForUsers: true } },
    },
    orderBy: { createdAt: "asc" },
  })) as unknown as CallerIdRow[];

  console.log(`Total caller_id rows for this client: ${rows.length}`);

  const groups = new Map<string, CallerIdRow[]>();
  for (const row of rows) {
    const key = normalizeNumber(row.twillioNumber);
    if (!key) continue; // rows with no number can't be duplicates by number
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const duplicateClusters = Array.from(groups.entries()).filter(([, g]) => g.length > 1);

  if (duplicateClusters.length === 0) {
    console.log("\nNo duplicate caller IDs found for this client. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFound ${duplicateClusters.length} duplicate number(s), ${duplicateClusters.reduce((s, [, g]) => s + g.length, 0)} rows total involved:\n`);

  const now = Date.now();
  let totalToDelete = 0;

  for (const [key, cluster] of duplicateClusters) {
    // Keeper: most CallRecord history wins, then highest callCount, then oldest row.
    const sorted = [...cluster].sort((a, b) => {
      if (b._count.callRecords !== a._count.callRecords) return b._count.callRecords - a._count.callRecords;
      if (b.callCount !== a.callCount) return b.callCount - a.callCount;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keeper = sorted[0];
    const losers = sorted.slice(1);
    totalToDelete += losers.length;

    console.log(`Number ${cluster[0].twillioNumber} (normalized ${key}) — ${cluster.length} rows:`);
    for (const r of sorted) {
      const tag = r.id === keeper.id ? "KEEP " : "MERGE";
      console.log(
        `  [${tag}] id=${r.id} label="${r.label}" callRecords=${r._count.callRecords} ` +
        `callCount=${r.callCount} defaultForUsers=${r._count.defaultForUsers} ` +
        `agents=[${r.agents.map((a) => a.email).join(", ")}] createdAt=${r.createdAt.toISOString()} ` +
        `frozenAt=${r.frozenAt?.toISOString() ?? "-"} unfreezeAt=${r.unfreezeAt?.toISOString() ?? "-"}`
      );
    }

    if (confirm) {
      const loserIds = losers.map((l) => l.id);

      // Merge frozen state: keep whichever row is currently frozen with the
      // latest unfreezeAt, so an active cooldown is never lost by the merge.
      const currentlyFrozen = cluster.filter((r) => r.unfreezeAt && r.unfreezeAt.getTime() > now);
      const mostRestrictive = currentlyFrozen.sort(
        (a, b) => (b.unfreezeAt!.getTime() - a.unfreezeAt!.getTime())
      )[0];
      const mergedCallCount = cluster.reduce((sum, r) => sum + r.callCount, 0);

      // Union every loser's assigned agents onto the keeper.
      const agentIdsToConnect = losers.flatMap((l) => l.agents.map((a) => ({ id: a.id })));

      await prisma.$transaction([
        prisma.callRecord.updateMany({
          where: { callerIdId: { in: loserIds } },
          data: { callerIdId: keeper.id },
        }),
        prisma.user.updateMany({
          where: { defaultCallerId: { in: loserIds } },
          data: { defaultCallerId: keeper.id },
        }),
        prisma.callerId.update({
          where: { id: keeper.id },
          data: {
            callCount: mergedCallCount,
            frozenAt: mostRestrictive?.frozenAt ?? keeper.frozenAt,
            unfreezeAt: mostRestrictive?.unfreezeAt ?? keeper.unfreezeAt,
            ...(agentIdsToConnect.length > 0 ? { agents: { connect: agentIdsToConnect } } : {}),
          },
        }),
        prisma.callerId.deleteMany({ where: { id: { in: loserIds } } }),
      ]);

      console.log(`  → Merged. Kept ${keeper.id}, deleted ${loserIds.length} duplicate row(s).\n`);
    } else {
      console.log("");
    }
  }

  if (!confirm) {
    console.log(`DRY RUN ONLY. ${totalToDelete} duplicate row(s) would be deleted across ${duplicateClusters.length} number(s).`);
    console.log("Re-run with --confirm to actually perform the merge.");
  } else {
    console.log(`Done. Deleted ${totalToDelete} duplicate row(s) across ${duplicateClusters.length} number(s).`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
