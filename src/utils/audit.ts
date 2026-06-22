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

export async function getAuditLogsFromDb(userId: string, role: string, limit: number = 100) {
    let whereClause: any = { userId };

    if (role === 'OWNER') {
        // Super admin sees all platform audit logs
        whereClause = {};
    } else if (role === 'ADMIN') {
        const agents = await prisma.user.findMany({
            where: { createdById: userId },
            select: { id: true }
        });
        const agentIds = agents.map(a => a.id);
        whereClause = {
            userId: { in: [userId, ...agentIds] }
        };
    }

    return await prisma.auditLog.findMany({
        where: whereClause,
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