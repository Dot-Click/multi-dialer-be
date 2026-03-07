import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const calendars = await prisma.calendar.findMany();
    console.log(JSON.stringify(calendars, null, 2));
}

main().catch(e => console.error(e)).finally(async () => {
    await prisma.$disconnect();
});
