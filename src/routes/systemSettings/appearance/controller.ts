import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertAppearanceInDb } from "./service";
import { createAppearanceSchema, updateAppearanceSchema } from "../../../zod/appearance.schema";
import { validateData } from "../../../middlewares/vald.middleware";

// Create or initialize Appearance
export const createAppearance = async (req: Request, res: Response) => {
    try {
      const { id: userId } = req.user!;
  
      // Validate payload with Zod
      const result = await validateData(createAppearanceSchema, req.body) as any;
      if (!('data' in result)) {
        return errorResponse(res, { errors: result }, 400);
      }
  
      // Check if user already has Appearance
      const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
      if (!systemSetting) return errorResponse(res, "SystemSettings not found for user", 404);
  
      const existingAppearance = await prisma.appearance.findFirst({
        where: { systemSettingId: systemSetting.id }
      });
  
      if (existingAppearance) {
        return errorResponse(res, "Appearance already created for this user. You can only update.", 400);
      }
  
      // Insert new Appearance
      const newAppearance = await insertAppearanceInDb(result.data, userId);
  
      const populatedAppearance = await prisma.appearance.findUnique({
        where: { id: newAppearance.id },
        include: {
          systemSetting: {
            include: { user: { select: { id: true, fullName: true, email: true } } },
          },
        },
      });
  
      successResponse(res, 201, "Appearance created", populatedAppearance);
    } catch (error: any) {
      errorResponse(res, error.message || "Internal server error", 500);
    }
  };
  

// Get Appearance of specific user
export const getAppearanceOfUser = async (req: Request, res: Response) => {
  try {
    const { id: userId } = req.user!;

    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) return errorResponse(res, "SystemSettings not found for user", 404);

    const appearance = await prisma.appearance.findFirst({
      where: { systemSettingId: systemSetting.id },
      include: {
        systemSetting: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });

    if (!appearance) return errorResponse(res, "Appearance not found", 404);

    successResponse(res, 200, "Appearance fetched", appearance);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Update Appearance
export const updateAppearance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Validate payload with Zod (partial schema)
    const result = await validateData(updateAppearanceSchema, req.body) as any;
    if (!('data' in result)) {
      return errorResponse(res, { errors: result }, 400);
    }

    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) return errorResponse(res, "SystemSettings not found for user", 404);

    const appearance = await prisma.appearance.findUnique({ where: { id } });
    if (!appearance) return errorResponse(res, "Appearance not found", 404);

    if (appearance.systemSettingId !== systemSetting.id) {
      return errorResponse(res, "You cannot update another user's Appearance", 403);
    }

    const updatedAppearance = await prisma.appearance.update({
      where: { id },
      data: result.data,
      include: {
        systemSetting: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });

    successResponse(res, 200, "Appearance updated", updatedAppearance);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Delete Appearance
export const deleteAppearance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) return errorResponse(res, "SystemSettings not found for user", 404);

    const appearance = await prisma.appearance.findUnique({ where: { id } });
    if (!appearance) return errorResponse(res, "Appearance not found", 404);

    if (appearance.systemSettingId !== systemSetting.id) {
      return errorResponse(res, "You cannot delete another user's Appearance", 403);
    }

    await prisma.appearance.delete({ where: { id } });
    successResponse(res, 200, "Appearance deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
