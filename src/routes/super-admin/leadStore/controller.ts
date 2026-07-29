import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { linkMyPlusLeadsAccount, registerMyPlusLeadsAccount, updateMyPlusLeadsAccount, discoverAccountPackages } from "../../../services/myPlusLeads.service";
import { listPortalAccounts } from "../../../services/myPlusLeadsPortal.service";

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
          select: { id: true, title: true, status: true, userId: true, assignedPackage: true },
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
 * Live list of every sub-account on Client's MyPlusLeads enterprise portal —
 * lets Client pick an account by name/email instead of typing it from memory.
 * MyPlusLeads never exposes sub-account passwords via any API, so the
 * password still has to be entered manually when registering.
 */
export const getPortalAccounts = async (req: Request, res: Response): Promise<void> => {
  try {
    const accounts = await listPortalAccounts();
    successResponse(res, 200, "Portal accounts fetched", accounts);
  } catch (error: any) {
    errorResponse(res, error.message || "Failed to fetch MyPlusLeads portal accounts", error.statusCode || 500);
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
 * Fixes a mis-entered credential on an already-registered account (e.g. the
 * wrong password was typed in). Re-validates against MyPlusLeads first.
 */
export const updateAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { configId } = req.params;
    const { subAccountEmail, subAccountPassword, subAccountId, label } = req.body;

    const account = await updateMyPlusLeadsAccount(configId, { subAccountEmail, subAccountPassword, subAccountId, label });

    successResponse(res, 200, "MyPlusLeads account updated", { ...account, subAccountPassword: "[encrypted]" });
  } catch (error: any) {
    errorResponse(res, error.message || "Failed to update MyPlusLeads account", error.statusCode || 500);
  }
};

/**
 * Live-fetches the data packages (e.g. "Expired", "FSBO") currently on a
 * MyPlusLeads account, with lead counts, so Client can pick the one to assign.
 */
export const getAccountPackages = async (req: Request, res: Response): Promise<void> => {
  try {
    const { configId } = req.params;
    const packages = await discoverAccountPackages(configId);
    successResponse(res, 200, "Packages fetched", packages);
  } catch (error: any) {
    errorResponse(res, error.message || "Failed to fetch account packages", error.statusCode || 500);
  }
};

/**
 * Links an already-registered MyPlusLeads account — and one specific data
 * package on it — to a customer's Lead Store purchase, then syncs it.
 */
export const linkLeadStoreAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadStoreId } = req.params;
    const { myPlusLeadsConfigId, assignedPackage } = req.body;
    const adminUserId = (req as any).user.id;

    if (!myPlusLeadsConfigId || !assignedPackage) {
      errorResponse(res, "myPlusLeadsConfigId and assignedPackage are required", 400);
      return;
    }

    const result = await linkMyPlusLeadsAccount({ leadStoreId, adminUserId, myPlusLeadsConfigId, assignedPackage });

    successResponse(res, 200, "MyPlusLeads account linked and synced", result);
  } catch (error: any) {
    errorResponse(res, error.message || "Failed to link MyPlusLeads account", error.statusCode || 500);
  }
};

/**
 * Grants a customer one or more Lead Store products directly — no Stripe
 * checkout, no charge (a $0 invoice marked PAID for ledger consistency).
 * Creates each as PENDING_SETUP, same as a real purchase, so the existing
 * link-account/assign-package flow is what actually activates it — a
 * granted product only counts as "subscribed" once Client assigns it a
 * MyPlusLeads package, exactly like a paid purchase.
 */
export const grantLeadStoreServices = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, serviceIds } = req.body;

    if (!userId || !Array.isArray(serviceIds) || serviceIds.length === 0) {
      errorResponse(res, "userId and a non-empty serviceIds array are required", 400);
      return;
    }

    const services = await prisma.leadStoreService.findMany({ where: { id: { in: serviceIds } } });
    if (services.length === 0) {
      errorResponse(res, "No matching Lead Store services found", 404);
      return;
    }

    // Skip services this customer already has an active/pending purchase for.
    const existing = await prisma.leadStore.findMany({
      where: { userId, serviceId: { in: serviceIds }, status: { in: ["PENDING_SETUP", "ACTIVE"] } },
      select: { serviceId: true },
    });
    const alreadyHas = new Set(existing.map((e) => e.serviceId));
    const toGrant = services.filter((s) => !alreadyHas.has(s.id));

    const created = await Promise.all(
      toGrant.map(async (service) => {
        const billing = await prisma.billing.create({
          data: {
            userId,
            invoiceNumber: `GRANT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            planName: service.name,
            amount: 0,
            currency: "usd",
            date: new Date(),
            status: "PAID",
            billingCycle: "MONTHLY",
          },
        });

        return prisma.leadStore.create({
          data: {
            title: service.name,
            description: service.description || "",
            price: 0,
            userId,
            billingId: billing.id,
            serviceId: service.id,
            status: "PENDING_SETUP",
          },
        });
      }),
    );

    successResponse(res, 200, `Granted ${created.length} of ${serviceIds.length} requested service(s)`, {
      granted: created,
      skipped: services.length - toGrant.length,
    });
  } catch (error: any) {
    errorResponse(res, error.message || "Failed to grant Lead Store services", error.statusCode || 500);
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
      data: { myPlusLeadsConfigId: null, assignedPackage: null, status: "PENDING_SETUP" },
    });

    successResponse(res, 200, "Account unlinked", leadStore);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error");
  }
};
