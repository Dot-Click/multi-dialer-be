import prisma from "../../../lib/prisma";

/**
 * The tenant that owns settings for this user. Agents read and write their
 * creating admin's settings, matching every other resolver in this folder.
 */
async function resolveSettingsOwner(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, createdById: true },
    });
    return (user?.role === "AGENT" && user.createdById) ? user.createdById : userId;
}

/**
 * Rejects anything Intl cannot resolve, which includes the abbreviations this
 * app has historically stored (Appearance.timeZone still defaults to "CST").
 *
 * An abbreviation is not a timezone: "CST" is a fixed -6 offset with no notion
 * of daylight saving, so every date derived from it is an hour wrong for
 * roughly half the year. That matters here specifically — this value decides
 * when a TCPA calling window opens and closes.
 */
function assertValidTimeZone(tz: unknown): asserts tz is string {
    if (typeof tz !== "string" || tz.trim() === "") {
        throw new Error("companyTimeZone must be an IANA timezone name, for example America/Chicago");
    }
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
        throw new Error(
            `"${tz}" is not a valid timezone name. Use an IANA zone such as America/Chicago ` +
            `rather than an abbreviation like CST — abbreviations cannot express daylight ` +
            `saving, which would put every call-window check an hour out for half the year.`,
        );
    }
}

export async function getRegulatorySettingFromDb(userId: string) {
    const targetUserId = await resolveSettingsOwner(userId);

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
        const created = await prisma.regulatorySetting.create({
            data: { systemSettingId: systemSetting.id },
        });
        // Include the company timezone for consistent TCPA checks on the frontend
        const company = await prisma.company.findFirst({ where: { userId: targetUserId } });
        return { ...created, companyTimeZone: company?.defaultTimeZone || "UTC" };
    }

    // Include the company timezone for consistent TCPA checks on the frontend
    const company = await prisma.company.findFirst({ where: { userId: targetUserId } });
    return { ...systemSetting.regulatorySetting, companyTimeZone: company?.defaultTimeZone || "UTC" };
}

export async function updateRegulatorySettingInDb(userId: string, payload: any) {
    const targetUserId = await resolveSettingsOwner(userId);

    // companyTimeZone lives on Company, not RegulatorySetting. Split it out
    // before anything touches the regulatory row — passing it through would
    // fail on an unknown column.
    const { companyTimeZone, ...regulatoryPayload } = payload ?? {};
    const timeZoneRequested = companyTimeZone !== undefined;
    if (timeZoneRequested) assertValidTimeZone(companyTimeZone);

    const systemSetting = await prisma.system_Setting.findFirst({
        where: { userId: targetUserId },
        include: { regulatorySetting: true },
    });

    if (!systemSetting) {
        throw new Error("System settings not found");
    }

    const applyTimeZone = async (tx: any) => {
        if (!timeZoneRequested) return;

        // The tenant may have no Company row yet — the SMTP save path hit the
        // same case and resolved it by creating a minimal one rather than
        // making the admin fill out a company profile first. Every other
        // column has a schema default.
        const company = await tx.company.findFirst({
            where: { userId: targetUserId },
            select: { id: true },
        });
        if (company) {
            await tx.company.update({
                where: { id: company.id },
                data: { defaultTimeZone: companyTimeZone },
            });
        } else {
            await tx.company.create({
                data: { userId: targetUserId, defaultTimeZone: companyTimeZone },
            });
        }

        // Keep the one timezone control that already exists in the UI in step
        // with this one. updateMany rather than update: a tenant may not have
        // an appearance row yet, and that is not an error worth failing a
        // compliance save over.
        await tx.appearance.updateMany({
            where: { systemSettingId: systemSetting.id },
            data: { timeZone: companyTimeZone },
        });
    };

    if (!systemSetting.regulatorySetting) {
        return await prisma.$transaction(async (tx) => {
            const created = await tx.regulatorySetting.create({
                data: { ...regulatoryPayload, systemSettingId: systemSetting.id },
            });
            await applyTimeZone(tx);
            return {
                ...created,
                companyTimeZone: timeZoneRequested ? companyTimeZone : undefined,
            };
        });
    }

    return await prisma.$transaction(async (tx) => {
        // A timezone-only save sends no regulatory fields; an empty update is
        // a pointless round trip, so skip it rather than write nothing.
        const updated = Object.keys(regulatoryPayload).length > 0
            ? await tx.regulatorySetting.update({
                where: { id: systemSetting.regulatorySetting!.id },
                data: regulatoryPayload,
            })
            : systemSetting.regulatorySetting!;

        await applyTimeZone(tx);

        await tx.auditLog.create({
            data: {
                userId,
                action: "Updated TCPA/Regulatory Settings",
                details: JSON.stringify(payload),
            },
        });

        return {
            ...updated,
            companyTimeZone: timeZoneRequested ? companyTimeZone : undefined,
        };
    });
}
