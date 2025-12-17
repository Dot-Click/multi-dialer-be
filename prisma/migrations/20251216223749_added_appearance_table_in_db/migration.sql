-- CreateTable
CREATE TABLE "appearance_settings" (
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

    CONSTRAINT "appearance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appearance_settings_systemSettingId_key" ON "appearance_settings"("systemSettingId");

-- AddForeignKey
ALTER TABLE "appearance_settings" ADD CONSTRAINT "appearance_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
