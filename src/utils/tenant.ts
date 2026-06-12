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
