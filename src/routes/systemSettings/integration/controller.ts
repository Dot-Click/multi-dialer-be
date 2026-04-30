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
        return;
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

  // GET /my
  getMy: async (req: any, res: Response) => {
    try {
      const systemSettingId = await integrationService.findSettingsId(req.user.id);
      if (!systemSettingId) {
        res.status(404).json({ error: "System settings not found" });
        return;
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
        return;
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
  },

  // POST /send-direct-mail — uses Stannp API
  sendDirectMail: async (req: any, res: Response) => {
    try {
      const userId = req.user.id;
      const role = req.user.role;
      const createdById = req.user.createdById;

      // For agents, use their admin's integration. For admins/owners, use their own.
      const targetUserId = role === "AGENT" && createdById ? createdById : userId;
      const systemSettingId = await integrationService.findSettingsId(targetUserId);

      if (!systemSettingId) {
        res.status(404).json({ error: "System settings not found. Please ask your admin to configure Stannp." });
        return;
      }

      const stannpIntegration = await integrationService.getProviderIntegration(systemSettingId, "STANPP_DOT_COM" as IntegrationProvider);
      if (!stannpIntegration) {
        res.status(404).json({ error: "Stannp integration not configured. Please connect Stannp from System Settings > Integrations." });
        return;
      }

      const credentials = stannpIntegration.credentials as any;
      const apiKey = credentials?.apiKey;
      if (!apiKey) {
        res.status(400).json({ error: "Stannp API key not found in integration settings." });
        return;
      }

      const { recipientName, address1, address2, city, postcode, country, message, template } = req.body;

      if (!recipientName || !address1 || !city || !postcode || !country) {
        res.status(400).json({ error: "Recipient name, address, city, postcode and country are required." });
        return;
      }

      // Build form-data for Stannp API
      const FormData = (await import("form-data")).default;
      const axios = (await import("axios")).default;

      const form = new FormData();
      form.append("test", "1"); // Change to "0" for live send
      form.append("recipient[firstname]", recipientName.split(" ")[0] || recipientName);
      form.append("recipient[lastname]", recipientName.split(" ").slice(1).join(" ") || "");
      form.append("recipient[address1]", address1);
      if (address2) form.append("recipient[address2]", address2);
      form.append("recipient[city]", city);
      form.append("recipient[postcode]", postcode);
      form.append("recipient[country]", country);
      form.append("message", message || "Hello from CallScout!");
      if (template) form.append("template", template);

      const stannpRes = await axios.post("https://dash.stannp.com/api/v1/letters/create", form, {
        auth: { username: apiKey, password: "" },
        headers: form.getHeaders(),
      });

      res.status(200).json({ success: true, data: stannpRes.data });
    } catch (error: any) {
      console.error("Stannp send error:", error?.response?.data || error);
      res.status(500).json({ error: error?.response?.data?.error || "Failed to send direct mail via Stannp" });
    }
  },
  
  // GET /bombbomb/videos — fetches videos from BombBomb API
  getBombBombVideos: async (req: any, res: Response) => {
    try {
      const userId = req.user.id;
      const role = req.user.role;
      const createdById = req.user.createdById;

      // Use admin's integration if agent
      const targetUserId = role === "AGENT" && createdById ? createdById : userId;
      const systemSettingId = await integrationService.findSettingsId(targetUserId);

      if (!systemSettingId) {
        res.status(404).json({ error: "System settings not found." });
        return;
      }

      const bombBombIntegration = await integrationService.getProviderIntegration(systemSettingId, "BOMB_BOMB" as IntegrationProvider);
      if (!bombBombIntegration) {
        res.status(404).json({ error: "BombBomb integration not configured. Please connect BombBomb from System Settings > Integrations." });
        return;
      }

      const credentials = bombBombIntegration.credentials as any;
      const apiKey = credentials?.apiKey || credentials?.accessToken;
      
      if (!apiKey) {
        res.status(400).json({ error: "BombBomb API key or Access Token not found." });
        return;
      }

      const axios = (await import("axios")).default;
      const bbRes: any = await axios.get("https://api.bombbomb.com/v2/videos", {
        params: {
          api_key: apiKey,
        },
      });

      console.log("BombBomb API Response:", bbRes.data);

      // Transform BombBomb data to a cleaner format for our UI
      // V2 API often wraps the array in a 'data' property
      const videoList = Array.isArray(bbRes.data.items) ? bbRes.data.items : (bbRes.data?.items || []);
      
      const videos = videoList.map((v: any) => ({
        id: v.id,
        name: v.name || v.title || "Untitled Video",
        thumbUrl: v.thumbUrl || v.thumbnail || v.thumbnailUrl || "",
        shortUrl: v.shortUrl || v.videoUrl || `https://bbemail.com/v/${v.id}`,
        createdAt: v.createdAt || v.created
      }));

      res.status(200).json({ success: true, data: videos });
    } catch (error: any) {
      console.error("BombBomb fetch error:", error?.response?.data || error);
      res.status(500).json({ error: error?.response?.data?.message || "Failed to fetch BombBomb videos" });
    }
  },
};