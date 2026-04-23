const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSmsLogs() {
  try {
    const logs = await prisma.smsLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        contact: {
          select: { fullName: true }
        },
        user: {
          select: { fullName: true, email: true }
        }
      }
    });
    console.log(JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkSmsLogs();
