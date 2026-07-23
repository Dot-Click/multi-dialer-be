import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import { createUserSchema, updateUserSchema } from "../../schemas/user.schema";
import { getAllUsersFromDb, createUserInDb, updateUserInDb, deleteUserFromDb, deleteAllUsersFromDb, updateUserSubscriptionInDb } from "./service";
import { auth } from "../../lib/auth";
import { generateSecurePassword } from "../../utils/password";
import { uploadToR2 } from "../../utils/r2-uploader";
import prisma from "../../lib/prisma";

/**
 * Confirms `requester` (the authenticated caller) is allowed to modify/delete
 * `targetId`. OWNER can manage anyone but another OWNER; ADMIN can only manage
 * users they personally created (their agents); everyone else is denied.
 * Mirrors the visibility rules already used by getAllUsers, but enforced here
 * since the mutation routes previously had no ownership check at all.
 */
async function assertCanManageUser(
    requester: { id: string; role: string },
    targetId: string
): Promise<{ id: string; role: string; createdById: string | null }> {
    if (targetId === requester.id) {
        throw { message: "You cannot perform this action on your own account", statusCode: 403 };
    }

    const target = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, createdById: true },
    });
    if (!target) {
        throw { message: "User not found", statusCode: 404 };
    }

    if (requester.role === "OWNER") {
        if (target.role === "OWNER") {
            throw { message: "You cannot manage another Owner account", statusCode: 403 };
        }
        return target;
    }

    if (requester.role === "ADMIN") {
        if (target.createdById !== requester.id) {
            throw { message: "You can only manage agents you created", statusCode: 403 };
        }
        return target;
    }

    throw { message: "You don't have permission to manage users", statusCode: 403 };
}


export const createUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const payload = { ...req.body };

        // Auto-generate password if not provided
        if (!payload.password) {
            payload.password = generateSecurePassword();
            console.log(`Generated temporary password for ${payload.email}: ${payload.password}`);
        }

        // If authenticated user is creating this user, set createdById
        if ((req as any).user?.id) {
            payload.createdById = (req as any).user.id;
        }

        const result = (await validateData(createUserSchema, payload)) as any;
        if (!("data" in result)) {
            errorResponse(res, "Validation error", 400);
            return;
        }

        const newUser = await createUserInDb(result.data);

        successResponse(res, 201, "User created successfully", newUser);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
        const currentUser = (req as any).user;
        console.log(`[getAllUsers] Fetching for role: ${currentUser.role}, ID: ${currentUser.id}`);
        let where: any = {};

        if (currentUser.role === "OWNER") {
            // Super Admin can see all users except other Owners (Super Admins)
            where = {
                role: { not: "OWNER" }
            };
        } else if (currentUser.role === "ADMIN") {
            // Show users created by this admin, and include the admin themselves
            where = {
                OR: [
                    { id: currentUser.id },
                    { createdById: currentUser.id }
                ]
            };
        } else if (currentUser.role === "AGENT") {
            // Show users who share the same creator as this agent
            const agentDetails = await prisma?.user.findUnique({
                where: { id: currentUser.id },
                select: { createdById: true }
            });

            if (agentDetails?.createdById) {
                where = {
                    OR: [
                        { id: agentDetails.createdById },
                        { createdById: agentDetails.createdById }
                    ]
                };
            } else {
                // Orphan agent? Just show themselves
                where = { id: currentUser.id };
            }
        }

        const users = await getAllUsersFromDb(where);
        console.log(`[getAllUsers] Found ${users.length} users`);
        successResponse(res, 200, "Users fetched successfully", users);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const requester = (req as any).user;
        if (!id) {
            errorResponse(res, "User id is required", 400);
            return;
        }

        await assertCanManageUser(requester, id);

        const payload = { ...req.body };
        if (requester.role === "ADMIN" && payload.role === "OWNER") {
            errorResponse(res, "Only an Owner can grant Owner access", 403);
            return;
        }

        const result = (await validateData(updateUserSchema, payload)) as any;
        if (!("data" in result)) {
            errorResponse(res, "Validation error", 400);
            return;
        }

        const updatedUser = await updateUserInDb(id, result.data);
        successResponse(res, 200, "User updated successfully", updatedUser);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const setUserPassword = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        if (!id) { errorResponse(res, "User id is required", 400); return; }
        if (!password || password.length < 8) { errorResponse(res, "Password must be at least 8 characters", 400); return; }

        await assertCanManageUser((req as any).user, id);

        const headers = new Headers();
        if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
        if (req.headers["user-agent"]) headers.set("user-agent", req.headers["user-agent"] as string);
        if (req.headers.authorization) headers.set("authorization", req.headers.authorization);

        await auth.api.setUserPassword({
            body: { userId: id, newPassword: password },
            headers,
        });

        successResponse(res, 200, "Password updated successfully", null);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        if (!id) {
            errorResponse(res, "User id is required", 400);
            return;
        }
        await assertCanManageUser((req as any).user, id);
        await deleteUserFromDb(id);
        successResponse(res, 200, "User deleted successfully", null);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const deleteAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
        await deleteAllUsersFromDb();
        successResponse(res, 200, "All users deleted successfully", null);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const updateUserSubscription = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { planId } = req.body;
        if (!id) { errorResponse(res, "User id is required", 400); return; }
        if (!planId) { errorResponse(res, "planId is required", 400); return; }

        const result = await updateUserSubscriptionInDb(id, planId.trim());
        successResponse(res, 200, "Subscription updated successfully", result);
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", error?.statusCode || 500);
    }
};

export const uploadProfileImage = async (req: Request, res: Response): Promise<void> => {
    try {
        if (!req.file || !req.file.buffer) {
            errorResponse(res, "No file uploaded", 400);
            return;
        }

        const r2Result = await uploadToR2(req.file.buffer, req.file.mimetype, "avatars");

        successResponse(res, 200, "Profile image uploaded successfully", { url: r2Result.url });
    } catch (error: any) {
        errorResponse(res, error?.message || "Internal server error", 500);
    }
};