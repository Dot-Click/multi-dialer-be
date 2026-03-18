import prisma from "@/lib/prisma";

export class DispositionService {
    static async getDispositions(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, createdById: true }
        });

        // If user is AGENT, get their admin's settings
        const targetUserId = (user?.role === 'AGENT' && user?.createdById) ? user.createdById : userId;

        let systemSetting = await prisma.system_Setting.findFirst({
            where: { userId: targetUserId },
            include: { dispositions: { orderBy: { order: 'asc' } } }
        });

        if (!systemSetting) {
            systemSetting = await prisma.system_Setting.create({
                data: { userId: targetUserId },
                include: { dispositions: { orderBy: { order: 'asc' } } }
            });
        }

        if (systemSetting.dispositions.length === 0) {
            const defaults = [
                { label: "Pending", value: "PENDING", color: "gray", icon: "Clock", isSystem: true, isActive: true, order: 1 },
                { label: "Called", value: "CALLED", color: "green", icon: "CheckCircle2", isSystem: true, isActive: true, order: 2 },
                { label: "Failed", value: "FAILED", color: "red", icon: "XCircle", isSystem: true, isActive: true, order: 3 },
                { label: "Busy", value: "BUSY", color: "orange", icon: "PhoneOff", isSystem: true, isActive: true, order: 4 },
                { label: "No Answer", value: "NO_ANSWER", color: "purple", icon: "PhoneMissed", isSystem: true, isActive: true, order: 5 },
                { label: "Hot", value: "HOT", color: "red", icon: "Flame", isSystem: true, isActive: true, order: 6 },
                { label: "Warm", value: "WARM", color: "orange", icon: "Thermometer", isSystem: true, isActive: true, order: 7 },
                { label: "Cold", value: "COLD", color: "blue", icon: "Snowflake", isSystem: true, isActive: true, order: 8 },
                { label: "Call Back", value: "CALL_BACK", color: "yellow", icon: "PhoneIncoming", isSystem: true, isActive: true, order: 9 },
                { label: "Do Not Call", value: "DO_NOT_CALL", color: "red", icon: "Ban", isSystem: true, isActive: true, order: 10 },
                { label: "Not Interested", value: "NOT_INTERESTED", color: "gray", icon: "ThumbsDown", isSystem: true, isActive: true, order: 11 },
            ];

            await prisma.disposition.createMany({
                data: defaults.map(d => ({ ...d, systemSettingId: systemSetting!.id }))
            });

            return await prisma.disposition.findMany({
                where: { systemSettingId: systemSetting.id },
                orderBy: { order: 'asc' }
            });
        }

        return systemSetting.dispositions;
    }

    static async createDisposition(userId: string, data: any) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, createdById: true }
        });

        // If user is AGENT, use their admin's id
        const targetUserId = (user?.role === 'AGENT' && user?.createdById) ? user.createdById : userId;

        const systemSetting = await prisma.system_Setting.findFirst({
            where: { userId: targetUserId }
        });

        if (!systemSetting) throw new Error("System settings not found");

        return await prisma.disposition.create({
            data: {
                ...data,
                systemSettingId: systemSetting.id
            }
        });
    }

    static async updateDisposition(id: string, data: any) {
        return await prisma.disposition.update({
            where: { id },
            data
        });
    }

    static async deleteDisposition(id: string) {
        const disposition = await prisma.disposition.findUnique({ where: { id } });
        if (disposition?.isSystem) throw new Error("Cannot delete system disposition");
        
        return await prisma.disposition.delete({
            where: { id }
        });
    }

    static async reorderDispositions(userId: string, orderData: { id: string, order: number }[]) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, createdById: true }
        });

        // If user is AGENT, get their admin's id
        const targetUserId = (user?.role === 'AGENT' && user?.createdById) ? user.createdById : userId;

        // Verify the system setting exists and is associated with the target
        const systemSetting = await prisma.system_Setting.findFirst({
            where: { userId: targetUserId }
        });

        if (!systemSetting) throw new Error("System settings not found");

        return await prisma.$transaction(
            orderData.map(item => 
                prisma.disposition.update({
                    where: { id: item.id },
                    data: { order: item.order }
                })
            )
        );
    }
}
