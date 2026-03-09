import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createSmsSchema } from "../../../schemas/sms.schema";

export async function insertSmsTemplateInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = await validateData(createSmsSchema, payload) as any;

    if (!('data' in result)) {
      throw { errors: result };
    }

    const data = result.data;

    // Get or create user's library
    let library = await prisma.library.findFirst({
      where: { userId },
    });

    // If library doesn't exist, create it (fallback in case auto-creation didn't work)
    if (!library) {
      library = await prisma.library.create({
        data: {
          userId,
        },
      });
    }

    // Insert SMS template into DB with libraryId
    const smsTemplate = await prisma.sMSTemplate.create({
      data: {
        ...data,
        libraryId: library.id,
      },
    });

    return smsTemplate;
  } catch (error: any) {
    // Handle Prisma unique constraint error
    if (error.code === 'P2002') {
      // Check which field caused the unique constraint violation
      if (error.meta?.target?.includes('templateName')) {
        throw { message: "Template name already exists" };
      }
    }
    throw error;
  }
}

