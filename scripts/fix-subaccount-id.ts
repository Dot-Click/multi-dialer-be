import prisma from "../src/lib/prisma";

async function main() {
  const r = await prisma.myPlusLeadsConfig.updateMany({
    where: { subAccountId: "null" },
    data: { subAccountId: "52573" },
  });
  console.log("Fixed rows:", r.count);
}

main().finally(() => prisma.$disconnect());
