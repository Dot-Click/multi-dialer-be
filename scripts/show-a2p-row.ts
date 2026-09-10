import prisma from "../src/lib/prisma";

async function main() {
  const [, , userArg] = process.argv;
  if (!userArg) { console.error("Usage: npx tsx scripts/show-a2p-row.ts <userIdOrEmail>"); process.exit(1); }
  const user = await prisma.user.findFirst({
    where: userArg.includes("@") ? { email: userArg } : { id: userArg },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`No user matching "${userArg}".`);
  const a2p = await prisma.a2P_Registration.findUnique({
    where: { userId: user.id },
    select: { status: true, rejectionReason: true, customerProfileSid: true, brandSid: true, customerProfileApproved: true },
  });
  console.log({ user, a2p });
}
main().catch(console.error).finally(() => prisma.$disconnect());
