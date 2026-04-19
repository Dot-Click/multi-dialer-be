import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertMiscFieldInDb, ensureDefaultMiscFields, cleanupDuplicateMiscFields } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateMiscFieldSchema } from "../../../schemas/miscFields.schema";

export const getAllMiscFieldsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;

    let targetUserId = userId;

    if (role === 'AGENT') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { createdById: true },
      });
      if (user?.createdById) {
        targetUserId = user.createdById;
      }
    }

    // Get user's systemSettings
    const systemSettings = await prisma.system_Setting.findFirst({
      where: { userId: targetUserId },
    });

    if (!systemSettings) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }

    // Ensure default MISC fields exist for this user without duplicates
    await cleanupDuplicateMiscFields(systemSettings.id);
    await ensureDefaultMiscFields(systemSettings.id);

    // Get all misc fields from user's systemSettings
    const miscFields = await prisma.miscField.findMany({
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
      orderBy: {
        createdAt: "asc",
      },
    });

    successResponse(res, 200, "Misc fields fetched", miscFields);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllMiscFieldsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all misc fields from all users
    const miscFields = await prisma.miscField.findMany({
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
      orderBy: {
        createdAt: "desc",
      },
    });

    successResponse(res, 200, "All misc fields fetched", miscFields);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getMiscFieldById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    let targetUserId = userId;

    if (role === 'AGENT') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { createdById: true },
      });
      if (user?.createdById) {
        targetUserId = user.createdById;
      }
    }

    // Get user's systemSettings
    const systemSettings = await prisma.system_Setting.findFirst({
      where: { userId: targetUserId },
    });

    if (!systemSettings) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }

    const miscField = await prisma.miscField.findFirst({
      where: {
        id,
        systemSettingId: systemSettings.id, // Ensure misc field belongs to user's systemSettings
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

    if (!miscField) {
      errorResponse(res, "Misc field not found", 404);
      return;
    }
    successResponse(res, 200, "Misc field fetched", miscField);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createMiscField = async (req: Request, res: Response): Promise<void> => {
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
    const newMiscField = await insertMiscFieldInDb(payload, userId);

    // Include populated systemSetting and user info in response
    const populatedMiscField = await prisma.miscField.findUnique({
      where: { id: newMiscField.id },
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

    successResponse(res, 201, "Misc field created", populatedMiscField);

  } catch (error: any) {
    errorResponse(res, error.message || error, 500);
  }
};

export const updateMiscField = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if misc field exists
    const miscField = await prisma.miscField.findUnique({
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

    // If misc field doesn't exist, return error
    if (!miscField) {
      errorResponse(res, "Misc field not found", 404);
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

    // Check if misc field belongs to the user's systemSettings
    if (miscField.systemSettingId !== systemSettings.id) {
      errorResponse(res, "You cannot update or delete another user's misc field", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateMiscFieldSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // Prepare update data - only include fields that are provided
    const updateData: any = {};

    if (data.fieldName !== undefined) {
      updateData.fieldName = data.fieldName;
    }

    if (data.type !== undefined) {
      updateData.type = data.type;
    }

    // Handle type-specific fields - only update if provided
    if (data.options !== undefined) {
      updateData.options = data.options;
    }

    if (data.countFrom !== undefined) {
      updateData.countFrom = data.countFrom;
    }

    if (data.countTo !== undefined) {
      updateData.countTo = data.countTo;
    }

    if (data.allowPastDates !== undefined) {
      updateData.allowPastDates = data.allowPastDates;
    }

    // Update the misc field
    const updatedMiscField = await prisma.miscField.update({
      where: { id },
      data: updateData,
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

    successResponse(res, 200, "Misc field updated", updatedMiscField);

  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "Misc field not found", 404);
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

export const deleteMiscField = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if misc field exists
    const miscField = await prisma.miscField.findUnique({
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

    // If misc field doesn't exist, return error
    if (!miscField) {
      errorResponse(res, "Misc field not found", 404);
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

    // Check if misc field belongs to the user's systemSettings
    if (miscField.systemSettingId !== systemSettings.id) {
      errorResponse(res, "You cannot update or delete another user's misc field", 403);
      return;
    }

    // Delete the misc field
    await prisma.miscField.delete({
      where: { id },
    });

    successResponse(res, 200, "Misc field deleted successfully", null);

  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "Misc field not found", 404);
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

