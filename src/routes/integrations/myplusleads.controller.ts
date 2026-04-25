import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";

export const getMyPlusLeadsConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const config = await prisma.myPlusLeadsConfig.findUnique({
      where: { userId }
    });

    // Provide the unique webhook URL for this user
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const webhookUrl = config ? `${baseUrl}/api/webhooks/myplusleads/${userId}?apiKey=${config.apiKey}` : null;

    successResponse(res, 200, "Config fetched", { ...config, webhookUrl });
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};

export const updateMyPlusLeadsConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { apiKey, selectedTypes, autoSync } = req.body;

    if (!apiKey) {
      errorResponse(res, "API Key is required", 400);
      return;
    }

    const config = await prisma.myPlusLeadsConfig.upsert({
      where: { userId },
      update: {
        apiKey,
        selectedTypes: selectedTypes || ["EXPIRED", "FSBO"],
        autoSync: autoSync !== undefined ? autoSync : true,
        status: "CONNECTED"
      },
      create: {
        userId,
        apiKey,
        selectedTypes: selectedTypes || ["EXPIRED", "FSBO"],
        autoSync: autoSync !== undefined ? autoSync : true,
        status: "CONNECTED"
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
