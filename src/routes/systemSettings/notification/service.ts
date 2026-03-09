import prisma from "../../../lib/prisma";

// 1. Create Notification Settings
export async function createNotificationInDb(payload: any, userId: string) {
  // Ensure SystemSetting exists
  let systemSetting = await prisma.system_Setting.findFirst({
    where: { userId },
  });

  if (!systemSetting) {
    systemSetting = await prisma.system_Setting.create({
      data: { userId },
    });
  }

  const data = payload
  console.log(data)
  // Create Notification Setting
  // return await prisma.notificationSetting.create({
  //   data: {
  //     ...payload,
  //     systemSettingId: systemSetting.id,
  //   },
  //   include: {
  //     systemSetting: true // Optional return data
  //   }
  // });
}

// 2. Get All (For Admin/Owner viewing)
export async function getAllNotificationsFromDb() {
  return await prisma.notificationSetting.findMany({
    include: {
      systemSetting: {
        include: {
          user: { select: { id: true, fullName: true, email: true } }
        }
      }
    }
  });
}

// 3. Get Mine (Logged-in User)
export async function getNotificationFromDb(userId: string) {
  const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSetting) return null;

  return await prisma.notificationSetting.findFirst({
    where: { systemSettingId: systemSetting.id },
    include: {
      systemSetting: true
    }
  });
}

// 4. Get By ID (Specific)
export async function getNotificationByIdFromDb(id: string) {
  return await prisma.notificationSetting.findUnique({
    where: { id },
    include: {
      systemSetting: true
    }
  });
}

// 5. Update (Strict Ownership Check)
export async function updateNotificationInDb(id: string, payload: any, userId: string) {
  // Check if this notification belongs to the user requesting the update
  const isMine = await prisma.notificationSetting.findFirst({
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

  return await prisma.notificationSetting.update({
    where: { id },
    data: payload,
  });
}

// 6. Delete (Strict Ownership Check)
export async function deleteNotificationFromDb(id: string, userId: string) {
  // Check ownership
  const isMine = await prisma.notificationSetting.findFirst({
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

  return await prisma.notificationSetting.delete({
    where: { id },
  });
}