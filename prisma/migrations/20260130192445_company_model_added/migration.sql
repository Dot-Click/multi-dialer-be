-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'SUSPENDED', 'PENDING', 'EXPIRING_SOON');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('AGENT', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'PENDING');

-- CreateEnum
CREATE TYPE "TeamAccess" AS ENUM ('ALL', 'SALES', 'SUPPORT', 'PROJECT_MANAGER');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('VOICE_MAIL', 'ON_HOLD', 'CALLBACK_MESSAGE', 'EMAIL_VIDEO');

-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('audio', 'video');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('START_ONLY', 'FROM_TO', 'ALL_DAY');

-- CreateEnum
CREATE TYPE "PhoneType" AS ENUM ('MOBILE', 'TELEPHONE', 'HOME', 'WORK');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('TWILIO', 'GOOGLE_MAPS', 'REALTOR_DOT_COM', 'BOMB_BOMB', 'GMAIL', 'STANPP_DOT_COM', 'MY_PLUS_LEADS', 'ZAPIER');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'FAILED', 'PROCESSING', 'NEED_SETUP');

-- CreateEnum
CREATE TYPE "ActionSchedType" AS ENUM ('FREQUENCY_BASED', 'DATE_BASED');

-- CreateEnum
CREATE TYPE "ActionStepType" AS ENUM ('EMAIL', 'PHONE_CALL', 'TASK', 'LETTER', 'MAILING_LABEL');

-- CreateEnum
CREATE TYPE "ActionTriggerType" AS ENUM ('NONE', 'CALLING_LIST', 'GROUP');

-- CreateEnum
CREATE TYPE "ActionEndLogic" AS ENUM ('DO_NOTHING', 'REPEAT_PLAN', 'START_OTHER_PLAN');

-- CreateEnum
CREATE TYPE "LeadSheetQuestionType" AS ENUM ('TEXTFIELD', 'DROPDOWN', 'CHECKBOX', 'RADIO', 'DATETIME');

-- CreateEnum
CREATE TYPE "RecordingType" AS ENUM ('VOICE_MAIL', 'ON_HOLD', 'EMAIL_VIDEO');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLogin" TIMESTAMP(3),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "source" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataDialerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "ContactEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPhone" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "PhoneType" NOT NULL,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "ContactPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "images" TEXT[],
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_dialers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_dialers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multi_line_dialers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "multi_line_dialers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "libraries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "libraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "scriptName" TEXT NOT NULL,
    "scriptText" TEXT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SMSTemplate" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SMSTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "callback_prompts" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "recordingType" "RecordingType" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "callback_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_center" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileSize" INTEGER NOT NULL,
    "duration" INTEGER,
    "fileCategory" "FileCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_center_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_analytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_dnc" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_dnc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sheets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "systemSettingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sheet_questions" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "LeadSheetQuestionType" NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN,
    "leadSheetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sheet_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "systemSettingId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NEED_SETUP',
    "credentials" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "systemSettingId" TEXT NOT NULL,
    "enableAppointmentReminders" BOOLEAN NOT NULL DEFAULT false,
    "appointmentReminderEmail" TEXT,
    "enableCallActivityReport" BOOLEAN NOT NULL DEFAULT false,
    "enableSessionSummaryReport" BOOLEAN NOT NULL DEFAULT false,
    "includeAgentsWithNoActivity" BOOLEAN NOT NULL DEFAULT false,
    "dailyCallReportEmail" TEXT,
    "enableAppointmentNotifications" BOOLEAN NOT NULL DEFAULT false,
    "enableComplianceAlerts" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialer_settings" (
    "id" TEXT NOT NULL,
    "useTimeShield" BOOLEAN NOT NULL DEFAULT false,
    "timeShieldStartTime" TEXT,
    "timeShieldEndTime" TEXT,
    "useAnswerNotificationTone" BOOLEAN NOT NULL DEFAULT false,
    "deleteDisconnectedNumbers" BOOLEAN NOT NULL DEFAULT false,
    "deleteFaxNumbers" BOOLEAN NOT NULL DEFAULT false,
    "useCallSessionTimer" BOOLEAN NOT NULL DEFAULT false,
    "systemSettingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dialer_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "Status" NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "usersCount" INTEGER NOT NULL DEFAULT 1,
    "nextBillingDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stores" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_store_services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_store_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "phoneType" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "usersCount" INTEGER NOT NULL DEFAULT 1,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "billingId" TEXT,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "featureName" TEXT NOT NULL,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caller_id" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "availableTo" "TeamAccess"[],
    "onHoldRecording1" TEXT,
    "onHoldRecording2" TEXT,
    "ivrRecording" TEXT,
    "answeringMachineRecording" TEXT,
    "enableAutoPause" BOOLEAN NOT NULL DEFAULT false,
    "enableRecording" BOOLEAN NOT NULL DEFAULT false,
    "sendOutlookAppointment" BOOLEAN NOT NULL DEFAULT false,
    "allowDncCalls" BOOLEAN NOT NULL DEFAULT false,
    "callerId" TEXT,
    "countryCode" TEXT NOT NULL,
    "numberOfLines" INTEGER NOT NULL DEFAULT 1,
    "ringTime" INTEGER NOT NULL DEFAULT 30,
    "callScriptId" TEXT,
    "sendEmail" BOOLEAN NOT NULL DEFAULT false,
    "sendText" BOOLEAN NOT NULL DEFAULT false,
    "systemSettingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caller_id_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_settings" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "onHoldRecording1" TEXT,
    "onHoldRecording2" TEXT,
    "ivrRecording" TEXT,
    "answeringMachineRecording" TEXT,
    "enableAutoPause" BOOLEAN NOT NULL DEFAULT false,
    "enableRecording" BOOLEAN NOT NULL DEFAULT false,
    "sendOutlookAppointment" BOOLEAN NOT NULL DEFAULT false,
    "allowDncCalls" BOOLEAN NOT NULL DEFAULT false,
    "callerId" TEXT,
    "countryCode" TEXT NOT NULL,
    "numberOfLines" INTEGER NOT NULL DEFAULT 1,
    "ringTime" INTEGER NOT NULL DEFAULT 30,
    "callScriptId" TEXT,
    "sendEmail" BOOLEAN NOT NULL DEFAULT false,
    "sendText" BOOLEAN NOT NULL DEFAULT false,
    "systemSettingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "misc_fields" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "options" TEXT[],
    "countFrom" INTEGER,
    "countTo" INTEGER,
    "allowPastDates" BOOLEAN,
    "systemSettingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "misc_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appearance" (
    "id" TEXT NOT NULL,
    "calendar" BOOLEAN NOT NULL DEFAULT true,
    "hotlist" BOOLEAN NOT NULL DEFAULT true,
    "callingGroupsWorkspace" BOOLEAN NOT NULL DEFAULT true,
    "dialerHealth" BOOLEAN NOT NULL DEFAULT true,
    "callStatistics" BOOLEAN NOT NULL DEFAULT true,
    "foldersLists" BOOLEAN NOT NULL DEFAULT true,
    "recentActivity" BOOLEAN NOT NULL DEFAULT true,
    "bestTimeToCall" BOOLEAN NOT NULL DEFAULT true,
    "leadIntelligence" BOOLEAN NOT NULL DEFAULT true,
    "aiCoachingCallAnalysis" BOOLEAN NOT NULL DEFAULT true,
    "callOutcomeIntelligence" BOOLEAN NOT NULL DEFAULT true,
    "efficiencyAutomation" BOOLEAN NOT NULL DEFAULT true,
    "complianceRiskMonitoring" BOOLEAN NOT NULL DEFAULT true,
    "callingGroupsAiSidekick" BOOLEAN NOT NULL DEFAULT true,
    "agentImprovementScores" BOOLEAN NOT NULL DEFAULT true,
    "pipelineAccelerationIndex" BOOLEAN NOT NULL DEFAULT true,
    "lockGroups" BOOLEAN NOT NULL DEFAULT false,
    "birthdays" BOOLEAN NOT NULL DEFAULT false,
    "homeCloseDate" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'CST',
    "systemSettingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "assignToId" TEXT NOT NULL,
    "assignById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plans" (
    "id" TEXT NOT NULL,
    "systemSettingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedulingType" "ActionSchedType" NOT NULL DEFAULT 'FREQUENCY_BASED',
    "schedulingLogic" "ActionSchedType" NOT NULL DEFAULT 'FREQUENCY_BASED',
    "weekendScheduling" "ActionSchedType" NOT NULL DEFAULT 'FREQUENCY_BASED',
    "triggerType" "ActionTriggerType" NOT NULL DEFAULT 'NONE',
    "triggerSourceId" TEXT,
    "removeOnTriggerExit" BOOLEAN NOT NULL DEFAULT false,
    "endLogic" "ActionEndLogic" NOT NULL DEFAULT 'DO_NOTHING',
    "assignGroupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "assignGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_steps" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "actionType" "ActionStepType" NOT NULL,
    "contentValue" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL DEFAULT 0,
    "planId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "contacts_dataDialerId_idx" ON "contacts"("dataDialerId");

-- CreateIndex
CREATE INDEX "ContactEmail_email_idx" ON "ContactEmail"("email");

-- CreateIndex
CREATE INDEX "ContactPhone_number_idx" ON "ContactPhone"("number");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Script_scriptName_key" ON "Script"("scriptName");

-- CreateIndex
CREATE UNIQUE INDEX "SMSTemplate_templateName_key" ON "SMSTemplate"("templateName");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_libraryId_templateName_key" ON "email_templates"("libraryId", "templateName");

-- CreateIndex
CREATE UNIQUE INDEX "callback_prompts_libraryId_templateName_key" ON "callback_prompts"("libraryId", "templateName");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sheets_title_key" ON "lead_sheets"("title");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_systemSettingId_provider_key" ON "integrations"("systemSettingId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_systemSettingId_key" ON "notification_settings"("systemSettingId");

-- CreateIndex
CREATE UNIQUE INDEX "dialer_settings_systemSettingId_key" ON "dialer_settings"("systemSettingId");

-- CreateIndex
CREATE UNIQUE INDEX "billings_invoiceNumber_key" ON "billings"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "lead_stores_billingId_key" ON "lead_stores"("billingId");

-- CreateIndex
CREATE UNIQUE INDEX "user_subscriptions_billingId_key" ON "user_subscriptions"("billingId");

-- CreateIndex
CREATE UNIQUE INDEX "user_subscriptions_userId_plan_key" ON "user_subscriptions"("userId", "plan");

-- CreateIndex
CREATE UNIQUE INDEX "appearance_systemSettingId_key" ON "appearance"("systemSettingId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_dataDialerId_fkey" FOREIGN KEY ("dataDialerId") REFERENCES "data_dialers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEmail" ADD CONSTRAINT "ContactEmail_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPhone" ADD CONSTRAINT "ContactPhone_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_dialers" ADD CONSTRAINT "data_dialers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multi_line_dialers" ADD CONSTRAINT "multi_line_dialers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SMSTemplate" ADD CONSTRAINT "SMSTemplate_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "callback_prompts" ADD CONSTRAINT "callback_prompts_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_center" ADD CONSTRAINT "media_center_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_analytics" ADD CONSTRAINT "report_analytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_dnc" ADD CONSTRAINT "compliance_dnc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sheets" ADD CONSTRAINT "lead_sheets_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sheet_questions" ADD CONSTRAINT "lead_sheet_questions_leadSheetId_fkey" FOREIGN KEY ("leadSheetId") REFERENCES "lead_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialer_settings" ADD CONSTRAINT "dialer_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billings" ADD CONSTRAINT "billings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stores" ADD CONSTRAINT "lead_stores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stores" ADD CONSTRAINT "lead_stores_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "billings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caller_id" ADD CONSTRAINT "caller_id_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_settings" ADD CONSTRAINT "call_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "misc_fields" ADD CONSTRAINT "misc_fields_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appearance" ADD CONSTRAINT "appearance_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_assignToId_fkey" FOREIGN KEY ("assignToId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_assignById_fkey" FOREIGN KEY ("assignById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_planId_fkey" FOREIGN KEY ("planId") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
