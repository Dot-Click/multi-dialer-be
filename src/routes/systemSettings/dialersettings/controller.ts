import { RequestHandler } from "express";
import { successResponse, errorResponse } from "../../../utils/handler";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateDialerSettingSchema } from "../../../schemas/dialerSetting.schema";
import {
  createDialerSettingInDb,
  getDialerSettingFromDb,
  updateDialerSettingInDb,
  deleteDialerSettingFromDb,
  getAllDialerSettingsFromDb,
  getDialerSettingByIdFromDb
} from "./service";

const isAuthorized = (role?: string) => ["ADMIN", "OWNER", "AGENT"].includes(role || "");

// 1. Upsert Dialer Settings (POST / or PUT /)
// If settings exist for this user → update. If not → create.
export const upsertDialerSettings: RequestHandler = async (req, res): Promise<void> => {
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
      // Settings found → update
      const updated = await updateDialerSettingInDb(existing.id, result.data, userId);
      successResponse(res, 200, "Dialer settings updated", updated);
    } else {
      // No settings yet → create
      const created = await createDialerSettingInDb(result.data, userId);
      successResponse(res, 201, "Dialer settings created", created);
    }
  } catch (error: any) {
    if (error.message?.includes("Unauthorized")) {
      errorResponse(res, error.message, 403);
    } else {
      errorResponse(res, error.message || "Internal server error", 500);
    }
  }
};

// 2. Get My Dialer Settings (GET /)
export const getMyDialerSettings: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const settings = await getDialerSettingFromDb(userId);
    if (!settings) {
      errorResponse(res, "No dialer settings found for this user", 404);
      return;
    }

    successResponse(res, 200, "Dialer settings fetched", settings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 3. Get All Dialer Settings (GET /all) — Admin only
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

// 4. Get Dialer Setting by ID (GET /:id)
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

// 5. Delete Dialer Settings (DELETE /:id)
export const deleteDialerSettings: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    await deleteDialerSettingFromDb(id, userId);
    successResponse(res, 200, "Dialer settings deleted", null);
  } catch (error: any) {
    if (error.message?.includes("Unauthorized")) {
      errorResponse(res, error.message, 403);
    } else {
      errorResponse(res, "Deletion failed or settings not found", 500);
    }
  }
};