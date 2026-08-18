-- CreateEnum
CREATE TYPE "ProspectingStage" AS ENUM ('LEAD', 'APPT_SET', 'APPT_MET', 'LISTING_TAKEN', 'UNDER_CONTRACT', 'CLOSED');

-- CreateTable
CREATE TABLE "prospecting_business_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planYear" INTEGER NOT NULL,
    "netIncomeGoal" DECIMAL(14,2) NOT NULL,
    "avgCommissionRatePct" DECIMAL(6,3) NOT NULL DEFAULT 2.9,
    "avgPricePoint" DECIMAL(14,2) NOT NULL DEFAULT 400000,
    "profitMarginPct" DECIMAL(6,3) NOT NULL DEFAULT 70,
    "contactsPerHour" DECIMAL(8,3) NOT NULL DEFAULT 7,
    "contactToLeadPct" DECIMAL(6,3) NOT NULL DEFAULT 10,
    "leadToSetPct" DECIMAL(6,3) NOT NULL DEFAULT 20,
    "setToMetPct" DECIMAL(6,3) NOT NULL DEFAULT 50,
    "metToTakenPct" DECIMAL(6,3) NOT NULL DEFAULT 50,
    "takenToClosedPct" DECIMAL(6,3) NOT NULL DEFAULT 70,
    "takenToUnderContractPct" DECIMAL(6,3) NOT NULL DEFAULT 85,
    "underContractToClosedPct" DECIMAL(6,3) NOT NULL DEFAULT 82.4,
    "includeUnderContract" BOOLEAN NOT NULL DEFAULT true,
    "workingWeeksPerYear" INTEGER NOT NULL DEFAULT 50,
    "workingDaysPerWeek" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospecting_business_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospecting_stage_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stage" "ProspectingStage" NOT NULL,
    "occurredOn" DATE NOT NULL,
    "gci" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospecting_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospecting_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loggedOn" DATE NOT NULL,
    "source" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT true,
    "hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "contacts" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "apptsSet" INTEGER NOT NULL DEFAULT 0,
    "apptsMet" INTEGER NOT NULL DEFAULT 0,
    "listingsTaken" INTEGER NOT NULL DEFAULT 0,
    "underContract" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "gci" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospecting_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospecting_business_plans_userId_planYear_key" ON "prospecting_business_plans"("userId", "planYear");

-- CreateIndex
CREATE INDEX "prospecting_stage_events_userId_occurredOn_idx" ON "prospecting_stage_events"("userId", "occurredOn");

-- CreateIndex
CREATE INDEX "prospecting_stage_events_userId_stage_occurredOn_idx" ON "prospecting_stage_events"("userId", "stage", "occurredOn");

-- CreateIndex
CREATE INDEX "prospecting_stage_events_userId_source_idx" ON "prospecting_stage_events"("userId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "prospecting_stage_events_contactId_stage_key" ON "prospecting_stage_events"("contactId", "stage");

-- CreateIndex
CREATE INDEX "prospecting_sessions_userId_loggedOn_idx" ON "prospecting_sessions"("userId", "loggedOn");

-- CreateIndex
CREATE UNIQUE INDEX "prospecting_sessions_userId_loggedOn_source_key" ON "prospecting_sessions"("userId", "loggedOn", "source");

-- AddForeignKey
ALTER TABLE "prospecting_business_plans" ADD CONSTRAINT "prospecting_business_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_stage_events" ADD CONSTRAINT "prospecting_stage_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_stage_events" ADD CONSTRAINT "prospecting_stage_events_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_sessions" ADD CONSTRAINT "prospecting_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

