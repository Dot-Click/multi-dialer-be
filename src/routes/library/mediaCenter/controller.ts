import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertMediaCenterInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateMediaCenterSchema } from "../../../zod/mediaCenter.schema";

export const getAllMediaCenterOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
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

    // Get all media center items from user's library
    const mediaCenterItems = await prisma.mediaCenter.findMany({
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
    successResponse(res, 200, "Media center items fetched", mediaCenterItems);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllMediaCenterOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all media center items from all users
    const mediaCenterItems = await prisma.mediaCenter.findMany({
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
    successResponse(res, 200, "All media center items fetched", mediaCenterItems);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getMediaCenterById = async (req: Request, res: Response): Promise<void> => {
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

    const mediaCenterItem = await prisma.mediaCenter.findFirst({
      where: { 
        id,
        libraryId: library.id, // Ensure media center item belongs to user's library
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
    
    if (!mediaCenterItem) {
      errorResponse(res, "Media center item not found", 404);
      return;
    }
    successResponse(res, 200, "Media center item fetched", mediaCenterItem);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createMediaCenter = async (req: Request, res: Response): Promise<void> => {
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
      
    // Ensure req.body exists and is an object
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
      errorResponse(res, {
        errors: [
          {
            expected: "object",
            code: "invalid_type",
            path: ["body"],
            message: "Request body is required and must be a valid JSON object"
          }
        ]
      }, 400);
      return;
    }
    
    const payload = { ...req.body };
    const file = req.file;
    const newMediaCenter = await insertMediaCenterInDb(payload, userId, file);

    // Include populated library and user info in response
    const populatedMediaCenter = await prisma.mediaCenter.findUnique({
      where: { id: newMediaCenter.id },
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
    
    successResponse(res, 201, "Media center item created", populatedMediaCenter);
    
  } catch (error: any) {
    errorResponse(res, error.message || error, 500);
  }
};

export const updateMediaCenter = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if media center item exists
    const mediaCenterItem = await prisma.mediaCenter.findUnique({
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

    // If media center item doesn't exist, return error
    if (!mediaCenterItem) {
      errorResponse(res, "Media center item not found", 404);
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

    // Check if media center item belongs to the user's library
    if (mediaCenterItem.libraryId !== library.id) {
      errorResponse(res, "you can only update your media center item not other media center item", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateMediaCenterSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // Update the media center item
    const updatedMediaCenter = await prisma.mediaCenter.update({
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

    successResponse(res, 200, "Media center item updated", updatedMediaCenter);
    
  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "Media center item not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deleteMediaCenter = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if media center item exists
    const mediaCenterItem = await prisma.mediaCenter.findUnique({
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

    // If media center item doesn't exist, return error
    if (!mediaCenterItem) {
      errorResponse(res, "Media center item not found", 404);
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

    // Check if media center item belongs to the user's library
    if (mediaCenterItem.libraryId !== library.id) {
      errorResponse(res, "you can only delete your media center item not other media center item", 403);
      return;
    }

    // Delete the media center item
    await prisma.mediaCenter.delete({
      where: { id },
    });

    successResponse(res, 200, "Media center item deleted successfully", null);
    
  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "Media center item not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

