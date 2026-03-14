import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertCallSettingsInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateCallSettingsSchema } from "../../../schemas/callSettings.schema";

export const getAllCallSettingsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    
    // Get user's systemSettings
    const systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      errorResponse(res, "System Settings not found for user", 404);
      return;
    }

    // Get all CallSettings from user's systemSettings
    const callSettings = await prisma.callSettings.findMany({
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
        onHoldRecording1: true,
        onHoldRecording2: true,
        ivrRecording: true,
        answeringMachineRecording: true,
      },
    });
    successResponse(res, 200, "CallSettings fetched", callSettings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllCallSettingsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all CallSettings from all users
    const callSettings = await prisma.callSettings.findMany({
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
    successResponse(res, 200, "All Call Settings fetched", callSettings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getCallSettingsById = async (req: Request, res: Response): Promise<void> => {
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

    const callSettings = await prisma.callSettings.findFirst({
      where: { 
        id,
        systemSettingId: systemSettings.id, // Ensure CallSettings belongs to user's systemSettings
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
    
    if (!callSettings) {
      errorResponse(res, "Call Settings not found", 404);
      return;
    }
    successResponse(res, 200, "CallSettings fetched", callSettings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createCallSettings = async (req: Request, res: Response): Promise<void> => {
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
    const newCallSettings = await insertCallSettingsInDb(payload, userId);

    // Include populated systemSetting and user info in response
    const populatedCallSettings = await prisma.callSettings.findUnique({
      where: { id: newCallSettings.id },
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
    
    successResponse(res, 201, "CallSettings created", populatedCallSettings);
    
  } catch (error: any) {
    errorResponse(res, error.message || error, 500);
  }
};

export const updateCallSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if CallSettings exists
    const callSettings = await prisma.callSettings.findUnique({
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

    // If CallSettings doesn't exist, return error
    if (!callSettings) {
      errorResponse(res, "CallSettings not found", 404);
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

    // Check if CallSettings belongs to the user's systemSettings
    if (callSettings.systemSettingId !== systemSettings.id) {
      errorResponse(res, "You cannot update or delete another user's CallSettings", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateCallSettingsSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // Update the CallSettings
    const updatedCallSettings = await prisma.callSettings.update({
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

    successResponse(res, 200, "CallSettings updated", updatedCallSettings);
    
  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "CallSettings not found", 404);
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

export const deleteCallSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if CallSettings exists
    const callSettings = await prisma.callSettings.findUnique({
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

    // If CallSettings doesn't exist, return error
    if (!callSettings) {
      errorResponse(res, "CallSettings not found", 404);
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

    // Check if CallSettings belongs to the user's systemSettings
    if (callSettings.systemSettingId !== systemSettings.id) {
      errorResponse(res, "You cannot update or delete another user's CallSettings", 403);
      return;
    }

    // Delete the CallSettings
    await prisma.callSettings.delete({
      where: { id },
    });

    successResponse(res, 200, "CallSettings deleted successfully", null);
    
  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "CallSettings not found", 404);
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

