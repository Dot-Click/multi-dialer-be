import { Request, Response } from 'express';
import { ActionPlanService } from './service';
import prisma from '../../../lib/prisma';

export const ActionPlanController = {
  // Screen 1: List Table
  list: async (req: any, res: Response) => {
    try {
      let targetUserId = req.user.id;
      
      // If the user is an AGENT, they should see plans created by their ADMIN (creator)
      if (req.user.role === 'AGENT') {
        const user = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { createdById: true }
        });
        if (user?.createdById) {
          targetUserId = user.createdById;
        }
      }

      const settings = await prisma.system_Setting.findFirst({ where: { userId: targetUserId } });
      if (!settings) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const result = await ActionPlanService.getAll(settings.id);
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.log(error)
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
  },

  assign: async (req: any, res: Response) => {
    try {
      const result = await ActionPlanService.assignToContact({
        ...req.body,
        creatorId: req.user.id
      });
      res.status(200).json(result);
    } catch (error: any) {
      console.log("Assign Plan Error:", error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
};