import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === "production") {
  console.error("❌ Script not allowed in production");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
    const calendars = await prisma.calendar.findMany();
    console.log(JSON.stringify(calendars, null, 2));
}

main().catch(e => console.error(e)).finally(async () => {
    await prisma.$disconnect();
});
