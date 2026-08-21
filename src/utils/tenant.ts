import prisma from "../lib/prisma";

/**
 * The tenant "root" is the admin that owns a user's tenant.
 * - For an AGENT, that's the admin who created them (createdById).
 * - For an ADMIN/OWNER, it's themselves.
 * Used to group media storage per tenant (e.g. "tenant/<rootId>/...").
 */
export async function resolveTenantRootId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, createdById: true },
  });
  if (!user) return userId;
  return user.role === "AGENT" && user.createdById ? user.createdById : user.id;
}

/**
 * All user ids that belong to the caller's tenant (the admin + every agent the
 * admin created). Used to scope "media library" reads so a tenant shares its
 * media but never sees another tenant's.
 *
 * Returns `null` for OWNER → meaning "no scoping, sees everything".
 */
export async function resolveTenantUserIds(userId: string): Promise<string[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, createdById: true },
  });
  if (!user) return [userId];
  if (user.role === "OWNER") return null; // super-admin: sees everything

  const rootId = user.role === "AGENT" && user.createdById ? user.createdById : user.id;
  const agents = await prisma.user.findMany({
    where: { createdById: rootId },
    select: { id: true },
  });
  return [rootId, ...agents.map((a) => a.id)];
}

/**
 * The tenant's timezone — Company.defaultTimeZone, the same value TCPA
 * calling windows are evaluated against. Agents inherit their admin's.
 *
 * Falls back to UTC rather than throwing when the stored value is unusable.
 * That column may still hold a legacy abbreviation like "CST" (an offset with
 * no daylight saving, so an hour wrong for half the year) written before the
 * Compliance picker existed. A dashboard that 500s on a bad settings value is
 * worse than one that reads UTC and can be corrected in two clicks — but it
 * is logged, because silently reading UTC is how this went unnoticed for so
 * long in the first place.
 */
export async function resolveTenantTimeZone(userId: string): Promise<string> {
  const rootId = await resolveTenantRootId(userId);
  const company = await prisma.company.findFirst({
    where: { userId: rootId },
    select: { defaultTimeZone: true },
  });

  const timeZone = company?.defaultTimeZone;
  if (!timeZone) return "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    console.warn(
      `[tenant] Company.defaultTimeZone for tenant ${rootId} is "${timeZone}", ` +
      `which is not a usable IANA zone. Falling back to UTC — set a real zone ` +
      `in Compliance & DNC. Day boundaries and TCPA windows are wrong until then.`,
    );
    return "UTC";
  }
}
