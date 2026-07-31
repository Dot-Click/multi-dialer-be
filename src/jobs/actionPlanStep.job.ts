import cron from "node-cron";
import prisma from "../lib/prisma";
import { sendTemplateEmailInDb } from "../routes/contact/service";

/**
 * Action Plan Step Job
 *
 * Runs every 5 minutes and dispatches due EMAIL-type Action Plan steps —
 * assignToContact() (actionplan/service.ts) queues one ActionPlanStepExecution
 * row per EMAIL step at enrollment time; this job is what actually sends them.
 * Non-EMAIL steps (PHONE_CALL/TASK/LETTER/MAILING_LABEL) are handled entirely
 * via the Calendar rows created at enrollment — they need a human to act, so
 * there's nothing for this job to send.
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
      console.log(`[ActionPlanStep] ${dueExecutions.length} due email step(s) found.`);

      for (const execution of dueExecutions) {
        // Claim it first (PENDING -> PROCESSING) so a concurrent tick can't
        // double-send if this run overlaps the next one.
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

        try {
          // step.contentValue holds an EmailTemplate id (set by the Action
          // Plan wizard's "Template" dropdown for Email-type steps) — this
          // reuses the same send path as a manual Touch Point template send,
          // including merge-field substitution and signature handling.
          await sendTemplateEmailInDb(
            execution.assignment.contactId,
            execution.step.contentValue,
            execution.assignment.assignedById,
          );
          await prisma.actionPlanStepExecution.update({
            where: { id: execution.id },
            data: { status: "SENT", executedAt: new Date() },
          });
          console.log(`[ActionPlanStep] Sent step for contact ${execution.assignment.contactId} (plan: ${execution.assignment.plan.name}).`);
        } catch (err: any) {
          console.error(`[ActionPlanStep] Failed to send step ${execution.id}:`, err?.message);
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
