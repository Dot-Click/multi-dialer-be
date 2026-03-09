import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createScriptSchema } from "../../../schemas/script.schema"; // You need to create this schema

export async function insertScriptInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = await validateData(createScriptSchema, payload) as any;

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

    // Insert script into DB with libraryId
    const script = await prisma.script.create({
      data: {
        ...data,
        libraryId: library.id,
      },
    });

    return script;
  } catch (error: any) {
    // Handle Prisma unique constraint error
    if (error.code === 'P2002') {
      // Check which field caused the unique constraint violation
      if (error.meta?.target?.includes('scriptName')) {
        throw { message: "Script name already exists" };
      }
    }
    throw error;
  }
}
