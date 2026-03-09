-- CreateEnum
CREATE TYPE "TeamAccess" AS ENUM ('ALL', 'SALES', 'SUPPORT', 'PROJECT_MANAGER');

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

-- AddForeignKey
ALTER TABLE "caller_id" ADD CONSTRAINT "caller_id_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_settings" ADD CONSTRAINT "call_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
