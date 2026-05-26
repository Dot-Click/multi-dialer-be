import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/handler";
import { validateData } from "../../middlewares/vald.middleware";
import { createUserSchema, updateUserSchema } from "../../schemas/user.schema";
import { getAllUsersFromDb, createUserInDb, updateUserInDb, deleteUserFromDb, deleteAllUsersFromDb } from "./service";
import { generateSecurePassword } from "../../utils/password";
import { uploadToR2 } from "../../utils/r2-uploader";


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
        if (!id) {
            errorResponse(res, "User id is required", 400);
            return;
        }

        const payload = { ...req.body };
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

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        if (!id) {
            errorResponse(res, "User id is required", 400);
            return;
        }
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