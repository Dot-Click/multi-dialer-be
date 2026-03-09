import { z } from "zod";

export const createCompanySchema = z.object({
    companyName: z.string().min(1, "Company name is required"),
    defaultTimeZone: z.string().default("UTC"),
    defaultCurrency: z.string().default("USD"),
    dateTimeFormat: z.string().default("MM/DD/YYYY - hh:mm A"),

    // Zoho Subscriptions Integration
    zohoSubscriptionsConnected: z.boolean().default(false),
    zohoApiKey: z.string().optional().nullable(),
    zohoOrganizationId: z.string().optional().nullable(),
    zohoLastSyncedAt: z.string().datetime().optional().nullable(),

    // Notification Settings
    notifyFailedPayment: z.boolean().default(true),
    notifyUpcomingRenewal: z.boolean().default(true),
    notifyMaintenanceNotice: z.boolean().default(true),
    notifyCriticalError: z.boolean().default(true),

    emailDailySummary: z.boolean().default(true),
    emailWeeklyReport: z.boolean().default(true),
    emailNewUserSignups: z.boolean().default(false),
    emailSubscriptionChanges: z.boolean().default(true),
    emailSecurityAlerts: z.boolean().default(true),

    // Security & Access Settings
    minPasswordLength: z.number().int().min(1).default(8),
    passwordExpiryDays: z.number().int().optional().nullable().default(90),
    requireSpecialChars: z.boolean().default(true),
    requireNumbers: z.boolean().default(true),
    requireUppercase: z.boolean().default(true),

    sessionTimeoutMinutes: z.number().int().min(1).default(30),

    require2faForAdmins: z.boolean().default(false),
    allow2faForUsers: z.boolean().default(true),

    // System Preferences
    defaultLanguage: z.string().default("en"),

    // Data Retention Policy
    callLogRetentionDays: z.number().int().min(0).default(365),
    callRecordingRetentionDays: z.number().int().min(0).default(90),
    inactiveUserDataRetentionDays: z.number().int().min(0).default(180),
});

export const updateCompanySchema = createCompanySchema.partial();
