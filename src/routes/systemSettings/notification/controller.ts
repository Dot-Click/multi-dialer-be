import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertNotificationInDb } from "./service";
import { createNotificationSchema, updateNotificationSchema } from "../../../zod/notification.schema";
import { validateData } from "../../../middlewares/vald.middleware";

// Create Notification Settings (Run once)
export const createNotification = async (req: Request, res: Response) => {
  try {
    const { id: userId } = req.user!;

    // Validate payload
    const result = await validateData(createNotificationSchema, req.body) as any;
    if (!('data' in result)) {
      return errorResponse(res, { errors: result }, 400);
    }

    // Check parent settings
    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    
    if (systemSetting) {
        const existingNotification = await prisma.notificationSetting.findFirst({
            where: { systemSettingId: systemSetting.id }
        });
        if (existingNotification) {
            return errorResponse(res, "Settings already exist. Use PUT to update.", 400);
        }
    }

    // Insert new Settings
    const newNotification = await insertNotificationInDb(result.data, userId);

    // Return populated response
    const populated = await prisma.notificationSetting.findUnique({
      where: { id: newNotification.id },
      include: {
        systemSetting: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });

    successResponse(res, 201, "Notification settings created", populated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Get Notification Settings
export const getNotification = async (req: Request, res: Response) => {
  try {
    const { id: userId } = req.user!;

    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) return errorResponse(res, "SystemSettings not found", 404);

    const notification = await prisma.notificationSetting.findFirst({
      where: { systemSettingId: systemSetting.id },
      include: {
        systemSetting: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });

    if (!notification) return errorResponse(res, "Notification settings not found", 404);

    successResponse(res, 200, "Notification settings fetched", notification);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
// Update Notification Settings (By User ID - No URL ID needed)
export const updateNotification = async (req: Request, res: Response) => {
  try {
    const { id: userId } = req.user!; // Get User ID from Token

    // Validate payload
    const result = await validateData(updateNotificationSchema, req.body) as any;
    if (!('data' in result)) {
      return errorResponse(res, { errors: result }, 400);
    }

    // 1. Find the System Setting for this user
    const systemSetting = await prisma.system_Setting.findFirst({ 
      where: { userId } 
    });
    
    if (!systemSetting) return errorResponse(res, "SystemSettings not found", 404);

    // 2. Update the notification linked to this System Setting
    // We use updateMany or findFirst+update because we aren't passing the ID in URL
    const existing = await prisma.notificationSetting.findFirst({
        where: { systemSettingId: systemSetting.id }
    });

    if (!existing) return errorResponse(res, "Notification settings not created yet. Use POST first.", 404);

    const updated = await prisma.notificationSetting.update({
      where: { id: existing.id }, // We found the ID internally
      data: result.data,
    });

    successResponse(res, 200, "Changes saved", updated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Delete Notification Settings
export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) return errorResponse(res, "SystemSettings not found", 404);

    const notification = await prisma.notificationSetting.findUnique({ where: { id } });
    if (!notification) return errorResponse(res, "Settings not found", 404);

    // Ownership check
    if (notification.systemSettingId !== systemSetting.id) {
      return errorResponse(res, "You cannot delete another user's settings", 403);
    }

    await prisma.notificationSetting.delete({ where: { id } });
    successResponse(res, 200, "Settings deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};