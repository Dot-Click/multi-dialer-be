import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createCallerIdSchema } from "../../../zod/callerId.schema";

export async function insertCallerIdInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = await validateData(createCallerIdSchema, payload) as any;

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

    // Insert CallerId into DB with systemSettingId
    const callerId = await prisma.callerId.create({
      data: {
        ...data,
        systemSettingId: systemSettings.id,
      },
    });

    return callerId;
  } catch (error) {
    throw error;
  }
}

