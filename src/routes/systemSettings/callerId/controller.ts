import { Request, RequestHandler, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertCallerIdInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateCallerIdSchema } from "../../../schemas/callerId.schema";
import {
  resolveAdminId,
  getCooldownStatus,
  recordCallAndRotateIfNeeded,
} from "./service";

export const getAllCallerIdsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    // Get or create user's systemSettings
    let systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({
        data: { userId }
      });
    }

    // Get all CallerIds
    const callerIds = await prisma.callerId.findMany({
      where: req.user?.role === "AGENT"
        ? { agents: { some: { id: userId } } }
        : { systemSettingId: systemSettings.id },
      select: {
        id: true,
        label: true,
        countryCode: true,
        numberOfLines: true,
        systemSettingId: true,
        twillioNumber: true,
        createdAt: true,
        updatedAt: true,
        dialerType: true,
        aiPacing: true,
        counter: true,
        callCount: true,
        frozenAt: true,
        unfreezeAt: true,
        reputationStatus: true,
        reputationScore: true,
        lastReputationCheck: true,
        agents: {
          select: {
            id: true,
            fullName: true,
            email: true,
          }
        },
        systemSetting: {
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
    successResponse(res, 200, "CallerIds fetched", callerIds);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getAllCallerIdsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all CallerIds from all users
    const callerIds = await prisma.callerId.findMany({
      select: {
        id: true,
        label: true,
        countryCode: true,
        numberOfLines: true,
        systemSettingId: true,
        twillioNumber: true,
        createdAt: true,
        updatedAt: true,
        dialerType: true,
        aiPacing: true,
        counter: true,
        callCount: true,
        frozenAt: true,
        unfreezeAt: true,
        reputationStatus: true,
        reputationScore: true,
        lastReputationCheck: true,
        agents: {
          select: {
            id: true,
            fullName: true,
            email: true,
          }
        },
        systemSetting: {
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
    successResponse(res, 200, "All CallerIds fetched", callerIds);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const getCallerIdById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Get or create user's systemSettings
    let systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({
        data: { userId }
      });
    }

    const callerId = await prisma.callerId.findFirst({
      where: {
        id,
        systemSettingId: systemSettings.id, // Ensure CallerId belongs to user's systemSettings
      },
      select: {
        id: true,
        label: true,
        countryCode: true,
        numberOfLines: true,
        systemSettingId: true,
        twillioNumber: true,
        createdAt: true,
        updatedAt: true,
        dialerType: true,
        aiPacing: true,
        counter: true,
        callCount: true,
        frozenAt: true,
        unfreezeAt: true,
        reputationStatus: true,
        reputationScore: true,
        lastReputationCheck: true,
        agents: {
          select: {
            id: true,
            fullName: true,
            email: true,
          }
        },
        systemSetting: {
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

    if (!callerId) {
      errorResponse(res, "CallerId not found", 404);
      return;
    }
    successResponse(res, 200, "CallerId fetched", callerId);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const createCallerId = async (req: Request, res: Response): Promise<void> => {
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

    // Ensure req.body exists and is an object
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
      errorResponse(res, {
        errors: [
          {
            expected: "object",
            code: "invalid_type",
            path: ["body"],
            message: "Request body is required and must be a valid JSON object"
          }
        ]
      }, 400);
      return;
    }

    const payload = { ...req.body };
    const newCallerId = await insertCallerIdInDb(payload, userId);

    // Include populated systemSetting and user info in response
    const populatedCallerId = await prisma.callerId.findUnique({
      where: { id: newCallerId.id },
      select: {
        id: true,
        label: true,
        countryCode: true,
        numberOfLines: true,
        systemSettingId: true,
        twillioNumber: true,
        createdAt: true,
        updatedAt: true,
        dialerType: true,
        aiPacing: true,
        counter: true,
        callCount: true,
        frozenAt: true,
        unfreezeAt: true,
        reputationStatus: true,
        reputationScore: true,
        lastReputationCheck: true,
        systemSetting: {
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

    successResponse(res, 201, "CallerId created", populatedCallerId);

  } catch (error: any) {
    errorResponse(res, error.message || error, 500);
  }
};

export const updateCallerId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if CallerId exists
    const callerId = await prisma.callerId.findUnique({
      where: { id },
      include: {
        systemSetting: {
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

    // If CallerId doesn't exist, return error
    if (!callerId) {
      errorResponse(res, "CallerId not found", 404);
      return;
    }

    // Get or create user's systemSettings
    let systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({
        data: { userId }
      });
    }

    // Check if CallerId belongs to the user's systemSettings
    if (callerId.systemSettingId !== systemSettings.id) {
      errorResponse(res, "You cannot update or delete another user's CallerId", 403);
      return;
    }

    // Validate payload with Zod
    const payload = { ...req.body };
    const result = await validateData(updateCallerIdSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;
    const { agentIds, ...updateData } = data;

    // Update the CallerId
    const updatedCallerId = await prisma.callerId.update({
      where: { id },
      data: {
        ...updateData,
        agents: agentIds ? {
          set: agentIds.map((agentId: string) => ({ id: agentId }))
        } : undefined
      },
      select: {
        id: true,
        label: true,
        countryCode: true,
        numberOfLines: true,
        systemSettingId: true,
        twillioNumber: true,
        createdAt: true,
        updatedAt: true,
        dialerType: true,
        aiPacing: true,
        counter: true,
        callCount: true,
        frozenAt: true,
        unfreezeAt: true,
        reputationStatus: true,
        reputationScore: true,
        lastReputationCheck: true,
        agents: {
          select: {
            id: true,
            fullName: true,
            email: true,
          }
        },
        systemSetting: {
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

    successResponse(res, 200, "CallerId updated", updatedCallerId);

  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "CallerId not found", 404);
      return;
    }
    // Check if error is related to ownership (shouldn't happen here, but just in case)
    if (error.message && error.message.includes("cannot update")) {
      errorResponse(res, error.message, 403);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

export const deleteCallerId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Check if CallerId exists
    const callerId = await prisma.callerId.findUnique({
      where: { id },
      include: {
        systemSetting: {
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

    // If CallerId doesn't exist, return error
    if (!callerId) {
      errorResponse(res, "CallerId not found", 404);
      return;
    }

    // Get or create user's systemSettings
    let systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({
        data: { userId }
      });
    }

    // Check if CallerId belongs to the user's systemSettings
    if (callerId.systemSettingId !== systemSettings.id) {
      errorResponse(res, "You cannot update or delete another user's CallerId", 403);
      return;
    }

    // Delete the CallerId
    await prisma.callerId.delete({
      where: { id },
    });

    successResponse(res, 200, "CallerId deleted successfully", null);

  } catch (error: any) {
    // Check if it's a Prisma error related to record not found
    if (error.code === 'P2025') {
      errorResponse(res, "CallerId not found", 404);
      return;
    }
    // Check if error is related to ownership (shouldn't happen here, but just in case)
    if (error.message && error.message.includes("cannot delete")) {
      errorResponse(res, error.message, 403);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};



// GET /calling/caller-id/status?numbers=+155...,+166...
export const getCallerIdStatus: RequestHandler = async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) { errorResponse(res, "Unauthorized", 401); return; }

    const numbersParam = req.query.numbers as string;
    if (!numbersParam) { errorResponse(res, "numbers query param is required", 400); return; }

    const callerNumbers = numbersParam.split(",").map((n) => n.trim()).filter(Boolean);
    if (callerNumbers.length === 0) { errorResponse(res, "At least one number is required", 400); return; }

    const adminId = await resolveAdminId(userId);
    const status = await getCooldownStatus(adminId, callerNumbers);

    successResponse(res, 200, "Caller ID status fetched", status);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// POST /calling/caller-id/use
// Body: { callerNumber: string, maxCallsPerCid: number }
export const useCallerId: RequestHandler = async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) { errorResponse(res, "Unauthorized", 401); return; }

    const { callerNumber, maxCallsPerCid } = req.body;
    if (!callerNumber) { errorResponse(res, "callerNumber is required", 400); return; }
    if (!maxCallsPerCid || maxCallsPerCid < 1) { errorResponse(res, "maxCallsPerCid must be a positive number", 400); return; }

    const adminId = await resolveAdminId(userId);
    const result = await recordCallAndRotateIfNeeded(adminId, callerNumber, maxCallsPerCid);

    successResponse(res, 200, "Caller ID usage recorded", result);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

