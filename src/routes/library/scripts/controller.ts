import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertScriptInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateScriptSchema } from "../../../zod/script.schema";

export const getAllScriptsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
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

    // Get all scripts from user's library
    const scripts = await prisma.script.findMany({
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
    });
    successResponse(res, 200, "Scripts fetched", scripts);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};




export const getAllScriptsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all scripts from all users
    const scripts = await prisma.script.findMany({
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
    successResponse(res, 200, "All scripts fetched", scripts);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};



export const getScriptById = async (req: Request, res: Response): Promise<void> => {
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

    const script = await prisma.script.findFirst({
      where: { 
        id,
        libraryId: library.id, // Ensure script belongs to user's library
      },
      include: {
        lirary: {
          inbclude: {
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
    
    if (!script) {
      errorResponse(res, "Script not found", 404);
      return;
    }
    successResponse(res, 200, "Script fetched", script);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};




export const createScript = async (req: Request, res: Response): Promise<void> => {
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
    const newScript = await insertScriptInDb(payload, userId);

    // Include populated library and user info in response
    const populatedScript = await prisma.script.findUnique({
      where: { id: newScript.id },
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
    
    successResponse(res, 201, "Script created", populatedScript);
    
  } catch (error: any) {
    errorResponse(res, error.message || error, 500);
  }
};



export const updateScript = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if script exists
    const script = await prisma.script.findUnique({
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

    // If script doesn't exist, return error
    if (!script) {
      errorResponse(res, "Script not found", 404);
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

    // Check if script belongs to the user's library
    if (script.libraryId !== library.id) {
      errorResponse(res, "you can only update your script not other script", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateScriptSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // Update the script
    const updatedScript = await prisma.script.update({
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

    successResponse(res, 200, "Script updated", updatedScript);
    
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const deleteScript = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if script exists
    const script = await prisma.script.findUnique({
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

    // If script doesn't exist, return error
    if (!script) {
      errorResponse(res, "Script not found", 404);
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

    // Check if script belongs to the user's library
    if (script.libraryId !== library.id ) {
      errorResponse(res, "you can only delete your script not other script", 403);
      return;
    }

    // Delete the script
    await prisma.script.delete({
      where: { id },
    });

    

    successResponse(res, 200, "Script deleted successfully", null);
    
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};
