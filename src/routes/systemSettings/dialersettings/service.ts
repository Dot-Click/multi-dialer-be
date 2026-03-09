import prisma from "../../../lib/prisma";

// Create Dialer Settings
export async function createDialerSettingInDb(payload: any, userId: string) {
  let systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
  
  if (!systemSetting) {
    systemSetting = await prisma.system_Setting.create({ data: { userId } });
  }

  return await prisma.dialerSetting.create({
    data: {
      ...payload,
      systemSettingId: systemSetting.id,
    },
  });
}

// Get All (For Admin/Owner viewing)
export async function getAllDialerSettingsFromDb() {
  return await prisma.dialerSetting.findMany({
    include: {
      systemSetting: true 
    }
  });
}

// Get Mine
export async function getDialerSettingFromDb(userId: string) {
  const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSetting) return null;

  return await prisma.dialerSetting.findFirst({
    where: { systemSettingId: systemSetting.id },
  });
}

// Get Specific ID (View only)
export async function getDialerSettingByIdFromDb(id: string) {
  return await prisma.dialerSetting.findUnique({
    where: { id },
  });
}

// Update (Restricted to Owner only)
export async function updateDialerSettingInDb(id: string, payload: any, userId: string) {
  // 1. Check ownership: Does this dialerSetting belong to the user's systemSetting?
  const isMine = await prisma.dialerSetting.findFirst({
    where: {
      id: id,
      systemSetting: {
        userId: userId
      }
    }
  });

  if (!isMine) {
    throw new Error("Unauthorized: You can only update your own settings.");
  }

  // 2. Perform Update
  return await prisma.dialerSetting.update({
    where: { id },
    data: payload,
  });
}

// Delete (Restricted to Owner only)
export async function deleteDialerSettingFromDb(id: string, userId: string) {
  // 1. Check ownership
  const isMine = await prisma.dialerSetting.findFirst({
    where: {
      id: id,
      systemSetting: {
        userId: userId
      }
    }
  });

  if (!isMine) {
    throw new Error("Unauthorized: You can only delete your own settings.");
  }

  // 2. Perform Delete
  return await prisma.dialerSetting.delete({
    where: { id },
  });
}