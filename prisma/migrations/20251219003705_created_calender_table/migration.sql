-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('START_ONLY', 'FROM_TO', 'ALL_DAY');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('TWILIO', 'GOOGLE_MAPS', 'REALTOR_DOT_COM', 'BOMB_BOMB', 'GMAIL', 'STANPP_DOT_COM', 'MY_PLUS_LEADS', 'ZAPIER');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'FAILED', 'PROCESSING', 'NEED_SETUP');

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

-- CreateIndex
CREATE UNIQUE INDEX "integrations_systemSettingId_provider_key" ON "integrations"("systemSettingId", "provider");

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_assignToId_fkey" FOREIGN KEY ("assignToId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_assignById_fkey" FOREIGN KEY ("assignById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
