-- AlterTable
ALTER TABLE "plan_limits" ADD COLUMN     "extraAgentSeatPriceCents" INTEGER;
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agentSeatMonthlyPriceCents" INTEGER,
ADD COLUMN     "stripeAgentSeatItemId" TEXT;
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
CREATE UNIQUE INDEX "agent_seat_subscriptions_userId_key" ON "agent_seat_subscriptions"("userId");
-- AddForeignKey
ALTER TABLE "agent_seat_subscriptions" ADD CONSTRAINT "agent_seat_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
