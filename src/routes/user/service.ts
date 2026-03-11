import bcrypt from "bcryptjs";
import prisma from "../../lib/prisma";

function throwHttp(statusCode: number, message: string): never {
    throw { message, statusCode };
}

export async function createUserInDb(payload: any) {
    const { password, ...rest } = payload;

    // Hash password if provided
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await prisma.user.findUnique({ where: { email: rest.email } });
    if (existing) throwHttp(400, "User with this email already exists");

    return prisma.user.create({
        data: {
            ...rest,
            password: hashedPassword,
        },
        select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            image: true,
            lastLogin: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}

export async function getAllUsersFromDb() {
    return prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            lastLogin: true,
            createdAt: true,
            updatedAt: true,
            defaultCallerId: true,
            createdBy: {
                select: {
                    id: true,
                    fullName: true,
                    role: true,
                    status: true
                }
            },
            createdUsers: true, 
            // Excluding password
        },
    });
}

export async function updateUserInDb(
    id: string,
    payload: Partial<{
        fullName: string;
        email: string;
        password: string;
        role: "AGENT" | "ADMIN" | "OWNER";
        status: "ACTIVE" | "DEACTIVATED" | "SUSPENDED" | "PENDING" | "EXPIRING_SOON";
        emailVerified: boolean;
        defaultCallerId: string;
    }>
) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throwHttp(404, "User not found");

    return prisma.user.update({
        where: { id },
        data: payload,
        select: {
            id: true,
            fullName: true,
            role: true,
            status: true,
            defaultCallerId: true,
        }
    });
}

export async function deleteUserFromDb(id: string) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throwHttp(404, "User not found");

    await prisma.user.delete({ where: { id } });
    return true;
}

export async function deleteAllUsersFromDb() {
    // Caution: This deletes ALL users
    await prisma.user.deleteMany({});
    return true;
}
