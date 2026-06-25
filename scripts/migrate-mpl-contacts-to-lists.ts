import prisma from "../src/lib/prisma";

async function main() {
  // Find all MyPlusLeads contacts that aren't in any list yet
  const contacts = await prisma.contact.findMany({
    where: { tags: { has: "MyPlusLeads" } },
    select: { id: true, userId: true, tags: true },
  });

  console.log(`Found ${contacts.length} MyPlusLeads contacts to migrate`);

  // Group by userId + status tag
  const listCache = new Map<string, string>(); // "userId:status" -> listId

  const getOrCreateList = async (userId: string, status: string) => {
    const key = `${userId}:${status}`;
    if (listCache.has(key)) return listCache.get(key)!;

    let list = await prisma.contactList.findFirst({
      where: { userId, name: status, folderId: null },
    });
    if (!list) {
      list = await prisma.contactList.create({
        data: { name: status, userId, contactIds: [] },
      });
      console.log(`  Created list: "${status}" for user ${userId}`);
    } else {
      console.log(`  Found existing list: "${status}" for user ${userId}`);
    }

    listCache.set(key, list.id);
    return list.id;
  };

  let assigned = 0;
  for (const contact of contacts) {
    if (!contact.userId) continue;

    // Find the status tag (anything that isn't "MyPlusLeads")
    const status = contact.tags.find((t) => t !== "MyPlusLeads") ?? "Expired";
    const listId = await getOrCreateList(contact.userId, status);

    // Check if already in this list
    const list = await prisma.contactList.findUnique({ where: { id: listId }, select: { contactIds: true } });
    if (list?.contactIds.includes(contact.id)) continue;

    await prisma.contactList.update({
      where: { id: listId },
      data: { contactIds: { push: contact.id } },
    });
    assigned++;
  }

  console.log(`\nDone. Assigned ${assigned} contacts to lists.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
