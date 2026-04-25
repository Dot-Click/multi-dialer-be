import { Request, Response } from "express";
import prisma from "../../lib/prisma";
import { successResponse, errorResponse } from "../../utils/handler";
import { createContactInDb, createContactFolderInDb } from "../contact/service";
import { createInternalNotification } from "../notification/controller";

/**
 * Webhook for MyPlusLeads to push data into the platform.
 * Expected format is a JSON object with lead details.
 * 
 * URL Format: /api/webhooks/myplusleads/:userId?apiKey=USER_API_KEY
 */
export const handleMyPlusLeadsWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { apiKey } = req.query;

    if (!userId || !apiKey) {
      errorResponse(res, "Unauthorized: Missing userId or apiKey", 401);
      return;
    }

    // 1. Verify User and API Key
    const config = await prisma.myPlusLeadsConfig.findUnique({
      where: { userId },
      include: { user: true }
    });

    if (!config || config.apiKey !== apiKey) {
      errorResponse(res, "Unauthorized: Invalid userId or apiKey", 401);
      return;
    }

    const payload = req.body;
    console.log(`[MyPlusLeads Webhook] Received lead for user ${userId}:`, JSON.stringify(payload, null, 2));

    // 2. Map MyPlusLeads data to our internal format
    // Common fields in MyPlusLeads: FirstName, LastName, Phone1, Email, PropertyAddress, PropertyCity, PropertyState, PropertyZip, LeadType
    const leadType = payload.LeadType || "General";
    const fullName = `${payload.FirstName || ""} ${payload.LastName || ""}`.trim() || "Unknown Lead";
    
    // 3. Ensure Folder exists (e.g., "MyPlusLeads - Expired")
    const folderName = `MyPlusLeads - ${leadType}`;
    let folder = await prisma.contactFolder.findFirst({
        where: { userId, name: folderName }
    });

    if (!folder) {
        folder = await createContactFolderInDb({
            name: folderName,
            listIds: [],
            contactIds: []
        }, userId);
    }

    // 4. Create the Contact
    const contactPayload = {
      fullName,
      address: payload.PropertyAddress || "",
      city: payload.PropertyCity || "",
      state: payload.PropertyState || "",
      zip: payload.PropertyZip || "",
      mailingAddress: payload.MailingAddress || payload.PropertyAddress || "",
      mailingCity: payload.MailingCity || payload.PropertyCity || "",
      mailingState: payload.MailingState || payload.PropertyState || "",
      mailingZip: payload.MailingZip || payload.PropertyZip || "",
      source: "MyPlusLeads",
      tags: ["MyPlusLeads", leadType],
      notes: [`Imported from MyPlusLeads on ${new Date().toLocaleString()}`, `Lead Type: ${leadType}`],
      dataDialerId: "", // Not applicable here
      emails: payload.Email ? [{ email: payload.Email, isPrimary: true }] : [],
      phones: payload.Phone1 ? [{ number: payload.Phone1, type: "MOBILE" }] : [],
      userId,
      folderIds: [folder.id]
    };

    // Use a wrapper or direct prisma call since createContactInDb might not handle folderIds directly in its current signature
    // Actually, looking at service.ts, it doesn't take folderIds. I'll need to add it manually or update it.
    const contact = await createContactInDb(contactPayload as any);

    // Link contact to folder
    await prisma.contactFolder.update({
        where: { id: folder.id },
        data: { contactIds: { push: contact.id } }
    });

    // Also update the contact with the folderId
    await prisma.contact.update({
        where: { id: contact.id },
        data: { folderIds: { push: folder.id } }
    });

    // 5. Trigger Notification
    await createInternalNotification(
        userId, 
        "🔥 New Lead Imported", 
        `New ${leadType} lead "${fullName}" was automatically added to your MyPlusLeads folder.`,
        "success"
    );

    // 6. Update last sync time
    await prisma.myPlusLeadsConfig.update({
        where: { userId },
        data: { lastSyncAt: new Date(), status: "CONNECTED" }
    });

    successResponse(res, 200, "Lead processed successfully", { contactId: contact.id });
  } catch (error: any) {
    console.error("[MyPlusLeads Webhook] Error:", error);
    errorResponse(res, error.message || "Internal server error", 500);
  }
};
