-- CreateEnum
CREATE TYPE "TeamAccess" AS ENUM ('ALL', 'SALES', 'SUPPORT', 'PROJECT_MANAGER');

-- CreateTable
CREATE TABLE "number_settings" (
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

    CONSTRAINT "number_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "number_settings" ADD CONSTRAINT "number_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
