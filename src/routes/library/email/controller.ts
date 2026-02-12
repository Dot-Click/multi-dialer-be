import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertEmailTemplateInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateEmailSchema } from "../../../schemas/email.schema";

export const getAllEmailTemplatesOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
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

    // Get all email templates from user's library
    const emailTemplates = await prisma.emailTemplate.findMany({
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
    successResponse(res, 200, "Email templates fetched", emailTemplates);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllEmailTemplatesOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all email templates from all users
    const emailTemplates = await prisma.emailTemplate.findMany({
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
    successResponse(res, 200, "All email templates fetched", emailTemplates);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getEmailTemplateById = async (req: Request, res: Response): Promise<void> => {
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

    const emailTemplate = await prisma.emailTemplate.findFirst({
      where: { 
        id,
        libraryId: library.id, // Ensure email template belongs to user's library
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
    
    if (!emailTemplate) {
      errorResponse(res, "Email template not found", 404);
      return;
    }
    successResponse(res, 200, "Email template fetched", emailTemplate);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createEmailTemplate = async (req: Request, res: Response): Promise<void> => {
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
    const newEmailTemplate = await insertEmailTemplateInDb(payload, userId);

    // Include populated library and user info in response
    const populatedEmailTemplate = await prisma.emailTemplate.findUnique({
      where: { id: newEmailTemplate.id },
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
    
    successResponse(res, 201, "Email template created", populatedEmailTemplate);
    
  } catch (error: any) {
    // Handle unique constraint error with user-friendly message
    if (error.message === "Email template name already exists for this library") {
      errorResponse(res, error.message, 409);
      return;
    }
    errorResponse(res, error.message || error, 500);
  }
};

export const updateEmailTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if email template exists
    const emailTemplate = await prisma.emailTemplate.findUnique({
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

    // If email template doesn't exist, return error
    if (!emailTemplate) {
      errorResponse(res, "Email template not found", 404);
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

    // Check if email template belongs to the user's library
    if (emailTemplate.libraryId !== library.id) {
      errorResponse(res, "You cannot update another user's email template", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateEmailSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // Update the email template
    const updatedEmailTemplate = await prisma.emailTemplate.update({
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

    successResponse(res, 200, "Email template updated", updatedEmailTemplate);
    
  } catch (error: any) {
    // Handle unique constraint error
    if (error.code === 'P2002' && error.meta?.target?.includes('templateName')) {
      errorResponse(res, "Email template name already exists for this library", 409);
      return;
    }
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "Email template not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deleteEmailTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if email template exists
    const emailTemplate = await prisma.emailTemplate.findUnique({
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

    // If email template doesn't exist, return error
    if (!emailTemplate) {
      errorResponse(res, "Email template not found", 404);
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

    // Check if email template belongs to the user's library
    if (emailTemplate.libraryId !== library.id) {
      errorResponse(res, "You cannot delete another user's email template", 403);
      return;
    }

    // Delete the email template
    await prisma.emailTemplate.delete({
      where: { id },
    });

    successResponse(res, 200, "Email template deleted successfully", null);
    
  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "Email template not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
