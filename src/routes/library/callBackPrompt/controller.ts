import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertCallbackPromptInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateCallbackPromptSchema } from "../../../zod/callbackPrompt.schema";

export const getAllCallbackPromptsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    
    // Get user's library
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      errorResponse(res, "Library not found for user", 404);
      return;
    }

    // Get all callback prompts from user's library
    const callbackPrompts = await prisma.callbackPrompt.findMany({
      where: {
        libraryId: library.id,
      },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    successResponse(res, 200, "Callback prompts fetched", callbackPrompts);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllCallbackPromptsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all callback prompts from all users
    const callbackPrompts = await prisma.callbackPrompt.findMany({
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    successResponse(res, 200, "All callback prompts fetched", callbackPrompts);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getCallbackPromptById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Get user's library
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      errorResponse(res, "Library not found for user", 404);
      return;
    }

    const callbackPrompt = await prisma.callbackPrompt.findFirst({
      where: { 
        id,
        libraryId: library.id, // Ensure it belongs to user's library
      },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });
    
    if (!callbackPrompt) {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }
    successResponse(res, 200, "Callback prompt fetched", callbackPrompt);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    // Check if user exists
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userExists) {
      errorResponse(res, "User not found", 404);
      return;
    }
      
    const payload = { ...req.body };
    const newCallbackPrompt = await insertCallbackPromptInDb(payload, userId);

    // Include populated library and user info in response
    const populatedCallbackPrompt = await prisma.callbackPrompt.findUnique({
      where: { id: newCallbackPrompt.id },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });
    
    successResponse(res, 201, "Callback prompt created", populatedCallbackPrompt);
    
  } catch (error: any) {
    // Handle unique constraint error
    if (error.message === "Callback prompt name already exists for this library") {
      errorResponse(res, error.message, 409);
      return;
    }
    errorResponse(res, error.message || error, 500);
  }
};

export const updateCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if callback prompt exists
    const callbackPrompt = await prisma.callbackPrompt.findUnique({
      where: { id },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    // If it doesn't exist, return error
    if (!callbackPrompt) {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }

    // Get user's library
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      errorResponse(res, "Library not found for user", 404);
      return;
    }

    // Check ownership
    if (callbackPrompt.libraryId !== library.id) {
      errorResponse(res, "You cannot update another user's callback prompt", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateCallbackPromptSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // Update the callback prompt
    const updatedCallbackPrompt = await prisma.callbackPrompt.update({
      where: { id },
      data: {
        ...data,
      },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    successResponse(res, 200, "Callback prompt updated", updatedCallbackPrompt);
    
  } catch (error: any) {
    // Handle unique constraint error
    if (error.code === 'P2002' && error.meta?.target?.includes('promptName')) {
      errorResponse(res, "Callback prompt name already exists for this library", 409);
      return;
    }
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deleteCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if callback prompt exists
    const callbackPrompt = await prisma.callbackPrompt.findUnique({
      where: { id },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    // If it doesn't exist, return error
    if (!callbackPrompt) {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }

    // Get user's library
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      errorResponse(res, "Library not found for user", 404);
      return;
    }

    // Check ownership
    if (callbackPrompt.libraryId !== library.id) {
      errorResponse(res, "You cannot delete another user's callback prompt", 403);
      return;
    }

    // Delete the callback prompt
    await prisma.callbackPrompt.delete({
      where: { id },
    });

    successResponse(res, 200, "Callback prompt deleted successfully", null);
    
  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};