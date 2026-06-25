import prisma from "../src/lib/prisma";

async function main() {
  const config = await prisma.myPlusLeadsConfig.findFirst({
    where: { subAccountEmail: { contains: "v3" } },
  });
  const count = await prisma.contact.count({ where: { userId: config?.userId ?? "" } });
  console.log("Config:", JSON.stringify({ status: config?.status, lastSyncAt: config?.lastSyncAt, errorMessage: config?.errorMessage }));
  console.log("Contacts imported:", count);
}

main().catch(console.error).finally(() => prisma.$disconnect());
