import prisma from "../../../lib/prisma";

// Create Dialer Settings (ensures SystemSetting exists)
export async function createDialerSettingInDb(payload: any, userId: string) {
  // Ensure SystemSetting exists for the user
  let systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
  
  if (!systemSetting) {
    systemSetting = await prisma.system_Setting.create({ data: { userId } });
  }

  // Create the Dialer Setting
  return await prisma.dialerSetting.create({
    data: {
      ...payload,
      systemSettingId: systemSetting.id,
    },
  });
}

// Get Dialer Settings
export async function getDialerSettingFromDb(userId: string) {
  const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSetting) return null;

  return await prisma.dialerSetting.findFirst({
    where: { systemSettingId: systemSetting.id },
  });
}

// Update Dialer Settings
export async function updateDialerSettingInDb(id: string, payload: any) {
  return await prisma.dialerSetting.update({
    where: { id },
    data: payload,
  });
}

// Delete Dialer Settings
export async function deleteDialerSettingFromDb(id: string) {
  return await prisma.dialerSetting.delete({
    where: { id },
  });
}