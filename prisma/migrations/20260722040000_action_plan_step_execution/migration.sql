-- One row per EMAIL-type Action Plan step per enrollment — the dispatch queue
-- actionPlanStep.job.ts polls to actually send automated plan emails. Other
-- step types stay Calendar-only (they require a human to act).

-- CreateEnum
CREATE TYPE "ActionPlanStepExecutionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "action_plan_step_executions" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "ActionPlanStepExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_plan_step_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "action_plan_step_executions_assignmentId_stepId_key" ON "action_plan_step_executions"("assignmentId", "stepId");

-- CreateIndex
CREATE INDEX "action_plan_step_executions_status_dueAt_idx" ON "action_plan_step_executions"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "action_plan_step_executions" ADD CONSTRAINT "action_plan_step_executions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "contact_action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_step_executions" ADD CONSTRAINT "action_plan_step_executions_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "action_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
