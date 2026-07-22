import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { linkMyPlusLeadsAccount, registerMyPlusLeadsAccount } from "../../../services/myPlusLeads.service";

/**
 * All Lead Store purchases, newest first, joined with the customer and
 * product info Client needs to triage — which ones are PENDING_SETUP,
 * which are ACTIVE, and which linked account (if any) they're using.
 */
export const listLeadStoreRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.query;
    const leadStores = await prisma.leadStore.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        service: { select: { id: true, name: true } },
        myPlusLeadsConfig: { select: { id: true, label: true, subAccountEmail: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    successResponse(res, 200, "Lead Store requests fetched", leadStores);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};

/**
 * All MyPlusLeads accounts Client has entered, with which purchases (if any)
 * each is currently linked to — the picker source for the link modal.
 */
export const listMyPlusLeadsAccounts = async (req: Request, res: Response): Promise<void> => {
  try {
    const accounts = await prisma.myPlusLeadsConfig.findMany({
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        leadStores: {
          select: { id: true, title: true, status: true, userId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    successResponse(
      res,
      200,
      "MyPlusLeads accounts fetched",
      accounts.map((a) => ({ ...a, subAccountPassword: a.subAccountPassword ? "[encrypted]" : null })),
    );
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};

/**
 * Registers a MyPlusLeads account Client already created on MyPlusLeads' own
 * platform for a given customer. Standalone from any purchase — appears in
 * the Accounts tab afterward, ready to be linked to one or more purchases.
 */
export const registerAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, subAccountEmail, subAccountPassword, subAccountId, label } = req.body;
    const adminUserId = (req as any).user.id;

    if (!userId || !subAccountEmail || !subAccountPassword) {
      errorResponse(res, "userId, subAccountEmail, and subAccountPassword are required", 400);
      return;
    }

    const account = await registerMyPlusLeadsAccount({
      userId,
      adminUserId,
      subAccountEmail,
      subAccountPassword,
      subAccountId,
      label,
    });

    successResponse(res, 200, "MyPlusLeads account registered", { ...account, subAccountPassword: "[encrypted]" });
  } catch (error: any) {
    errorResponse(res, error.message || "Failed to register MyPlusLeads account", error.statusCode || 500);
  }
};

/**
 * Links an already-registered MyPlusLeads account to a customer's Lead Store
 * purchase, flips it to ACTIVE, and triggers an immediate sync.
 */
export const linkLeadStoreAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadStoreId } = req.params;
    const { myPlusLeadsConfigId } = req.body;
    const adminUserId = (req as any).user.id;

    if (!myPlusLeadsConfigId) {
      errorResponse(res, "myPlusLeadsConfigId is required", 400);
      return;
    }

    const result = await linkMyPlusLeadsAccount({ leadStoreId, adminUserId, myPlusLeadsConfigId });

    successResponse(res, 200, "MyPlusLeads account linked and synced", result);
  } catch (error: any) {
    errorResponse(res, error.message || "Failed to link MyPlusLeads account", error.statusCode || 500);
  }
};

/**
 * Clears the linked account from a purchase (e.g. to reassign a different
 * one), putting it back into PENDING_SETUP.
 */
export const unlinkLeadStoreAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadStoreId } = req.params;
    const leadStore = await prisma.leadStore.update({
      where: { id: leadStoreId },
      data: { myPlusLeadsConfigId: null, status: "PENDING_SETUP" },
    });

    successResponse(res, 200, "Account unlinked", leadStore);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};
