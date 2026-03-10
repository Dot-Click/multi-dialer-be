import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { errorResponse, successResponse } from "../../../utils/handler";
import {
  createLeadSheetInDb,
  deleteLeadSheetForUser,
  getLeadSheetByIdForUser,
  getLeadSheetsForUser,
  updateLeadSheetForUser,
} from "./service";

export const createLeadSheet = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) {
      errorResponse(
        res,
        {
          errors: [
            {
              expected: "object",
              code: "invalid_type",
              path: ["body"],
              message: "Request body is required and must be a valid JSON object",
            },
          ],
        },
        400
      );
      return;
    }

    const created = await createLeadSheetInDb(req.body, userId);
    successResponse(res, 201, "Lead Sheet created", created);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getLeadSheets = async (req: Request, res: Response): Promise<void> => {
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

    const leadSheets = await getLeadSheetsForUser(targetUserId);
    successResponse(res, 200, "Lead Sheets fetched", leadSheets);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const getLeadSheetById = async (req: Request, res: Response): Promise<void> => {
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

    const leadSheet = await getLeadSheetByIdForUser(id, targetUserId);
    if (!leadSheet) {
      errorResponse(res, "Lead Sheet not found", 404);
      return;
    }

    successResponse(res, 200, "Lead Sheet fetched", leadSheet);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const updateLeadSheet = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) {
      errorResponse(
        res,
        {
          errors: [
            {
              expected: "object",
              code: "invalid_type",
              path: ["body"],
              message: "Request body is required and must be a valid JSON object",
            },
          ],
        },
        400
      );
      return;
    }

    const updated = await updateLeadSheetForUser(id, req.body, userId);
    successResponse(res, 200, "Lead Sheet updated", updated);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const deleteLeadSheet = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    await deleteLeadSheetForUser(id, userId);
    successResponse(res, 200, "Lead Sheet deleted successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};


