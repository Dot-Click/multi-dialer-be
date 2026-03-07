import prisma from "../lib/prisma";

export async function createAuditLog(userId: string, action: string, details?: string) {
    try {
        return await prisma.auditLog.create({
            data: {
                userId,
                action,
                details,
            },
        });
    } catch (error) {
        console.error("Failed to create audit log:", error);
    }
}

export async function getAuditLogsFromDb(limit: number = 100) {
    return await prisma.auditLog.findMany({
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
            user: {
                select: {
                    fullName: true,
                    role: true,
                },
            },
        },
    });
}
