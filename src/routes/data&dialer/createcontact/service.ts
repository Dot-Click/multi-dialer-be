import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
// FIX HERE: Changed CreateContactZodSchema to createContactSchema
import { createContactSchema } from "../../../zod/createcontact.schema"; 

export async function insertContactInDb(payload: any, userId: string) {
 
  // 1. Check if the client provided a Dialer ID. 
  // If NOT, we find the first Dialer owned by this user automatically.
  let targetDialerId = payload.dataDialerId;

  if (!targetDialerId) {
    const existingDialer = await prisma.dataDialer.findFirst({
      where: { userId }
    });

    if (!existingDialer) {
      // If they have NO dialer at all, create one for them automatically
      const newDialer = await prisma.dataDialer.create({
        data: { userId }
      });
      targetDialerId = newDialer.id;
    } else {
      targetDialerId = existingDialer.id;
    }
  }

  // 2. Now save the contact using the ID we found/created
  return await prisma.createContact.create({
    data: {
      ...payload,
      dataDialerId: targetDialerId, // This is now "Auto"
      userId
    },
  });
  
}