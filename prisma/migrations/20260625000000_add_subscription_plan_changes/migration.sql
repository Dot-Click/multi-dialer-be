-- CreateTable
CREATE TABLE "subscription_plan_changes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromPlan" TEXT NOT NULL,
    "toPlan" TEXT NOT NULL,
    "fromAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "changeType" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plan_changes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "subscription_plan_changes" ADD CONSTRAINT "subscription_plan_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
