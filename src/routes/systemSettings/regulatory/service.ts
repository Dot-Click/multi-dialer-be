import prisma from "../../../lib/prisma";

export async function getRegulatorySettingFromDb(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, createdById: true },
    });

    // If it's an AGENT, use their creator's (Admin/Owner) settings
    const targetUserId = (user?.role === "AGENT" && user.createdById) ? user.createdById : userId;

    let systemSetting = await prisma.system_Setting.findFirst({
        where: { userId: targetUserId },
        include: { regulatorySetting: true },
    });

    if (!systemSetting) {
        systemSetting = await prisma.system_Setting.create({
            data: { userId: targetUserId },
            include: { regulatorySetting: true },
        });
    }

    if (!systemSetting.regulatorySetting) {
        return await prisma.regulatorySetting.create({
            data: { systemSettingId: systemSetting.id },
        });
    }

    return systemSetting.regulatorySetting;
}

export async function updateRegulatorySettingInDb(userId: string, payload: any) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, createdById: true },
    });

    // Agents shouldn't really update settings, but if they do, it should target the correct one
    const targetUserId = (user?.role === "AGENT" && user.createdById) ? user.createdById : userId;

    const systemSetting = await prisma.system_Setting.findFirst({
        where: { userId: targetUserId },
        include: { regulatorySetting: true },
    });

    if (!systemSetting) {
        throw new Error("System settings not found");
    }

    if (!systemSetting.regulatorySetting) {
        return await prisma.regulatorySetting.create({
            data: {
                ...payload,
                systemSettingId: systemSetting.id,
            },
        });
    }

    return await prisma.$transaction(async (tx) => {
        const updated = await tx.regulatorySetting.update({
            where: { id: systemSetting.regulatorySetting!.id },
            data: payload,
        });

        await tx.auditLog.create({
            data: {
                userId,
                action: "Updated TCPA/Regulatory Settings",
                details: JSON.stringify(payload),
            }
        });

        return updated;
    });
}
