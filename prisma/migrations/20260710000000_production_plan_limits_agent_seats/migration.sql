-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agentSeatMonthlyPriceCents" INTEGER,
ADD COLUMN     "stripeAgentSeatItemId" TEXT;
-- CreateTable
CREATE TABLE "plan_limits" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "displayName" TEXT,
    "maxDialerLines" INTEGER,
    "includedAgentSeats" INTEGER,
    "maxAgentSeats" INTEGER,
    "extraAgentSeatPriceCents" INTEGER,
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
-- CreateTable
CREATE TABLE "agent_seat_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_seat_subscriptions_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "plan_limits_planKey_key" ON "plan_limits"("planKey");
-- CreateIndex
CREATE UNIQUE INDEX "agent_seat_subscriptions_userId_key" ON "agent_seat_subscriptions"("userId");
-- AddForeignKey
ALTER TABLE "agent_seat_subscriptions" ADD CONSTRAINT "agent_seat_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
