import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
// Assuming you have these schemas created similar to email.schema
import { createCallbackPromptSchema } from "../../../zod/callbackPrompt.schema";

export async function insertCallbackPromptInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = await validateData(createCallbackPromptSchema, payload) as any;

    if (!('data' in result)) {
      throw { errors: result };
    }

    const data = result.data;

    // Get or create user's library
    let library = await prisma.library.findFirst({
      where: { userId },
    });

    // If library doesn't exist, create it (fallback)
    if (!library) {
      library = await prisma.library.create({
        data: {
          userId,
        },
      });
    }

    // Insert callback prompt into DB with libraryId
    const callbackPrompt = await prisma.callbackPrompt.create({
      data: {
        ...data,
        libraryId: library.id,
      },
    });

    return callbackPrompt;
  } catch (error: any) {
    // Handle Prisma unique constraint error
    if (error.code === 'P2002') {
      // Check which field caused the unique constraint violation (e.g. promptName)
      if (error.meta?.target?.includes('promptName')) {
        throw { message: "Callback prompt name already exists for this library" };
      }
    }
    throw error;
  }
}