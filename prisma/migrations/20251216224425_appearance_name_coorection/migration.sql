/*
  Warnings:

  - You are about to drop the `appearance_settings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "appearance_settings" DROP CONSTRAINT "appearance_settings_systemSettingId_fkey";

-- DropTable
DROP TABLE "appearance_settings";

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

-- CreateIndex
CREATE UNIQUE INDEX "appearance_systemSettingId_key" ON "appearance"("systemSettingId");

-- AddForeignKey
ALTER TABLE "appearance" ADD CONSTRAINT "appearance_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
