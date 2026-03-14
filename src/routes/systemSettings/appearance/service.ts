import prisma from "../../../lib/prisma";

export async function insertAppearanceInDb(payload: any, userId: string) {
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

    // Insert Appearance linked to systemSetting
    const appearance = await prisma.appearance.create({
      data: {
        ...payload,
        systemSettingId: systemSetting.id,
      },
    });

    return appearance;
  } catch (error) {
    throw error; // controller me catch hoke response bhejega
  }
}