import prisma from "../lib/prisma";

/**
 * Resolves the company (for SMTP config lookup) and email of the acting
 * agent/user. Agents use their creating admin/owner's company, matching the
 * convention used across integration lookups (Stannp, BombBomb, etc.).
 */
export async function resolveCompanyContext(userId: string): Promise<{ companyId?: string; agentEmail?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true, createdById: true },
  });
  if (!user) return {};

  const targetUserId = user.role === "AGENT" && user.createdById ? user.createdById : userId;
  const company = await prisma.company.findFirst({
    where: { userId: targetUserId },
    select: { id: true },
  });

  return { companyId: company?.id, agentEmail: user.email };
}
