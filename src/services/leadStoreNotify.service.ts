import prisma from "../lib/prisma";
import { createInternalNotification } from "../routes/notification/controller";
import { sendEmail, getBaseEmailTemplate } from "./email.service";

/**
 * Notifies every platform "Client" (users with role OWNER) about a Lead Store
 * event, both in-app and via email. There is exactly one such user today, but
 * this fans out to all of them so it stays correct if that ever changes.
 */
export async function notifyClients(title: string, description: string, type: string = "lead_store") {
  const owners = await prisma.user.findMany({
    where: { role: "OWNER" },
    select: { id: true, email: true },
  });

  await Promise.all(
    owners.map(async (owner) => {
      await createInternalNotification(owner.id, title, description, type).catch((err) =>
        console.error(`[LeadStore] Failed to create in-app notification for owner ${owner.id}:`, err),
      );

      if (owner.email) {
        await sendEmail({
          to: owner.email,
          from: "system@multidialer.com",
          subject: title,
          text: description,
          html: getBaseEmailTemplate(title, `<p>${description}</p>`),
        }).catch((err) => console.error(`[LeadStore] Failed to email owner ${owner.email}:`, err));
      }
    }),
  );
}
