import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const records = await prisma.callRecord.findMany({ take: 1 });
    console.log("Records:", JSON.stringify(records, null, 2));
}

main().catch(e => console.error(e)).finally(async () => {
    await prisma.$disconnect();
});
