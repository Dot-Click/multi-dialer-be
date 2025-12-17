import prisma from "../../../lib/prisma";

export async function insertNotificationInDb(payload: any, userId: string) {
  try {
    // Get user's systemSetting
    let systemSetting = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSetting) {
      // fallback in case systemSetting doesn't exist
      systemSetting = await prisma.system_Setting.create({
        data: { userId },
      });
    }

    // Insert NotificationSetting linked to systemSetting
    const notification = await prisma.notificationSetting.create({
      data: {
        ...payload,
        systemSettingId: systemSetting.id,
      },
    });

    return notification;
  } catch (error) {
    throw error; // controller will catch this and send response
  }
}