import { RequestHandler } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import prisma from "../../lib/prisma";

export const getMyNotifications: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    successResponse(res, 200, "Notifications fetched", notifications);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const markAsRead: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true }
    });

    successResponse(res, 200, "Notification marked as read", null);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const markAllAsRead: RequestHandler = async (req, res) => {
  try {
    const userId = req.user!.id;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });

    successResponse(res, 200, "All notifications marked as read", null);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// HELPER: Create a notification (Internal use)
import { sendNotificationToUser } from "../push/service";

export const createInternalNotification = async (userId: string, title: string, description: string, type: string = 'info') => {
  const notification = await prisma.notification.create({
    data: {
      userId,
      title,
      description,
      type
    }
  });

  // Also send Push Notification
  try {
    await sendNotificationToUser(userId, {
      title,
      body: description,
      url: type === 'meeting' || type === 'event' ? '/calendar' : undefined
    });
  } catch (error) {
    console.error("Push notification failed:", error);
  }

  return notification;
};
