import prisma from '../../../lib/prisma';

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

      // 2. Loop through steps and create Calendar entries
      const baseDate = new Date(startDate);
      
      for (const step of plan.steps) {
        let execDate = new Date(baseDate);
        
        // Use the actual dayOffset from the schema
        if (step.dayOffset) {
          execDate.setDate(execDate.getDate() + step.dayOffset);
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

      // 3. Update Contact Status
      await tx.contact.update({
        where: { id: contactId },
        data: { status: 'FOLLOW_UP' }
      });

      return { success: true, stepsCreated: plan.steps.length };
    });
  }
}