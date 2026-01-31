/*
  Warnings:

  - You are about to drop the `ContactEmail` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ContactPhone` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SMSTemplate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Script` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `accounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `action_plans` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `action_steps` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `appearance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `billings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `calendar` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `call_settings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `callback_prompts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `caller_id` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_dnc` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `contacts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `data_dialers` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `dialer_settings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `email_templates` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `integrations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lead_sheet_questions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lead_sheets` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lead_store_services` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lead_stores` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `leads` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `libraries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lists` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `media_center` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `misc_fields` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `multi_line_dialers` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `notification_settings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `plan_features` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `products` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `report_analytics` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sessions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `system_settings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_subscriptions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `verifications` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ContactEmail" DROP CONSTRAINT "ContactEmail_contactId_fkey";

-- DropForeignKey
ALTER TABLE "ContactPhone" DROP CONSTRAINT "ContactPhone_contactId_fkey";

-- DropForeignKey
ALTER TABLE "SMSTemplate" DROP CONSTRAINT "SMSTemplate_libraryId_fkey";

-- DropForeignKey
ALTER TABLE "Script" DROP CONSTRAINT "Script_libraryId_fkey";

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_userId_fkey";

-- DropForeignKey
ALTER TABLE "action_plans" DROP CONSTRAINT "action_plans_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "action_steps" DROP CONSTRAINT "action_steps_planId_fkey";

-- DropForeignKey
ALTER TABLE "appearance" DROP CONSTRAINT "appearance_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "billings" DROP CONSTRAINT "billings_userId_fkey";

-- DropForeignKey
ALTER TABLE "calendar" DROP CONSTRAINT "calendar_assignById_fkey";

-- DropForeignKey
ALTER TABLE "calendar" DROP CONSTRAINT "calendar_assignToId_fkey";

-- DropForeignKey
ALTER TABLE "call_settings" DROP CONSTRAINT "call_settings_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "callback_prompts" DROP CONSTRAINT "callback_prompts_libraryId_fkey";

-- DropForeignKey
ALTER TABLE "caller_id" DROP CONSTRAINT "caller_id_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "compliance_dnc" DROP CONSTRAINT "compliance_dnc_userId_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_dataDialerId_fkey";

-- DropForeignKey
ALTER TABLE "data_dialers" DROP CONSTRAINT "data_dialers_userId_fkey";

-- DropForeignKey
ALTER TABLE "dialer_settings" DROP CONSTRAINT "dialer_settings_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "email_templates" DROP CONSTRAINT "email_templates_libraryId_fkey";

-- DropForeignKey
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "lead_sheet_questions" DROP CONSTRAINT "lead_sheet_questions_leadSheetId_fkey";

-- DropForeignKey
ALTER TABLE "lead_sheets" DROP CONSTRAINT "lead_sheets_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "lead_stores" DROP CONSTRAINT "lead_stores_billingId_fkey";

-- DropForeignKey
ALTER TABLE "lead_stores" DROP CONSTRAINT "lead_stores_userId_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_userId_fkey";

-- DropForeignKey
ALTER TABLE "libraries" DROP CONSTRAINT "libraries_userId_fkey";

-- DropForeignKey
ALTER TABLE "media_center" DROP CONSTRAINT "media_center_libraryId_fkey";

-- DropForeignKey
ALTER TABLE "misc_fields" DROP CONSTRAINT "misc_fields_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "multi_line_dialers" DROP CONSTRAINT "multi_line_dialers_userId_fkey";

-- DropForeignKey
ALTER TABLE "notification_settings" DROP CONSTRAINT "notification_settings_systemSettingId_fkey";

-- DropForeignKey
ALTER TABLE "plan_features" DROP CONSTRAINT "plan_features_userId_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_userId_fkey";

-- DropForeignKey
ALTER TABLE "report_analytics" DROP CONSTRAINT "report_analytics_userId_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_userId_fkey";

-- DropForeignKey
ALTER TABLE "system_settings" DROP CONSTRAINT "system_settings_userId_fkey";

-- DropForeignKey
ALTER TABLE "user_subscriptions" DROP CONSTRAINT "user_subscriptions_billingId_fkey";

-- DropForeignKey
ALTER TABLE "user_subscriptions" DROP CONSTRAINT "user_subscriptions_userId_fkey";

-- DropTable
DROP TABLE "ContactEmail";

-- DropTable
DROP TABLE "ContactPhone";

-- DropTable
DROP TABLE "SMSTemplate";

-- DropTable
DROP TABLE "Script";

-- DropTable
DROP TABLE "accounts";

-- DropTable
DROP TABLE "action_plans";

-- DropTable
DROP TABLE "action_steps";

-- DropTable
DROP TABLE "appearance";

-- DropTable
DROP TABLE "billings";

-- DropTable
DROP TABLE "calendar";

-- DropTable
DROP TABLE "call_settings";

-- DropTable
DROP TABLE "callback_prompts";

-- DropTable
DROP TABLE "caller_id";

-- DropTable
DROP TABLE "compliance_dnc";

-- DropTable
DROP TABLE "contacts";

-- DropTable
DROP TABLE "data_dialers";

-- DropTable
DROP TABLE "dialer_settings";

-- DropTable
DROP TABLE "email_templates";

-- DropTable
DROP TABLE "integrations";

-- DropTable
DROP TABLE "lead_sheet_questions";

-- DropTable
DROP TABLE "lead_sheets";

-- DropTable
DROP TABLE "lead_store_services";

-- DropTable
DROP TABLE "lead_stores";

-- DropTable
DROP TABLE "leads";

-- DropTable
DROP TABLE "libraries";

-- DropTable
DROP TABLE "lists";

-- DropTable
DROP TABLE "media_center";

-- DropTable
DROP TABLE "misc_fields";

-- DropTable
DROP TABLE "multi_line_dialers";

-- DropTable
DROP TABLE "notification_settings";

-- DropTable
DROP TABLE "plan_features";

-- DropTable
DROP TABLE "products";

-- DropTable
DROP TABLE "report_analytics";

-- DropTable
DROP TABLE "sessions";

-- DropTable
DROP TABLE "system_settings";

-- DropTable
DROP TABLE "user_subscriptions";

-- DropTable
DROP TABLE "users";

-- DropTable
DROP TABLE "verifications";

-- DropEnum
DROP TYPE "ActionEndLogic";

-- DropEnum
DROP TYPE "ActionSchedType";

-- DropEnum
DROP TYPE "ActionStepType";

-- DropEnum
DROP TYPE "ActionTriggerType";

-- DropEnum
DROP TYPE "BillingCycle";

-- DropEnum
DROP TYPE "EventType";

-- DropEnum
DROP TYPE "FileCategory";

-- DropEnum
DROP TYPE "IntegrationProvider";

-- DropEnum
DROP TYPE "IntegrationStatus";

-- DropEnum
DROP TYPE "LeadSheetQuestionType";

-- DropEnum
DROP TYPE "MediaType";

-- DropEnum
DROP TYPE "PhoneType";

-- DropEnum
DROP TYPE "Plan";

-- DropEnum
DROP TYPE "RecordingType";

-- DropEnum
DROP TYPE "Status";

-- DropEnum
DROP TYPE "SubscriptionStatus";

-- DropEnum
DROP TYPE "TeamAccess";

-- DropEnum
DROP TYPE "UserRole";

-- DropEnum
DROP TYPE "UserStatus";

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "defaultTimeZone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "dateTimeFormat" TEXT NOT NULL DEFAULT 'MM/DD/YYYY - hh:mm A',
    "zohoSubscriptionsConnected" BOOLEAN NOT NULL DEFAULT false,
    "zohoApiKey" TEXT,
    "zohoOrganizationId" TEXT,
    "zohoLastSyncedAt" TIMESTAMP(3),
    "notifyFailedPayment" BOOLEAN NOT NULL DEFAULT true,
    "notifyUpcomingRenewal" BOOLEAN NOT NULL DEFAULT true,
    "notifyMaintenanceNotice" BOOLEAN NOT NULL DEFAULT true,
    "notifyCriticalError" BOOLEAN NOT NULL DEFAULT true,
    "emailDailySummary" BOOLEAN NOT NULL DEFAULT true,
    "emailWeeklyReport" BOOLEAN NOT NULL DEFAULT true,
    "emailNewUserSignups" BOOLEAN NOT NULL DEFAULT false,
    "emailSubscriptionChanges" BOOLEAN NOT NULL DEFAULT true,
    "emailSecurityAlerts" BOOLEAN NOT NULL DEFAULT true,
    "minPasswordLength" INTEGER NOT NULL DEFAULT 8,
    "passwordExpiryDays" INTEGER DEFAULT 90,
    "requireSpecialChars" BOOLEAN NOT NULL DEFAULT true,
    "requireNumbers" BOOLEAN NOT NULL DEFAULT true,
    "requireUppercase" BOOLEAN NOT NULL DEFAULT true,
    "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "require2faForAdmins" BOOLEAN NOT NULL DEFAULT false,
    "allow2faForUsers" BOOLEAN NOT NULL DEFAULT true,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "callLogRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "callRecordingRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "inactiveUserDataRetentionDays" INTEGER NOT NULL DEFAULT 180,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
