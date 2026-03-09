import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

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
}