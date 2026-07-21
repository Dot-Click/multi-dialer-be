import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import { syncLeadsForUser } from "../../services/myPlusLeads.service";

/**
 * Read-only status for the current user's linked MyPlusLeads account(s).
 * Credentials are managed by Client via the Super Admin linking panel —
 * customers can no longer self-provision or edit them here.
 */
export const getMyPlusLeadsConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const configs = await prisma.myPlusLeadsConfig.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    successResponse(
      res,
      200,
      "Config fetched",
      configs.map((config) => ({
        ...config,
        subAccountPassword: config.subAccountPassword ? "[encrypted]" : null,
      })),
    );
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};

export const syncMyPlusLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;

    const result = await syncLeadsForUser(userId);

    const configs = await prisma.myPlusLeadsConfig.findMany({
      where: { userId },
      select: { lastSyncAt: true, errorMessage: true },
      orderBy: { lastSyncAt: "desc" },
      take: 1,
    });

    successResponse(res, 200, "MyPlusLeads sync complete", {
      ...result,
      lastSyncAt: configs[0]?.lastSyncAt ?? null,
      errorMessage: configs[0]?.errorMessage ?? null,
    });
  } catch (error: any) {
    const message = error.message || "MyPlusLeads sync failed";
    console.error("[MyPlusLeads] Manual sync failed:", message);
    errorResponse(res, message, error.statusCode || 500);
  }
};
