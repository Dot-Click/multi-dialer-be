import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateRegulatorySettingSchema } from "../../../schemas/regulatory.schema";

/** Matches the error shape the company and SMTP services throw, so the
 *  controller can map it to a real status code instead of a blanket 500. */
function throwHttp(statusCode: number, message: string): never {
    throw { message, statusCode };
}

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
 * Canonical IANA zone names keyed by their lowercase form, built once.
 *
 * `Intl.supportedValuesOf` is Node 18+, so it exists on the 20.x this project
 * pins, but it is read off Intl dynamically because the TypeScript lib target
 * here does not declare it. `null` means the runtime lacks it.
 */
let canonicalZones: Map<string, string> | null | undefined;

function getCanonicalZones(): Map<string, string> | null {
    if (canonicalZones !== undefined) return canonicalZones;

    const supportedValuesOf = (Intl as any).supportedValuesOf;
    if (typeof supportedValuesOf !== "function") {
        canonicalZones = null;
        return canonicalZones;
    }

    const zones = new Map<string, string>(
        (supportedValuesOf("timeZone") as string[]).map((zone) => [zone.toLowerCase(), zone]),
    );

    // ICU's canonical list carries no "UTC" and no "Etc/*" entry at all, but
    // UTC is this column's schema default, the value resolveTenantTimeZone
    // falls back to, and an option the frontend offers on engines without
    // supportedValuesOf — so it has to stay settable. It is also the one
    // fixed-offset value that is safe here: zero offset, no daylight saving
    // to get wrong. "Etc/UTC" collapses onto it so the column cannot hold two
    // spellings of the same zone.
    zones.set("utc", "UTC");
    zones.set("etc/utc", "UTC");

    canonicalZones = zones;
    return canonicalZones;
}

/**
 * Returns the canonical IANA name for a submitted timezone, or throws a 400.
 *
 * Validating with `new Intl.DateTimeFormat({ timeZone })` alone is not enough,
 * and the difference matters here specifically: this value decides when a TCPA
 * calling window opens and closes, and which calendar day the Prospecting
 * Tracker counts a call against.
 *
 * ICU resolves a great deal more than IANA zone names. "EST" resolves to
 * America/Panama and "MST" to America/Phoenix — zones that observe no daylight
 * saving at all. An Eastern tenant who stored "EST" would have every
 * call-window check an hour out from March to November, silently. So the
 * submitted value has to appear in the canonical zone list, and the canonical
 * spelling is what gets stored: "america/chicago" is accepted and saved as
 * "America/Chicago", so one zone cannot end up stored two ways.
 */
function normalizeTimeZone(tz: unknown): string {
    if (typeof tz !== "string" || tz.trim() === "") {
        return throwHttp(400, "companyTimeZone must be an IANA timezone name, for example America/Chicago");
    }

    const submitted = tz.trim();
    const zones = getCanonicalZones();

    if (zones) {
        const canonical = zones.get(submitted.toLowerCase());
        if (canonical) return canonical;
        return throwHttp(
            400,
            `"${submitted}" is not an IANA timezone name. Use a zone such as America/Chicago — ` +
            `abbreviations like CST or EST cannot express daylight saving, which would put every ` +
            `call-window check an hour out for half the year.`,
        );
    }

    // Runtime without supportedValuesOf: fall back to the loose check rather
    // than rejecting every timezone the app has.
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: submitted });
    } catch {
        return throwHttp(400, `"${submitted}" is not a valid timezone name. Use an IANA zone such as America/Chicago.`);
    }
    return submitted;
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

    // Whitelist before anything reaches Prisma. This route had no validation
    // middleware and spread req.body straight into regulatorySetting.update —
    // and Prisma's unchecked update input accepts `systemSettingId`, so an
    // admin could reparent their regulatory row onto another tenant's settings
    // and hand them their TCPA hours. Unknown keys are stripped here. (#27)
    const parsed = validateData(updateRegulatorySettingSchema, payload ?? {}) as any;
    if (!parsed || !("data" in parsed)) {
        const detail = Array.isArray(parsed)
            ? parsed.map((issue: any) => `${issue.path?.join(".") || "payload"}: ${issue.message}`).join("; ")
            : "Invalid regulatory settings payload";
        return throwHttp(400, detail);
    }

    // companyTimeZone lives on Company, not RegulatorySetting. Split it out
    // before anything touches the regulatory row — passing it through would
    // fail on an unknown column. What gets written from here on is the
    // canonical form, never the raw submitted string.
    const { companyTimeZone: submittedTimeZone, ...regulatoryPayload } = parsed.data;
    const timeZoneRequested = submittedTimeZone !== undefined;
    const companyTimeZone = timeZoneRequested ? normalizeTimeZone(submittedTimeZone) : undefined;

    // Named fields rather than a spread, so a column added to the model later
    // cannot silently become writable from the request body. Prisma treats an
    // undefined value as "leave this alone".
    const regulatoryData = {
        tcpaFrom: regulatoryPayload.tcpaFrom,
        tcpaTo: regulatoryPayload.tcpaTo,
        tcpaAutodialing: regulatoryPayload.tcpaAutodialing,
        gdprRetentionDays: regulatoryPayload.gdprRetentionDays,
        gdprDeleteRelated: regulatoryPayload.gdprDeleteRelated,
    };
    const hasRegulatoryChanges = Object.values(regulatoryData).some((value) => value !== undefined);

    const systemSetting = await prisma.system_Setting.findFirst({
        where: { userId: targetUserId },
        include: { regulatorySetting: true },
    });

    if (!systemSetting) {
        return throwHttp(404, "System settings not found");
    }

    const applyTimeZone = async (tx: any) => {
        if (!timeZoneRequested) return;

        // The tenant may have no Company row yet — the SMTP save path hit the
        // same case and resolved it by creating a minimal one rather than
        // making the admin fill out a company profile first. companyName is
        // nullable and every other column has a schema default.
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

        // Company.defaultTimeZone is the only tenant timezone the application
        // reads (see resolveTenantTimeZone in src/utils/tenant.ts), so there is
        // nothing else to keep in step here. The `appearance` table carried a
        // legacy `timeZone` column that was dropped from the Prisma model when
        // Appearance became a pure feature-toggle row; writing to it from here
        // threw "Unknown argument `timeZone`" and failed the whole transaction,
        // which is why saving a timezone in Compliance & DNC errored out.
    };

    const auditDetails = JSON.stringify({ ...regulatoryData, companyTimeZone });

    if (!systemSetting.regulatorySetting) {
        return await prisma.$transaction(async (tx) => {
            const created = await tx.regulatorySetting.create({
                data: { ...regulatoryData, systemSettingId: systemSetting.id },
            });
            await applyTimeZone(tx);

            // Audited in both branches: a first-ever save still changes the
            // zone every TCPA window is evaluated against, and a compliance
            // control whose trail depends on which branch ran is not a trail
            // worth having.
            await tx.auditLog.create({
                data: {
                    userId,
                    action: "Updated TCPA/Regulatory Settings",
                    details: auditDetails,
                },
            });

            return {
                ...created,
                companyTimeZone: timeZoneRequested ? companyTimeZone : undefined,
            };
        });
    }

    return await prisma.$transaction(async (tx) => {
        // A timezone-only save sends no regulatory fields; an empty update is
        // a pointless round trip, so skip it rather than write nothing.
        const updated = hasRegulatoryChanges
            ? await tx.regulatorySetting.update({
                where: { id: systemSetting.regulatorySetting!.id },
                data: regulatoryData,
            })
            : systemSetting.regulatorySetting!;

        await applyTimeZone(tx);

        await tx.auditLog.create({
            data: {
                userId,
                action: "Updated TCPA/Regulatory Settings",
                details: auditDetails,
            },
        });

        return {
            ...updated,
            companyTimeZone: timeZoneRequested ? companyTimeZone : undefined,
        };
    });
}
