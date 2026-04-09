import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { getEmailHistoryForContactFromDb, getAllEmailHistoryFromDb } from "./service";

export const getEmailHistoryForContact = async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;
    if (!contactId) {
      errorResponse(res, "Contact ID is required", 400);
      return;
    }
    const history = await getEmailHistoryForContactFromDb(contactId);
    successResponse(res, 200, "Email history fetched successfully", history);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", 500);
  }
};

export const getAllEmailHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const role = (req as any).user.role;
    const history = await getAllEmailHistoryFromDb(userId, role);
    successResponse(res, 200, "All email history fetched successfully", history);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", 500);
  }
};
