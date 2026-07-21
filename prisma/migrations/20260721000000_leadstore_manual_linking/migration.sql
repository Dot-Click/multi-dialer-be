-- Manual MyPlusLeads account linking + Lead Store billing gate
-- NOTE: applied to the live database via `prisma db push` because `prisma migrate dev`'s
-- shadow-database replay fails on pre-existing, unrelated drift (the "my_plus_leads_configs"
-- table has no CREATE TABLE migration in history -- it predates this change). This file
-- documents the change; it is registered as already-applied via `prisma migrate resolve`.

-- AlterTable: my_plus_leads_configs is no longer 1:1 with users (a user can have
-- multiple linked MyPlusLeads accounts, one per list type), and gains manual-link audit fields.
DROP INDEX IF EXISTS "my_plus_leads_configs_userId_key";
ALTER TABLE "my_plus_leads_configs"
  ADD COLUMN "label" TEXT,
  ADD COLUMN "linkedByUserId" TEXT,
  ADD COLUMN "linkedAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "LeadStoreStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'CANCELLED');

-- AlterTable: lead_stores gains billing-gate + account-link tracking
ALTER TABLE "lead_stores"
  ADD COLUMN "serviceId" TEXT NOT NULL,
  ADD COLUMN "status" "LeadStoreStatus" NOT NULL DEFAULT 'PENDING_SETUP',
  ADD COLUMN "myPlusLeadsConfigId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "stripeSubscriptionItemId" TEXT,
  ADD COLUMN "reminderSentAt" TIMESTAMP(3),
  ADD COLUMN "billingPaused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "lead_stores" ADD CONSTRAINT "lead_stores_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "lead_store_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_stores" ADD CONSTRAINT "lead_stores_myPlusLeadsConfigId_fkey" FOREIGN KEY ("myPlusLeadsConfigId") REFERENCES "my_plus_leads_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
