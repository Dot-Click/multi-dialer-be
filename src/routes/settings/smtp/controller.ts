import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../../utils/handler";
import { validateData } from "../../../middlewares/vald.middleware";
import { upsertSmtpConfigSchema } from "../../../schemas/smtpConfig.schema";
import {
  resolveCompanyIdForUser,
  resolveOrCreateCompanyIdForUser,
  getSmtpConfigFromDb,
  upsertSmtpConfigInDb,
  deleteSmtpConfigFromDb,
  testSmtpConfigInDb,
} from "./service";

export const getSmtpConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role, createdById } = req.user!;
    const companyId = await resolveCompanyIdForUser(userId, role, createdById);

    // No Company row yet means there can't be a saved SMTP config either —
    // return null instead of erroring so viewing Settings never requires a
    // company profile to exist.
    const config = companyId ? await getSmtpConfigFromDb(companyId) : null;
    successResponse(res, 200, "SMTP configuration fetched successfully", config);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const upsertSmtpConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role, createdById } = req.user!;
    // Saving SMTP settings must work even for accounts that never set up a
    // Company profile — resolve-or-create a minimal Company row transparently
    // instead of requiring one to already exist.
    const companyId = await resolveOrCreateCompanyIdForUser(userId, role, createdById);

    const result = (await validateData(upsertSmtpConfigSchema, req.body)) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const config = await upsertSmtpConfigInDb(companyId, result.data);
    successResponse(res, 200, "SMTP configuration saved successfully", config);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const testSmtpConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role, createdById, email } = req.user!;
    const companyId = await resolveOrCreateCompanyIdForUser(userId, role, createdById);

    const result = await testSmtpConfigInDb(companyId, email);
    if (!result.success) {
      errorResponse(res, result.error || "SMTP test failed", 400);
      return;
    }

    successResponse(res, 200, "Test email sent successfully. SMTP connection verified.", { verified: true });
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};

export const deleteSmtpConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId, role, createdById } = req.user!;
    const companyId = await resolveCompanyIdForUser(userId, role, createdById);

    if (!companyId) {
      errorResponse(res, "SMTP configuration not found", 404);
      return;
    }

    await deleteSmtpConfigFromDb(companyId);
    successResponse(res, 200, "SMTP configuration removed successfully", null);
  } catch (error: any) {
    errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
  }
};
