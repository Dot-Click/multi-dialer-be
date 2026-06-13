import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertCallerIdInDb } from "../../systemSettings/callerId/service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateCallerIdSchema } from "../../../schemas/callerId.schema";
import { getTwilioClient } from "../../../services/twilio-account.service";

const CALLER_ID_SELECT = {
  id: true,
  label: true,
  countryCode: true,
  numberOfLines: true,
  twillioNumber: true,
  twillioSid: true,
  dialerType: true,
  aiPacing: true,
  callCount: true,
  frozenAt: true,
  unfreezeAt: true,
  reputationStatus: true,
  reputationScore: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const listCallerIds = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.query as { userId?: string };
    if (!userId) {
      errorResponse(res, "userId query parameter is required", 400);
      return;
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      errorResponse(res, "User not found", 404);
      return;
    }

    const systemSetting = await prisma.system_Setting.findFirst({ where: { userId } });
    if (!systemSetting) {
      successResponse(res, 200, "Caller IDs fetched", []);
      return;
    }

    const callerIds = await prisma.callerId.findMany({
      where: { systemSettingId: systemSetting.id },
      select: CALLER_ID_SELECT,
      orderBy: { createdAt: "desc" },
    });

    successResponse(res, 200, "Caller IDs fetched", callerIds);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createCallerIdForUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, ...payload } = req.body;
    if (!userId) {
      errorResponse(res, "userId is required", 400);
      return;
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      errorResponse(res, "User not found", 404);
      return;
    }

    const newCallerId = await insertCallerIdInDb(payload, userId);

    const populated = await prisma.callerId.findUnique({
      where: { id: newCallerId.id },
      select: CALLER_ID_SELECT,
    });

    successResponse(res, 201, "Caller ID created", populated);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const updateAnyCallerId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await prisma.callerId.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      errorResponse(res, "Caller ID not found", 404);
      return;
    }

    const result = await validateData(updateCallerIdSchema, req.body) as any;
    if (!("data" in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const { agentIds, ...updateData } = result.data;

    const updated = await prisma.callerId.update({
      where: { id },
      data: {
        ...updateData,
        agents: agentIds ? { set: agentIds.map((aid: string) => ({ id: aid })) } : undefined,
      },
      select: CALLER_ID_SELECT,
    });

    successResponse(res, 200, "Caller ID updated", updated);
  } catch (error: any) {
    if (error.code === "P2025") {
      errorResponse(res, "Caller ID not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deleteAnyCallerId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await prisma.callerId.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      errorResponse(res, "Caller ID not found", 404);
      return;
    }

    await prisma.callerId.delete({ where: { id } });
    successResponse(res, 200, "Caller ID deleted", null);
  } catch (error: any) {
    if (error.code === "P2025") {
      errorResponse(res, "Caller ID not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const listAvailableNumbers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.query as { userId?: string };
    if (!userId) {
      errorResponse(res, "userId query parameter is required", 400);
      return;
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      errorResponse(res, "User not found", 404);
      return;
    }

    const twilioClient = await getTwilioClient(userId);
    const numbers = await twilioClient.incomingPhoneNumbers.list({ limit: 100 });

    const result = numbers.map((n) => ({
      sid: n.sid,
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      voiceEnabled: n.capabilities?.voice ?? false,
      smsEnabled: n.capabilities?.sms ?? false,
    }));

    successResponse(res, 200, "Available numbers fetched", result);
  } catch (error: any) {
    errorResponse(res, error.message || "Failed to fetch Twilio numbers", 500);
  }
};
