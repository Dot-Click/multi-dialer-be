import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const sessions = await prisma.session.findMany({ take: 5, include: { user: { select: { fullName: true } } } });
    console.log("Sessions:", JSON.stringify(sessions, null, 2));
}

main().catch(e => console.error(e)).finally(async () => {
    await prisma.$disconnect();
});
