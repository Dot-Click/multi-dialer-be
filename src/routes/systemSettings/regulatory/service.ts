import prisma from "../../../lib/prisma";

export async function getRegulatorySettingFromDb(userId: string) {
    let systemSetting = await prisma.system_Setting.findFirst({
        where: { userId },
        include: { regulatorySetting: true },
    });

    if (!systemSetting) {
        systemSetting = await prisma.system_Setting.create({
            data: { userId },
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
    const systemSetting = await prisma.system_Setting.findFirst({
        where: { userId },
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
