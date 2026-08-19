import type { Prisma } from "@prisma/client";

// When an MPL-tagged contact is hard-deleted, write a tombstone so the next
// sync run skips re-importing it. We only tombstone contacts that carry the
// "MyPlusLeads" tag and have a non-null source (MLS number). Non-MPL contact
// deletes are ignored — the table stays scoped to MPL housekeeping.
export async function tombstoneMplContacts(
  tx: Prisma.TransactionClient,
  contactIds: string[],
): Promise<void> {
  if (contactIds.length === 0) return;

  const targets = await tx.contact.findMany({
    where: {
      id: { in: contactIds },
      tags: { has: "MyPlusLeads" },
      source: { not: null },
      userId: { not: null },
    },
    select: { userId: true, source: true },
  });

  if (targets.length === 0) return;

  await tx.myPlusLeadsDeletedSource.createMany({
    data: targets
      .filter((c): c is { userId: string; source: string } => c.userId !== null && c.source !== null)
      .map((c) => ({ userId: c.userId, source: c.source })),
    skipDuplicates: true,
  });
}
