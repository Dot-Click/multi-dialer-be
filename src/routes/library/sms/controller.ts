import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertSmsTemplateInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateSmsSchema } from "../../../zod/sms.schema";

export const getAllSmsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
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

    // Get all SMS templates from user's library
    const smsTemplates = await prisma.sMSTemplate.findMany({
      where: {
        libraryId: library.id,
      },
      select: {
        id: true,
        templateName: true,
        content: true,
        createdAt: true,
        updatedAt: true,
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
    successResponse(res, 200, "SMS templates fetched", smsTemplates);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getAllSmsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all SMS templates from all users
    const smsTemplates = await prisma.sMSTemplate.findMany({
      select: {
        id: true,
        templateName: true,
        content: true,
        createdAt: true,
        updatedAt: true,
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
    successResponse(res, 200, "All SMS templates fetched", smsTemplates);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getSmsById = async (req: Request, res: Response): Promise<void> => {
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

    const smsTemplate = await prisma.sMSTemplate.findFirst({
      where: { 
        id,
        libraryId: library.id, // Ensure SMS template belongs to user's library
      },
      select: {
        id: true,
        templateName: true,
        content: true,
        createdAt: true,
        updatedAt: true,
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
    
    if (!smsTemplate) {
      errorResponse(res, "SMS template not found", 404);
      return;
    }
    successResponse(res, 200, "SMS template fetched", smsTemplate);
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const createSms = async (req: Request, res: Response): Promise<void> => {
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
    const newSmsTemplate = await insertSmsTemplateInDb(payload, userId);

    // Include populated library and user info in response
    const populatedSmsTemplate = await prisma.sMSTemplate.findUnique({
      where: { id: newSmsTemplate.id },
      select: {
        id: true,
        templateName: true,
        content: true,
        createdAt: true,
        updatedAt: true,
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
    
    successResponse(res, 201, "SMS template created", populatedSmsTemplate);
    
  } catch (error: any) {
    // Handle unique constraint error with user-friendly message
    if (error.message === "Template name already exists") {
      errorResponse(res, error.message, 409);
      return;
    }
    errorResponse(res, error.message || error, 500);
  }
};

export const updateSms = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if SMS template exists
    const smsTemplate = await prisma.sMSTemplate.findUnique({
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

    // If SMS template doesn't exist, return error
    if (!smsTemplate) {
      errorResponse(res, "SMS template not found", 404);
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

    // Check if SMS template belongs to the user's library
    if (smsTemplate.libraryId !== library.id) {
      errorResponse(res, "you can only update your SMS template not other SMS template", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateSmsSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // Update the SMS template
    const updatedSmsTemplate = await prisma.sMSTemplate.update({
      where: { id },
      data: {
        ...data,
      },
      select: {
        id: true,
        templateName: true,
        content: true,
        createdAt: true,
        updatedAt: true,
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

    successResponse(res, 200, "SMS template updated", updatedSmsTemplate);
    
  } catch (error: any) {
    // Handle unique constraint error with user-friendly message
    if (error.code === 'P2002' && error.meta?.target?.includes('templateName')) {
      errorResponse(res, "Template name already exists", 409);
      return;
    }
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "SMS template not found", 404);
      return;
    }
    errorResponse(res, error.message, 500);
  }
};

export const deleteSms = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if SMS template exists
    const smsTemplate = await prisma.sMSTemplate.findUnique({
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

    // If SMS template doesn't exist, return error
    if (!smsTemplate) {
      errorResponse(res, "SMS template not found", 404);
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

    // Check if SMS template belongs to the user's library
    if (smsTemplate.libraryId !== library.id) {
      errorResponse(res, "you can only delete your SMS template not other SMS template", 403);
      return;
    }

    // Delete the SMS template
    await prisma.sMSTemplate.delete({
      where: { id },
    });

    successResponse(res, 200, "SMS template deleted successfully", null);
    
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

