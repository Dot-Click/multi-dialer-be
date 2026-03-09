import { Request, Response, RequestHandler } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertAppearanceInDb } from "./service";
import {
  createAppearanceSchema,
  updateAppearanceSchema
} from "../../../schemas/appearance.schema";
import { validateData } from "../../../middlewares/vald.middleware";


// Create or initialize Appearance


export const createAppearance: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id: userId } = req.user!;


    //  Validate request body
    const result = (await validateData(createAppearanceSchema, req.body)) as any;
    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }


    // Get system setting for user
    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }


    //  Check if appearance exists
    const existingAppearance = await prisma.appearance.findFirst({
      where: { systemSettingId: systemSetting.id },
    });


    if (existingAppearance) {
      // If exists, update it automatically
      const updatedAppearance = await prisma.appearance.update({
        where: { id: existingAppearance.id },
        data: result.data,
        include: {
          systemSetting: {
            include: { user: { select: { id: true, fullName: true, email: true } } },
          },
        },
      });


      successResponse(res, 200, "Appearance updated successfully", updatedAppearance);
      return;
    }


    // If not exists, create new
    const newAppearance = await insertAppearanceInDb(result.data, userId);


    const populatedAppearance = await prisma.appearance.findUnique({
      where: { id: newAppearance.id },
      include: {
        systemSetting: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });


    successResponse(res, 201, "Appearance created successfully", populatedAppearance);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};


// Get Appearance of user
export const getAppearanceOfUser: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id: userId } = req.user!;


    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }


    const appearance = await prisma.appearance.findFirst({
      where: { systemSettingId: systemSetting.id },
      include: {
        systemSetting: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });


    if (!appearance) {
      errorResponse(res, "Appearance not found", 404);
      return;
    }


    successResponse(res, 200, "Appearance fetched", appearance);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};


// Update Appearance
export const updateAppearance: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;


    const result = await validateData(updateAppearanceSchema, req.body) as any;
    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }


    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }


    const appearance = await prisma.appearance.findUnique({ where: { id } });
    if (!appearance) {
      errorResponse(res, "Appearance not found", 404);
      return;
    }


    if (appearance.systemSettingId !== systemSetting.id) {
      errorResponse(res, "You cannot update another user's Appearance", 403);
      return;
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
export const deleteAppearance: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;


    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) {
      errorResponse(res, "SystemSettings not found for user", 404);
      return;
    }


    const appearance = await prisma.appearance.findUnique({ where: { id } });
    if (!appearance) {
      errorResponse(res, "Appearance not found", 404);
      return;
    }


    if (appearance.systemSettingId !== systemSetting.id) {
      errorResponse(res, "You cannot delete another user's Appearance", 403);
      return;
    }


    await prisma.appearance.delete({ where: { id } });
    successResponse(res, 200, "Appearance deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};