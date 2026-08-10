import prisma from '../../../lib/prisma';
import type { Prisma } from '@prisma/client';

// The frontend validates this before submit, but a raw API call (or a future
// UI bug) shouldn't ever surface a raw Prisma "Argument contentValue is
// missing" stack trace to the user — fail with a clear message instead.
function validateSteps(steps: any[]) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("An Action Plan needs at least one step.");
  }
  steps.forEach((step, i) => {
    if (!step.contentValue) {
      throw new Error(`Step ${i + 1} (${step.actionType}) is missing its required content.`);
    }
  });
}

export class ActionPlanService {
  static async getAll(systemSettingId: string) {
    return await prisma.actionPlan.findMany({
      where: { systemSettingId },
      include: { _count: { select: { steps: true } } },
      orderBy: { updatedAt: 'desc' }
    });
  }

  static async getById(id: string) {
    return await prisma.actionPlan.findUnique({
      where: { id },
      include: { steps: true }
    });
  }

  static async create(systemSettingId: string, data: any) {
    const { steps, ...planData } = data;
    validateSteps(steps);
    return await prisma.actionPlan.create({
      data: {
        ...planData,
        systemSettingId,
        steps: { create: steps }
      },
      include: { steps: true }
    });
  }

  static async update(id: string, data: any) {
    const { steps, ...planData } = data;
    validateSteps(steps);
    return await prisma.$transaction(async (tx) => {
      await tx.actionStep.deleteMany({ where: { planId: id } });
      return await tx.actionPlan.update({
        where: { id },
        data: { ...planData, steps: { create: steps } },
        include: { steps: true }
      });
    });
  }

  static async delete(id: string) {
    return await prisma.actionPlan.delete({ where: { id } });
  }
  
  static async assignToContact(data: {
    contactId: string;
    planId: string;
    assignToId: string;
    creatorId: string;
    startDate: string;
  }) {
    const { contactId, planId, assignToId, creatorId, startDate } = data;

    return await prisma.$transaction(async (tx) => {
      // 1. Get Plan and Steps
      const plan = await tx.actionPlan.findUnique({
        where: { id: planId },
        include: { steps: true }
      });

      if (!plan) throw new Error("Action Plan not found");

      // A contact may only have one ACTIVE plan at a time (enforced here and,
      // as a backstop against races/bugs, by a partial unique index on
      // contact_action_plans — see the 20260810010000 migration). Re-assigning
      // the SAME plan (e.g. to tweak the start date) is allowed and replaces
      // it below; assigning a DIFFERENT plan while one is active is not.
      const existingActive = await tx.contactActionPlan.findFirst({
        where: { contactId, status: 'ACTIVE' },
        include: { plan: { select: { name: true } } },
      });
      if (existingActive && existingActive.planId !== planId) {
        throw new Error(
          `This contact already has an active action plan ("${existingActive.plan.name}"). Remove it before assigning a different plan.`
        );
      }

      const baseDate = new Date(startDate);

      // 2. Record the enrollment itself first — everything below hangs off
      // its id. Supersede any prior ACTIVE row for this plan so re-assigning
      // (e.g. after tweaking the start date) doesn't leave two ACTIVE rows.
      await tx.contactActionPlan.updateMany({
        where: { contactId, planId, status: 'ACTIVE' },
        data: { status: 'REMOVED', removedAt: new Date() }
      });
      const assignment = await tx.contactActionPlan.create({
        data: {
          contactId,
          planId,
          assignedToId: assignToId,
          assignedById: creatorId,
          startDate: baseDate,
          status: 'ACTIVE'
        }
      });

      // 3. Loop through steps. EMAIL, PHONE_CALL, and TASK steps are all
      // queued as an ActionPlanStepExecution — actionPlanStep.job.ts fires
      // each one on its due date (sending the email, or creating the
      // Callback/Task at that point) rather than the Calendar row appearing
      // immediately at assignment time. LETTER/MAILING_LABEL have no
      // dispatch mechanism yet, so they keep the old eager Calendar-row stub.
      for (const step of plan.steps) {
        let execDate = new Date(baseDate);
        if (step.dayOffset) {
          execDate.setDate(execDate.getDate() + step.dayOffset);
        }

        if (step.actionType === 'EMAIL' || step.actionType === 'PHONE_CALL' || step.actionType === 'TASK') {
          await tx.actionPlanStepExecution.create({
            data: {
              assignmentId: assignment.id,
              stepId: step.id,
              dueAt: execDate,
              status: 'PENDING',
            }
          });
          continue;
        }

        // LETTER / MAILING_LABEL — out of scope (no print/label generation
        // exists), so these remain a plain Calendar reminder for now.
        const title = `${step.actionType}: ${plan.name} - Step ${step.order}`;
        const description = step.contentValue || `Action Plan Step: ${step.actionType}`;

        await tx.calendar.create({
          data: {
            title,
            description,
            color: '#8b5cf6',
            eventType: 'START_ONLY',
            category: 'TASK',
            startDate: execDate,
            assignToId: assignToId,
            assignById: creatorId,
            contactId: contactId,
            status: 'SET'
          }
        });
      }

      // 4. Update Contact Status
      await tx.contact.update({
        where: { id: contactId },
        data: { status: 'FOLLOW_UP' }
      });

      return { success: true, stepsCreated: plan.steps.length };
    });
  }

  /**
   * Active (or most-recent) plan assignments for a contact, newest first —
   * including each step's live execution status. For PHONE_CALL/TASK steps
   * that have already fired, the linked Callback/Task's own status (e.g.
   * COMPLETED, MISSED) is more up to date than the execution row itself,
   * which just records that it fired.
   */
  static async getActiveForContact(contactId: string) {
    return prisma.contactActionPlan.findMany({
      where: { contactId, status: 'ACTIVE' },
      include: {
        plan: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        stepExecutions: {
          include: {
            step: { select: { id: true, order: true, actionType: true, dayOffset: true, contentValue: true } },
            callback: { select: { id: true, status: true, scheduledAt: true } },
            task: { select: { id: true, status: true, dueAt: true } },
          },
          // Plan-defined order, not dueAt — two steps can share a due date
          // (dayOffset 0), and the step sequence is what "Step 2 of 5" means.
          orderBy: { step: { order: 'asc' } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Marks an assignment REMOVED and cancels any not-yet-sent step emails.
   * Does not touch the Calendar rows already created for non-EMAIL steps —
   * those are informational tasks, not something to retract.
   */
  static async unassign(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.actionPlanStepExecution.updateMany({
        where: { assignmentId: id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      return tx.contactActionPlan.update({
        where: { id },
        data: { status: 'REMOVED', removedAt: new Date() },
      });
    });
  }

  /**
   * Stops every ACTIVE plan assignment for a contact — same effect as
   * unassign() for each of them, but bulk and callable from another
   * transaction (e.g. moveToDncInDb marking a contact DNC). Any PENDING
   * ActionPlanStepExecution rows are flipped to SKIPPED so they can't fire
   * after removal — actionPlanStep.job.ts also re-checks assignment.status
   * before firing as a second guard, but that check only runs once a row
   * comes due, so it can't stop this from showing as "still pending" in the
   * meantime; skipping it here immediately keeps assignment and execution
   * state consistent.
   *
   * Accepts an optional transaction client so callers already inside a
   * transaction (like moveToDncInDb) can include this atomically instead of
   * opening a second, separate transaction.
   */
  static async stopActivePlansForContact(
    contactId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma
  ) {
    const activeAssignments = await client.contactActionPlan.findMany({
      where: { contactId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (activeAssignments.length === 0) return { stopped: 0 };

    const assignmentIds = activeAssignments.map((a) => a.id);
    await client.actionPlanStepExecution.updateMany({
      where: { assignmentId: { in: assignmentIds }, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    await client.contactActionPlan.updateMany({
      where: { id: { in: assignmentIds } },
      data: { status: 'REMOVED', removedAt: new Date() },
    });
    return { stopped: assignmentIds.length };
  }
}