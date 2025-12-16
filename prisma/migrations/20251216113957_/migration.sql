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

-- CreateIndex
CREATE UNIQUE INDEX "dialer_settings_systemSettingId_key" ON "dialer_settings"("systemSettingId");

-- AddForeignKey
ALTER TABLE "dialer_settings" ADD CONSTRAINT "dialer_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
