-- CreateTable
CREATE TABLE "plan_limits" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "displayName" TEXT,
    "maxDialerLines" INTEGER,
    "includedAgentSeats" INTEGER,
    "maxAgentSeats" INTEGER,
    "includedNumbers" INTEGER,
    "extraNumberPriceCents" INTEGER,
    "callRecordingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiInsightsLevel" TEXT NOT NULL DEFAULT 'FULL',
    "stirShakenEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smartNumberRotationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "teamDashboardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priorityRoutingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiCallCoachingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "advancedDeliverabilityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "plan_limits_planKey_key" ON "plan_limits"("planKey");
