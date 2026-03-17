import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userId = '08253198-d4a3-4876-8051-78716b06060c'; // This is a guess, I need to find the actual user id. 
  // Better yet, let's list all system settings and notification settings.

  console.log("--- Users ---");
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true }
  });
  console.log(JSON.stringify(users, null, 2));

  console.log("\n--- System Settings ---");
  const systemSettings = await prisma.system_Setting.findMany();
  console.log(JSON.stringify(systemSettings, null, 2));

  console.log("\n--- Notification Settings ---");
  const notifSettings = await prisma.notificationSetting.findMany();
  console.log(JSON.stringify(notifSettings, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
