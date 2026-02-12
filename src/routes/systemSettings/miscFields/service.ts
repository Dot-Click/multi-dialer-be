import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createMiscFieldSchema } from "../../../schemas/miscFields.schema";

export async function insertMiscFieldInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = await validateData(createMiscFieldSchema, payload) as any;

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

    // Prepare data for Prisma - set defaults for fields not relevant to the type
    const prismaData: any = {
      type: data.type,
      fieldName: data.fieldName,
      systemSettingId: systemSettings.id,
    };

    // Set type-specific fields
    if (data.type === "dropdown") {
      prismaData.options = data.options;
    } else {
      prismaData.options = []; // Empty array for non-dropdown types
    }

    if (data.type === "counter") {
      prismaData.countFrom = data.countFrom;
      prismaData.countTo = data.countTo;
    }

    if (data.type === "date") {
      prismaData.allowPastDates = data.allowPastDates ?? false;
    }

    // Insert MiscField into DB with systemSettingId
    const miscField = await prisma.miscField.create({
      data: prismaData,
    });

    return miscField;
  } catch (error) {
    throw error;
  }
}

