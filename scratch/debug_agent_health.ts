import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === "production") {
  console.error("❌ Script not allowed in production");
  process.exit(1);
}
const prisma = new PrismaClient();

async function debug() {
    const userId = 'IA1LtojKoAfgnpi66PUnoX8LLhbygtY6';
    
    console.log('--- Agent Info ---');
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { callerIds: true, createdBy: true }
    });
    console.log('User:', JSON.stringify(user, null, 2));

    console.log('\n--- Call Settings ---');
    const callSettings = await prisma.callSettings.findMany({
        where: { systemSetting: { userId } }
    });
    console.log('Call Settings:', JSON.stringify(callSettings, null, 2));

    if (callSettings.length > 0) {
        const callerIdStr = callSettings[0].callerId || '';
        const ids = callerIdStr.split(',').map(i => i.trim()).filter(Boolean);
        console.log('IDs from CallSettings:', ids);

        console.log('\n--- Searching for Caller IDs ---');
        const foundById = await prisma.callerId.findMany({
            where: { id: { in: ids } }
        });
        console.log('Found by ID:', foundById.length);

        const foundByNumber = await prisma.callerId.findMany({
            where: { twillioNumber: { in: ids } }
        });
        console.log('Found by Number (exact):', foundByNumber.length);

        const normalizedIds = ids.map(i => i.replace(/\s+/g, ''));
        const foundByNumberNormalized = await prisma.callerId.findMany({
            where: { twillioNumber: { in: normalizedIds } }
        });
        console.log('Found by Number (normalized):', foundByNumberNormalized.length);
    }

    await prisma.$disconnect();
}

debug();
