import { RequestHandler } from "express";
import { successResponse, errorResponse } from "../../../utils/handler";
import { validateData } from "../../../middlewares/vald.middleware";
import { createNotificationSchema, updateNotificationSchema } from "../../../schemas/notification.schema";
import {
  createNotificationInDb,
  getNotificationFromDb,
  getAllNotificationsFromDb,
  getNotificationByIdFromDb,
  updateNotificationInDb,
  deleteNotificationFromDb
} from "./service";

// Helper: Only Admin & Owner allowed
const isAuthorized = (role?: string) => ["ADMIN", "OWNER"].includes(role || "");

// 1. Create Notification Settings (POST /create)
export const createNotification: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied: Admin/Owner only", 403);
      return;
    }

    const result = await validateData(createNotificationSchema, req.body) as any;
    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }

    // Check if already exists
    const existing = await getNotificationFromDb(userId);
    if (existing) {
      errorResponse(res, "Settings already exist. Please use UPDATE endpoint.", 400);
      return;
    }

    const newNotification = await createNotificationInDb(result.data, userId);
    successResponse(res, 201, "Notification settings created", newNotification);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 2. Get ALL Notification Settings (GET /all)
export const getAllNotifications: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const allSettings = await getAllNotificationsFromDb();
    successResponse(res, 200, "All notification settings fetched", allSettings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 3. Get My Notification Settings (GET /)
export const getMyNotification: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const settings = await getNotificationFromDb(userId);
    if (!settings) {
      errorResponse(res, "Settings not found for this user", 404);
      return;
    }

    successResponse(res, 200, "Your notification settings fetched", settings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 4. Get Specific Notification Setting (GET /:id)
export const getNotificationById: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const settings = await getNotificationByIdFromDb(id);
    if (!settings) {
      errorResponse(res, "Settings not found", 404);
      return;
    }

    successResponse(res, 200, "Settings fetched by ID", settings);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 5. Update Notification Settings (PUT /:id)
// Only updates if the ID belongs to the User ID
export const updateNotification: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    const result = await validateData(updateNotificationSchema, req.body) as any;
    if (!("data" in result)) {
      errorResponse(res, { errors: result }, 400);
      return;
    }

    const updated = await updateNotificationInDb(id, result.data, userId);
    successResponse(res, 200, "Settings updated", updated);
  } catch (error: any) {
    if (error.message.includes("Unauthorized")) {
      errorResponse(res, error.message, 403);
    } else {
      errorResponse(res, "Settings not found or update failed", 500);
    }
  }
};

// 6. Delete Notification Settings (DELETE /:id)
// Only deletes if the ID belongs to the User ID
export const deleteNotification: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    if (!isAuthorized(role)) {
      errorResponse(res, "Access Denied", 403);
      return;
    }

    await deleteNotificationFromDb(id, userId);
    successResponse(res, 200, "Settings deleted", null);
  } catch (error: any) {
    if (error.message.includes("Unauthorized")) {
      errorResponse(res, error.message, 403);
    } else {
      errorResponse(res, "Deletion failed", 500);
    }
  }
};