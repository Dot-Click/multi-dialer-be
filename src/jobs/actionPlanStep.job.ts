import cron from "node-cron";
import prisma from "../lib/prisma";
import { sendTemplateEmailInDb } from "../routes/contact/service";
import { createCallbackInDb } from "../routes/callbacks/service";
import { createTaskInDb } from "../routes/tasks/service";

/**
 * Action Plan Step Job
 *
 * Runs every 5 minutes and dispatches due Action Plan steps — assignToContact()
 * (actionplan/service.ts) queues one ActionPlanStepExecution row per EMAIL,
 * PHONE_CALL, or TASK step at enrollment time; this job is what actually fires
 * them on their due date:
 *   - EMAIL sends automatically via the existing template-email path.
 *   - PHONE_CALL creates a Callback (via createCallbackInDb, so it gets the
 *     same CALLBACK_HOLD dialer-queue gate as a manually-created callback).
 *   - TASK creates a Task.
 * LETTER/MAILING_LABEL steps are still handled entirely via the Calendar row
 * created at enrollment — no print/label mechanism exists, so there's nothing
 * for this job to fire for them.
 */
export const startActionPlanStepJob = () => {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const now = new Date();

      const dueExecutions = await prisma.actionPlanStepExecution.findMany({
        where: { status: "PENDING", dueAt: { lte: now } },
        include: {
          step: true,
          assignment: { include: { plan: { select: { name: true } } } },
        },
        take: 100,
      });

      if (dueExecutions.length === 0) return;
      console.log(`[ActionPlanStep] ${dueExecutions.length} due step(s) found.`);

      for (const execution of dueExecutions) {
        // Claim it first (PENDING -> PROCESSING) so a concurrent tick can't
        // double-fire if this run overlaps the next one.
        const claimed = await prisma.actionPlanStepExecution.updateMany({
          where: { id: execution.id, status: "PENDING" },
          data: { status: "PROCESSING" },
        });
        if (claimed.count === 0) continue; // already claimed elsewhere

        // The contact may have been removed from the plan after this row was
        // queued but before it came due — unassign() already flips PENDING
        // rows to SKIPPED, but guard here too in case assignment status
        // changed in the same window.
        if (execution.assignment.status !== "ACTIVE") {
          await prisma.actionPlanStepExecution.update({
            where: { id: execution.id },
            data: { status: "SKIPPED" },
          });
          continue;
        }

        const planName = execution.assignment.plan.name;
        const actionType = execution.step.actionType;

        try {
          if (actionType === "EMAIL") {
            // step.contentValue holds an EmailTemplate id (set by the Action
            // Plan wizard's "Template" dropdown for Email-type steps) — this
            // reuses the same send path as a manual Touch Point template send,
            // including merge-field substitution and signature handling.
            await sendTemplateEmailInDb(
              execution.assignment.contactId,
              execution.step.contentValue,
              execution.assignment.assignedById,
            );
          } else if (actionType === "PHONE_CALL") {
            // Reuses the same creation path as a manually-scheduled callback,
            // so the contact is put on CALLBACK_HOLD (dialer queue gate) the
            // same way — no separate insert path to keep in sync.
            await createCallbackInDb({
              agentId: execution.assignment.assignedToId,
              contactId: execution.assignment.contactId,
              scheduledAt: execution.dueAt,
              notes: `Action Plan: ${planName} — ${execution.step.contentValue || "Follow-up call"}`,
              actionPlanStepExecutionId: execution.id,
            });
          } else if (actionType === "TASK") {
            await createTaskInDb({
              agentId: execution.assignment.assignedToId,
              contactId: execution.assignment.contactId,
              title: `${planName} - Step ${execution.step.order}`,
              dueAt: execution.dueAt,
              notes: execution.step.contentValue || null,
              actionPlanStepExecutionId: execution.id,
            });
          } else {
            // LETTER/MAILING_LABEL steps are never queued as executions
            // (see assignToContact) — an execution row shouldn't exist for
            // them, but fail loudly instead of silently skipping if one does.
            throw new Error(`Unsupported action type for a queued execution: ${actionType}`);
          }

          await prisma.actionPlanStepExecution.update({
            where: { id: execution.id },
            data: { status: "SENT", executedAt: new Date() },
          });
          console.log(`[ActionPlanStep] Fired ${actionType} step for contact ${execution.assignment.contactId} (plan: ${planName}).`);
        } catch (err: any) {
          console.error(`[ActionPlanStep] Failed to fire step ${execution.id}:`, err?.message);
          await prisma.actionPlanStepExecution.update({
            where: { id: execution.id },
            data: { status: "FAILED", error: err?.message || "Unknown error" },
          });
        }
      }
    } catch (err: any) {
      console.error("[ActionPlanStep] Job run failed:", err?.message);
    }
  });

  console.log("[ActionPlanStep] Job started (every 5 min).");
};
