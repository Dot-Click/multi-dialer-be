import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === "production") {
  console.error("❌ Script not allowed in production");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
    const sessions = await prisma.agentSession.findMany({
        include: {
            user: {
                select: { fullName: true }
            }
        }
    });
    console.log("Sessions:", JSON.stringify(sessions, null, 2));
}

main().catch(e => console.error(e)).finally(async () => {
    await prisma.$disconnect();
});
