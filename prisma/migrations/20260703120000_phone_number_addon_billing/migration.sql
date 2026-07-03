-- CreateEnum
CREATE TYPE "CallerIdBillingSource" AS ENUM ('PLAN_INCLUDED', 'PAID_ADDON');

-- CreateEnum
CREATE TYPE "NumberBillingStatus" AS ENUM ('ACTIVE', 'PAST_DUE');

-- AlterTable
ALTER TABLE "caller_id" ADD COLUMN     "billingSource" "CallerIdBillingSource" NOT NULL DEFAULT 'PLAN_INCLUDED',
ADD COLUMN     "currency" TEXT DEFAULT 'usd',
ADD COLUMN     "monthlyPriceCents" INTEGER,
ADD COLUMN     "numberBillingStatus" "NumberBillingStatus" DEFAULT 'ACTIVE',
ADD COLUMN     "stripeSubscriptionItemId" TEXT;

-- CreateTable
CREATE TABLE "phone_number_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_number_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_number_subscriptions_userId_key" ON "phone_number_subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "phone_number_subscriptions" ADD CONSTRAINT "phone_number_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
