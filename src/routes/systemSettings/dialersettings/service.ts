import { PrismaClient, DialerSetting } from '@prisma/client';

const prisma = new PrismaClient();

// Interface for the data coming from the frontend
interface CreateOrUpdateDialerSettingDto {
  useTimeShield?: boolean;
  timeShieldStartTime?: string;
  timeShieldEndTime?: string;
  useAnswerNotificationTone?: boolean;
  deleteDisconnectedNumbers?: boolean;
  deleteFaxNumbers?: boolean;
  useCallSessionTimer?: boolean;
}

export const DialerSettingService = {
  /**
   * Get Dialer Settings by System Setting ID
   */
  getDialerSettings: async (systemSettingId: string) => {
    return await prisma.dialerSetting.findUnique({
      where: { systemSettingId },
    });
  },

  /**
   * Upsert (Create or Update) Dialer Settings
   */
  upsertDialerSettings: async (
    systemSettingId: string,
    data: CreateOrUpdateDialerSettingDto
  ) => {
    // We use upsert to ensure we don't create duplicates for the same system setting
    return await prisma.dialerSetting.upsert({
      where: {
        systemSettingId: systemSettingId,
      },
      update: {
        ...data,
      },
      create: {
        systemSettingId: systemSettingId,
        ...data,
      },
    });
  },
};