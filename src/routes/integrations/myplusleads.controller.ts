import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";

export const getMyPlusLeadsConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const config = await prisma.myPlusLeadsConfig.findUnique({
      where: { userId }
    });

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const webhookUrl = config?.subAccountId
      ? `${baseUrl}/api/webhooks/myplusleads/${userId}?accountId=${config.subAccountId}`
      : null;

    successResponse(res, 200, "Config fetched", config ? {
      ...config,
      subAccountPassword: config.subAccountPassword ? "[encrypted]" : null,
      webhookUrl,
    } : { webhookUrl: null });
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};

export const updateMyPlusLeadsConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { autoSync } = req.body;

    const config = await prisma.myPlusLeadsConfig.upsert({
      where: { userId },
      update: {
        autoSync: autoSync !== undefined ? autoSync : true,
      },
      create: {
        userId,
        autoSync: autoSync !== undefined ? autoSync : true,
      }
    });

    successResponse(res, 200, "Configuration saved successfully", config);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};

export const deleteMyPlusLeadsConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    await prisma.myPlusLeadsConfig.delete({
      where: { userId }
    });
    successResponse(res, 200, "Integration disconnected");
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};
