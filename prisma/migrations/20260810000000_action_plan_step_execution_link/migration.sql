-- Links Callback/Task rows back to the Action Plan step execution that
-- created them, so a call/task reminder fired by an Action Plan can be
-- traced to its plan and step. Nullable — most Callbacks/Tasks are created
-- manually by an agent, not by a plan. Forward-only: existing rows are
-- untouched and simply get NULL here.

-- AlterTable
ALTER TABLE "callbacks" ADD COLUMN "actionPlanStepExecutionId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "actionPlanStepExecutionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "callbacks_actionPlanStepExecutionId_key" ON "callbacks"("actionPlanStepExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_actionPlanStepExecutionId_key" ON "tasks"("actionPlanStepExecutionId");

-- AddForeignKey
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_actionPlanStepExecutionId_fkey" FOREIGN KEY ("actionPlanStepExecutionId") REFERENCES "action_plan_step_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_actionPlanStepExecutionId_fkey" FOREIGN KEY ("actionPlanStepExecutionId") REFERENCES "action_plan_step_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
