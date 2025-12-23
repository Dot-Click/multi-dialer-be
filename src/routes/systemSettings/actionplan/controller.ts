import { Request, Response } from 'express';
import { ActionPlanService } from './service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const ActionPlanController = {
  // Screen 1: List Table
  list: async (req: any, res: Response) => {
    try {
      const settings = await prisma.system_Setting.findFirst({ where: { userId: req.user.id } });
      if (!settings) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const result = await ActionPlanService.getAll(settings.id);
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Screen 5: Save Wizard
  create: async (req: any, res: Response) => {
    try {
      const settings = await prisma.system_Setting.findFirst({ where: { userId: req.user.id } });
      if (!settings) throw new Error("System settings not found for this user.");

      const result = await ActionPlanService.create(settings.id, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  },

  getOne: async (req: Request, res: Response) => {
    const result = await ActionPlanService.getById(req.params.id);
    res.status(result ? 200 : 404).json({ success: !!result, data: result });
  },

  update: async (req: Request, res: Response) => {
    try {
      const result = await ActionPlanService.update(req.params.id, req.body);
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  },

  remove: async (req: Request, res: Response) => {
    try {
      await ActionPlanService.delete(req.params.id);
      res.status(200).json({ success: true, message: "Deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }
};