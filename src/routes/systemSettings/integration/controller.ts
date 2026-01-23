import { Request, Response } from "express";
import { integrationService } from "./service";
import { IntegrationProvider } from "@prisma/client";

export const integrationController = {
  // POST /create
  create: async (req: any, res: Response) => {
    try {
      const systemSettingId = await integrationService.findSettingsId(req.user.id);
      if (!systemSettingId) {
        res.status(404).json({ error: "System settings not found" });
        return; // Fixed: Standalone return
      }

      const { provider, credentials } = req.body;
      const formattedProvider = provider.toUpperCase() as IntegrationProvider;

      const data = await integrationService.upsert(systemSettingId, formattedProvider, credentials);
      res.status(201).json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to create integration" });
    }
  },

  // GET /all
  getAll: async (req: any, res: Response) => {
    try {
      const data = await integrationService.getAll();
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch all integrations" });
    }
  },

  // GET / (Get My)
  getMy: async (req: any, res: Response) => {
    try {
      const systemSettingId = await integrationService.findSettingsId(req.user.id);
      if (!systemSettingId) {
        res.status(404).json({ error: "System settings not found" });
        return; // Fixed: Standalone return
      }

      const data = await integrationService.getMy(systemSettingId);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch integrations" });
    }
  },

  // GET /{id}
  getById: async (req: any, res: Response) => {
    try {
      const data = await integrationService.getById(req.params.id);
      if (!data) {
        res.status(404).json({ error: "Integration not found" });
        return; // Fixed: Standalone return
      }
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: "Error fetching integration" });
    }
  },

  // PUT /{id}
  update: async (req: any, res: Response) => {
    try {
      const data = await integrationService.updateById(req.params.id, req.body.credentials);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to update integration" });
    }
  },

  // DELETE /{id}
  delete: async (req: any, res: Response) => {
    try {
      await integrationService.deleteById(req.params.id);
      res.status(200).json({ message: "Integration deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete integration" });
    }
  }
};