import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === "production") {
  console.error("❌ Script not allowed in production");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        select: { id: true, fullName: true, role: true, email: true }
    });
    console.log("Users:", JSON.stringify(users, null, 2));

    const events = await prisma.calendar.findMany();
    console.log("Events:", JSON.stringify(events, null, 2));
}

main().catch(e => console.error(e)).finally(async () => {
    await prisma.$disconnect();
});
