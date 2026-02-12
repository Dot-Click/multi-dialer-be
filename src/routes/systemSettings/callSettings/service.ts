import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createCallSettingsSchema } from "../../../schemas/callSettings.schema";

export async function insertCallSettingsInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = await validateData(createCallSettingsSchema, payload) as any;

    if (!('data' in result)) {
      throw { errors: result };
    }

    const data = result.data;

    // Get or create user's systemSettings
    let systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    // If systemSettings doesn't exist, create it (fallback in case auto-creation didn't work)
    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({
        data: {
          userId,
        },
      });
    }

    // Insert CallSettings into DB with systemSettingId
    const callSettings = await prisma.callSettings.create({
      data: {
        ...data,
        systemSettingId: systemSettings.id,
      },
    });

    return callSettings;
  } catch (error) {
    throw error;
  }
}

