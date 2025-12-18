import { RequestHandler } from "express";
import { successResponse, errorResponse } from "../../../utils/handler";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateDialerSettingSchema } from "../../../zod/dialerSetting.schema";
import {
  createDialerSettingInDb,
  getDialerSettingFromDb,
  updateDialerSettingInDb,
  deleteDialerSettingFromDb,
  getAllDialerSettingsFromDb,
  getDialerSettingByIdFromDb
} from "./service";

// Helper to check permissions
const isAuthorized = (role?: string) => ["ADMIN", "OWNER"].includes(role || "");

// 1. Create Dialer Settings (POST /create)
export const createDialerSettings: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied: Admin/Owner only", 403);
      return;
    }

    const result = await validateData(updateDialerSettingSchema, req.body) as any;
    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }

    const existing = await getDialerSettingFromDb(userId);
    if (existing) {
      errorResponse(res, "Settings already exist. Please use UPDATE endpoint.", 400);
      return;
    }

    const newSettings = await createDialerSettingInDb(result.data, userId);
    successResponse(res, 201, "Dialer settings created", newSettings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 2. Get ALL Dialer Settings (GET /all)
export const getAllDialerSettings: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const allSettings = await getAllDialerSettingsFromDb();
    successResponse(res, 200, "All dialer settings fetched", allSettings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 3. Get My Dialer Settings (GET /)
export const getMyDialerSettings: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const settings = await getDialerSettingFromDb(userId);
    if (!settings) {
      errorResponse(res, "Settings not found for this user", 404);
      return;
    }

    successResponse(res, 200, "Your settings fetched", settings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 4. Get Specific Dialer Setting (GET /:id)
export const getDialerSettingById: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const settings = await getDialerSettingByIdFromDb(id);
    if (!settings) {
      errorResponse(res, "Settings not found", 404);
      return;
    }

    successResponse(res, 200, "Settings fetched by ID", settings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 5. Update Dialer Settings (PUT /:id)
// Logic: Checks permissions, then tries to update. 
// Service will fail if the ID does not belong to the User ID.
export const updateDialerSettings: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const result = await validateData(updateDialerSettingSchema, req.body) as any;
    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }

    // Pass userId to service to ensure ownership
    const updated = await updateDialerSettingInDb(id, result.data, userId);
    successResponse(res, 200, "Settings updated", updated);
  } catch (error: any) {
    // If service throws "Unauthorized...", we send 403, otherwise 500
    if (error.message.includes("Unauthorized")) {
      errorResponse(res, error.message, 403);
    } else {
      errorResponse(res, "Settings not found or update failed", 500);
    }
  }
};

// 6. Delete Dialer Settings (DELETE /:id)
// Logic: Service will fail if the ID does not belong to the User ID.
export const deleteDialerSettings: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    // Pass userId to service to ensure ownership
    await deleteDialerSettingFromDb(id, userId);
    successResponse(res, 200, "Settings deleted", null);
  } catch (error: any) {
    if (error.message.includes("Unauthorized")) {
      errorResponse(res, error.message, 403);
    } else {
      errorResponse(res, "Deletion failed or settings not found", 500);
    }
  }
};