import prisma from "../../../lib/prisma";
import juice from "juice";

export const upsertSignature = async (userId: string, content: string) => {
  const inlinedContent = juice(content); // inline styles for email clients

  return prisma.signature.upsert({
    where: { userId },
    update: { content: inlinedContent },
    create: { userId, content: inlinedContent },
  });
};

export const getSignature = async (userId: string) => {
  return prisma.signature.findUnique({
    where: { userId },
  });
};