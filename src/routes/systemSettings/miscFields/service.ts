import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createMiscFieldSchema } from "../../../schemas/miscFields.schema";
import { DEFAULT_MISC_FIELDS } from "./defaults";

export async function cleanupDuplicateMiscFields(systemSettingId: string) {
  try {
    const fields = await prisma.miscField.findMany({
      where: { systemSettingId },
      orderBy: { createdAt: 'asc' }
    });

    const seen = new Set<string>();
    const toDelete: string[] = [];

    for (const field of fields) {
      const normalizedName = field.fieldName.trim().toLowerCase();
      if (seen.has(normalizedName)) {
        toDelete.push(field.id);
      } else {
        seen.add(normalizedName);
      }
    }

    if (toDelete.length > 0) {
      await prisma.miscField.deleteMany({
        where: { id: { in: toDelete } }
      });
      console.log(`[MiscFieldService] Cleaned up ${toDelete.length} duplicates for ${systemSettingId}`);
    }
  } catch (error) {
    console.error(`[MiscFieldService] Cleanup failed:`, error);
  }
}

export async function ensureDefaultMiscFields(systemSettingId: string) {
  try {
    const existingFields = await prisma.miscField.findMany({
      where: { systemSettingId },
      select: { fieldName: true }
    });

    const existingNames = new Set(existingFields.map(f => f.fieldName.trim().toLowerCase()));
    const missingFields = DEFAULT_MISC_FIELDS.filter(f => !existingNames.has(f.fieldName.trim().toLowerCase()));

    if (missingFields.length > 0) {
      await prisma.miscField.createMany({
        data: missingFields.map(f => ({
          ...f,
          systemSettingId,
          options: []
        }))
      });
    }
  } catch (error) {
    console.error(`[MiscFieldService] Failed to ensure defaults for ${systemSettingId}:`, error);
  }
}

export async function insertMiscFieldInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = await validateData(createMiscFieldSchema, payload) as any;
    console.log(result)
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

