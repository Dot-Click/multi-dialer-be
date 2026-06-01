import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === "production") {
  console.error("❌ Script not allowed in production");
  process.exit(1);
}

const prisma = new PrismaClient();

async function checkUsers() {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            createdById: true
        }
    });

    console.log('--- Current Users in DB ---');
    users.forEach(u => {
        console.log(`ID: ${u.id} | Name: ${u.fullName} | Email: ${u.email} | Role: ${u.role} | CreatedBy: ${u.createdById}`);
    });
    console.log('---------------------------');
}

checkUsers()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
