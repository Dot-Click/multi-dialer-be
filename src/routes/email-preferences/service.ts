import prisma from "../../lib/prisma";

export interface EmailPreferencesPayload {
  trialReminders?:   boolean;
  inactivityNudges?: boolean;
  marketingEmails?:  boolean;
}

/** Returns the admin's preferences, creating defaults on first access. */
export async function getPreferences(userId: string) {
  return prisma.userEmailPreferences.upsert({
    where:  { userId },
    create: { userId },
    update: {},
    select: {
      trialReminders:   true,
      inactivityNudges: true,
      marketingEmails:  true,
      updatedAt:        true,
    },
  });
}

/** Persists a partial update; unknown fields are ignored. */
export async function updatePreferences(userId: string, data: EmailPreferencesPayload) {
  return prisma.userEmailPreferences.upsert({
    where:  { userId },
    create: { userId, ...data },
    update: data,
    select: {
      trialReminders:   true,
      inactivityNudges: true,
      marketingEmails:  true,
      updatedAt:        true,
    },
  });
}
