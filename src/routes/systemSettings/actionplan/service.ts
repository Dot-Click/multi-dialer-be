import prisma from '../../../lib/prisma';

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

      // 3. Loop through steps. EMAIL steps are queued for automatic sending
      // (actionPlanStep.job.ts) — no Calendar row, since nothing needs a
      // human to act on it and a duplicate "reminder" about the same email
      // is exactly the confusing double-notification this replaces. Every
      // other step type still needs a person to actually do it, so those
      // keep the existing Calendar-task behavior unchanged.
      for (const step of plan.steps) {
        let execDate = new Date(baseDate);
        if (step.dayOffset) {
          execDate.setDate(execDate.getDate() + step.dayOffset);
        }

        if (step.actionType === 'EMAIL') {
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

        // Map Step Type to Calendar Category
        let category: 'TASK' | 'APPOINTMENT' | 'FOLLOW_UP' = 'TASK';
        if (step.actionType === 'PHONE_CALL') category = 'FOLLOW_UP';

        const title = `${step.actionType}: ${plan.name} - Step ${step.order}`;
        const description = step.contentValue || `Action Plan Step: ${step.actionType}`;

        await tx.calendar.create({
          data: {
            title,
            description,
            color: category === 'FOLLOW_UP' ? '#3b82f6' : '#8b5cf6',
            eventType: 'START_ONLY',
            category,
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

  /** Active (or most-recent) plan assignments for a contact, newest first. */
  static async getActiveForContact(contactId: string) {
    return prisma.contactActionPlan.findMany({
      where: { contactId, status: 'ACTIVE' },
      include: {
        plan: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
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
}