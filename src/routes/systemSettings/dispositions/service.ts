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

        const mojoDefaults = [
            { label: "contact", value: "CONTACT", color: "red", icon: "Users", isSystem: true, isActive: true, order: 1 },
            { label: "no contact", value: "NO_ANSWER", color: "red", icon: "PhoneOff", isSystem: true, isActive: true, order: 2 },
            { label: "bad number", value: "BAD_NUMBER", color: "red", icon: "XCircle", isSystem: true, isActive: true, order: 3 },
            { label: "voice mail", value: "VOICEMAIL", color: "red", icon: "Mail", isSystem: true, isActive: true, order: 4 },
            { label: "DNC contact", value: "DNC_CONTACT", color: "red", icon: "Ban", isSystem: true, isActive: true, order: 5 },
            { label: "DNC number", value: "DNC_NUMBER", color: "red", icon: "Ban", isSystem: true, isActive: true, order: 6 },
        ];

        // Ensure these Mojo-standard defaults exist in DB
        const currentValues = systemSetting.dispositions.map(d => d.value);
        const missingDefaults = mojoDefaults.filter(d => !currentValues.includes(d.value));

        if (missingDefaults.length > 0) {
            await prisma.disposition.createMany({
                data: missingDefaults.map(d => ({ ...d, systemSettingId: systemSetting!.id }))
            });

            // Re-fetch to return complete synced list
            systemSetting = await prisma.system_Setting.findFirst({
                where: { userId: targetUserId },
                include: { dispositions: { orderBy: { order: 'asc' } } }
            }) ?? systemSetting;
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
