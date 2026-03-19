import prisma from "../../lib/prisma";

export async function getEmailHistoryForContactFromDb(contactId: string) {
  return prisma.emailLog.findMany({
    where: { contactId },
    include: {
      user: { select: { fullName: true, email: true } },
      template: { select: { templateName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAllEmailHistoryFromDb(userId: string, role: string) {
  if (role === "OWNER" || role === "ADMIN") {
    // For admins/owners, maybe they want to see all or filter. 
    // For simplicity, let's say they see everything or based on their agents.
    // Following getAdminUserPool pattern used elsewhere
    const poolUserIds = await getAdminUserPool(userId);
    return prisma.emailLog.findMany({
      where: { userId: { in: poolUserIds } },
      include: {
        user: { select: { fullName: true, email: true } },
        contact: { select: { fullName: true } },
        lead: { select: { fullName: true } },
        template: { select: { templateName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return prisma.emailLog.findMany({
    where: { userId },
    include: {
      user: { select: { fullName: true, email: true } },
      contact: { select: { fullName: true } },
      lead: { select: { fullName: true } },
      template: { select: { templateName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Returns the pool of userIds that "belong" to a given admin:
 * the admin themselves + every agent they created.
 */
async function getAdminUserPool(adminId: string): Promise<string[]> {
  const agents = await prisma.user.findMany({
    where: { createdById: adminId },
    select: { id: true },
  });
  return [adminId, ...agents.map((a) => a.id)];
}
