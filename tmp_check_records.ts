import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === "production") {
  console.error("❌ Script not allowed in production");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
    const records = await prisma.callRecord.findMany({ take: 1 });
    console.log("Records:", JSON.stringify(records, null, 2));
}

main().catch(e => console.error(e)).finally(async () => {
    await prisma.$disconnect();
});
