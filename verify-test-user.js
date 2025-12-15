// Quick script to verify test2@example.com in the database
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyTestUser() {
  try {
    const result = await prisma.user.updateMany({
      where: {
        email: 'test2@example.com',
      },
      data: {
        emailVerified: true,
      },
    });
    console.log(`✅ Verified test2@example.com - Updated ${result.count} user(s)`);
    
    // Check the user
    const user = await prisma.user.findUnique({
      where: { email: 'test2@example.com' },
      select: { email: true, emailVerified: true, id: true }
    });
    console.log('User status:', user);
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyTestUser();

