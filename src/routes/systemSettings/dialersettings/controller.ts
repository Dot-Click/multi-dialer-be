import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../../utils/handler";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateDialerSettingSchema } from "../../../zod/dialerSetting.schema"; // Ensure you have this Zod schema
import { 
  createDialerSettingInDb, 
  getDialerSettingFromDb, 
  updateDialerSettingInDb,
  deleteDialerSettingFromDb
} from "./service";

// Helper to check permissions
const isAuthorized = (role?: string) => ["ADMIN", "OWNER"].includes(role || "");

// Create Dialer Settings (Runs only once)
export const createDialerSettings = async (req: Request, res: Response) => {
  try {
    const { id: userId, role } = req.user!;

    // 1. Permission Check
    if (!isAuthorized(role)) return errorResponse(res, "Access Denied: Admin/Owner only", 403);

    // 2. Validate Payload
    const result = await validateData(updateDialerSettingSchema, req.body) as any;
    if (!('data' in result)) return errorResponse(res, { errors: result }, 400);

    // 3. Check if already exists (Enforce 1-time creation)
    const existing = await getDialerSettingFromDb(userId);
    if (existing) return errorResponse(res, "Settings already exist. Use UPDATE instead.", 400);

    // 4. Create
    const newSettings = await createDialerSettingInDb(result.data, userId);
    successResponse(res, 201, "Dialer settings created", newSettings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Get Dialer Settings
export const getDialerSettings = async (req: Request, res: Response) => {
  try {
    const { id: userId, role } = req.user!;
    
    // Permission Check
    if (!isAuthorized(role)) return errorResponse(res, "Access Denied", 403);

    const settings = await getDialerSettingFromDb(userId);
    if (!settings) return errorResponse(res, "Settings not found", 404);

    successResponse(res, 200, "Settings fetched", settings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// Update Dialer Settings
export const updateDialerSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.user!;

    // 1. Permission Check
    if (!isAuthorized(role)) return errorResponse(res, "Access Denied", 403);

    // 2. Validate Payload
    const result = await validateData(updateDialerSettingSchema, req.body) as any;
    if (!('data' in result)) return errorResponse(res, { errors: result }, 400);

    // 3. Update
    const updated = await updateDialerSettingInDb(id, result.data);
    successResponse(res, 200, "Settings updated", updated);
  } catch (error: any) {
    errorResponse(res, "Settings not found or update failed", 500);
  }
};

// Delete Dialer Settings
export const deleteDialerSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.user!;

    // Permission Check
    if (!isAuthorized(role)) return errorResponse(res, "Access Denied", 403);

    await deleteDialerSettingFromDb(id);
    successResponse(res, 200, "Settings deleted", null);
  } catch (error: any) {
    errorResponse(res, "Deletion failed", 500);
  }
};