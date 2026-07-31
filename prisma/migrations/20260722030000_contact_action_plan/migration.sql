-- Tracks which contact is currently enrolled in which Action Plan, so the
-- contact detail page can show real assignment status instead of just the
-- side-effect Calendar rows assignToContact() creates for each step.

-- CreateEnum
CREATE TYPE "ContactActionPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'REMOVED');

-- CreateTable
CREATE TABLE "contact_action_plans" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "ContactActionPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_action_plans_contactId_status_idx" ON "contact_action_plans"("contactId", "status");

-- AddForeignKey
ALTER TABLE "contact_action_plans" ADD CONSTRAINT "contact_action_plans_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_action_plans" ADD CONSTRAINT "contact_action_plans_planId_fkey" FOREIGN KEY ("planId") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_action_plans" ADD CONSTRAINT "contact_action_plans_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_action_plans" ADD CONSTRAINT "contact_action_plans_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
