import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertCallerIdInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateCallerIdSchema } from "../../../schemas/callerId.schema";

export const getAllCallerIdsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    
    // Get user's systemSettings
    const systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }

    // Get all CallerIds from user's systemSettings
    const callerIds = await prisma.callerId.findMany({
      where: {
        systemSettingId: systemSettings.id,
      },
      include: {
        systemSetting: {
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
    successResponse(res, 200, "CallerIds fetched", callerIds);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllCallerIdsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all CallerIds from all users
    const callerIds = await prisma.callerId.findMany({
      include: {
        systemSetting: {
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
    successResponse(res, 200, "All CallerIds fetched", callerIds);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getCallerIdById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Get user's systemSettings
    const systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }

    const callerId = await prisma.callerId.findFirst({
      where: { 
        id,
        systemSettingId: systemSettings.id, // Ensure CallerId belongs to user's systemSettings
      },
      include: {
        systemSetting: {
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
    
    if (!callerId) {
      errorResponse(res, "CallerId not found", 404);
      return;
    }
    successResponse(res, 200, "CallerId fetched", callerId);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createCallerId = async (req: Request, res: Response): Promise<void> => {
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
    const newCallerId = await insertCallerIdInDb(payload, userId);

    // Include populated systemSetting and user info in response
    const populatedCallerId = await prisma.callerId.findUnique({
      where: { id: newCallerId.id },
      include: {
        systemSetting: {
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
    
    successResponse(res, 201, "CallerId created", populatedCallerId);
    
  } catch (error: any) {
    errorResponse(res, error.message || error, 500);
  }
};

export const updateCallerId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if CallerId exists
    const callerId = await prisma.callerId.findUnique({
      where: { id },
      include: {
        systemSetting: {
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

    // If CallerId doesn't exist, return error
    if (!callerId) {
      errorResponse(res, "CallerId not found", 404);
      return;
    }

    // Get user's systemSettings
    const systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }

    // Check if CallerId belongs to the user's systemSettings
    if (callerId.systemSettingId !== systemSettings.id) {
      errorResponse(res, "You cannot update or delete another user's CallerId", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateCallerIdSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // Update the CallerId
    const updatedCallerId = await prisma.callerId.update({
      where: { id },
      data: {
        ...data,
      },
      include: {
        systemSetting: {
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

    successResponse(res, 200, "CallerId updated", updatedCallerId);
    
  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "CallerId not found", 404);
      return;
    }
    // Check if error is related to ownership (shouldn't happen here, but just in case)
    if (error.message && error.message.includes("cannot update")) {
      errorResponse(res, error.message, 403);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deleteCallerId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if CallerId exists
    const callerId = await prisma.callerId.findUnique({
      where: { id },
      include: {
        systemSetting: {
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

    // If CallerId doesn't exist, return error
    if (!callerId) {
      errorResponse(res, "CallerId not found", 404);
      return;
    }

    // Get user's systemSettings
    const systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }

    // Check if CallerId belongs to the user's systemSettings
    if (callerId.systemSettingId !== systemSettings.id) {
      errorResponse(res, "You cannot update or delete another user's CallerId", 403);
      return;
    }

    // Delete the CallerId
    await prisma.callerId.delete({
      where: { id },
    });

    successResponse(res, 200, "CallerId deleted successfully", null);
    
  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "CallerId not found", 404);
      return;
    }
    // Check if error is related to ownership (shouldn't happen here, but just in case)
    if (error.message && error.message.includes("cannot delete")) {
      errorResponse(res, error.message, 403);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

