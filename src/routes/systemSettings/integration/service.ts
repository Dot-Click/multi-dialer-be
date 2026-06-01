import prisma from "@/lib/prisma";
import { IntegrationProvider } from "@prisma/client";

export const integrationService = {
  // Helper to find SystemSetting ID for the logged-in user
  findSettingsId: async (userId: string) => {
    const settings = await prisma.system_Setting.findFirst({
      where: { userId },
      select: { id: true }
    });
    return settings?.id;
  },

  // GET /all
  getAll: async () => {
    return await prisma.integration.findMany({
      include: { systemSetting: true }
    });
  },

  // GET / (My Settings)
  getMy: async (systemSettingId: string) => {
    return await prisma.integration.findMany({
      where: { systemSettingId },
    });
  },

  // GET /{id}
  getById: async (id: string) => {
    return await prisma.integration.findUnique({
      where: { id },
    });
  },

  // POST /create (Upsert ensures only ONE record per provider for that user)
  upsert: async (systemSettingId: string, provider: IntegrationProvider, credentials: any) => {
    return await prisma.integration.upsert({
      where: { systemSettingId_provider: { systemSettingId, provider } },
      update: { credentials, status: "CONNECTED", errorMessage: null },
      create: { systemSettingId, provider, credentials, status: "CONNECTED" },
    });
  },

  // PUT /{id}
  updateById: async (id: string, credentials: any) => {
    return await prisma.integration.update({
      where: { id },
      data: { credentials, status: "CONNECTED", errorMessage: null },
    });
  },

  // DELETE /{id}
  deleteById: async (id: string) => {
    return await prisma.integration.delete({
      where: { id },
    });
  },

  // GET a specific provider's integration record for a given systemSettingId
  getProviderIntegration: async (systemSettingId: string, provider: IntegrationProvider) => {
    return await prisma.integration.findUnique({
      where: { systemSettingId_provider: { systemSettingId, provider } },
    });
  },
};
