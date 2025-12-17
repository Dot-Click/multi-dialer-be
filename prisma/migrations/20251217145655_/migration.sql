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

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_systemSettingId_key" ON "notification_settings"("systemSettingId");

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
