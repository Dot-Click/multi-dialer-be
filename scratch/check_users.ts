import { PrismaClient } from '@prisma/client';

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
