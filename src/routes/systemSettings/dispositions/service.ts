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
            { label: "Contact", value: "CONTACT", color: "green", icon: "Users", isSystem: true, isActive: true, order: 1 },
            { label: "No Answer", value: "NO_ANSWER", color: "red", icon: "PhoneOff", isSystem: true, isActive: true, order: 2 },
            { label: "bad number", value: "BAD_NUMBER", color: "gray", icon: "XCircle", isSystem: true, isActive: true, order: 3 },
            { label: "voice mail", value: "VOICEMAIL", color: "blue", icon: "Mail", isSystem: true, isActive: true, order: 4 },
            { label: "DNC contact", value: "DNC_CONTACT", color: "orange", icon: "Ban", isSystem: true, isActive: true, order: 5 },
            { label: "DNC Number", value: "DNC_NUMBER", color: "orange", icon: "Ban", isSystem: true, isActive: true, order: 6 },
        ];

        // 1. Cleanup: Remove old system dispositions that are no longer in our defaults list
        const allowedSystemValues = mojoDefaults.map(d => d.value);
        const systemDispsToRemove = systemSetting.dispositions.filter(d => d.isSystem && !allowedSystemValues.includes(d.value));

        if (systemDispsToRemove.length > 0) {
            await prisma.disposition.deleteMany({
                where: { id: { in: systemDispsToRemove.map(d => d.id) } }
            });
            // Re-fetch before proceeding to sync
            systemSetting = await prisma.system_Setting.findFirst({
                where: { userId: targetUserId },
                include: { dispositions: { orderBy: { order: 'asc' } } }
            }) ?? systemSetting;
        }

        // 2. Sync: Ensure these Mojo-standard defaults exist and are up-to-date
        for (const def of mojoDefaults) {
            const existing = systemSetting.dispositions.find(d => d.value === def.value);
            if (!existing) {
                await prisma.disposition.create({
                    data: { ...def, systemSettingId: systemSetting.id }
                });
            } else if (existing.isSystem && (existing.label !== def.label || existing.color !== def.color || existing.icon !== def.icon)) {
                // Update existing system disposition if defaults changed
                await prisma.disposition.update({
                    where: { id: existing.id },
                    data: { label: def.label, color: def.color, icon: def.icon }
                });
            }
        }

        // 3. Final Fetch: Return the clean synced list
        systemSetting = await prisma.system_Setting.findFirst({
            where: { userId: targetUserId },
            include: { dispositions: { orderBy: { order: 'asc' } } }
        }) ?? systemSetting;

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
