import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testAdminSave() {
  const adminId = "T5jghyfqLQa0OF0JQ65Ax0UvlVaPrHid"; // From our debug script
  const payload = {
    appointmentReminder: true,
    appointmentReminderEmail: "admin@gmail.com",
    callActivityReport: true,
    dailyCallReportEmail: "admin@gmail.com",
    appointmentNotification: true,
    complianceAlert: true
  };

  console.log("Testing Save for Admin:", adminId);

  try {
    let systemSetting = await prisma.system_Setting.findFirst({
        where: { userId: adminId },
    });

    if (!systemSetting) {
        console.log("No SystemSetting found, creating one...");
        systemSetting = await prisma.system_Setting.create({
            data: { userId: adminId },
        });
    }

    console.log("Using SystemSetting ID:", systemSetting.id);

    const upserted = await prisma.notificationSetting.upsert({
        where: { systemSettingId: systemSetting.id },
        create: {
            ...payload,
            systemSettingId: systemSetting.id,
        },
        update: payload,
    });

    console.log("Successfully upserted record:", upserted.id);
    console.log("Saved Data:", upserted);

  } catch (err) {
    console.error("UPSERT FAILED:", err);
  }
}

testAdminSave()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
