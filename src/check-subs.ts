import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.pushSubscription.count();
  console.log('Total subscriptions:', count);
  const subs = await prisma.pushSubscription.findMany({ take: 5 });
  console.log('Sample subs:', JSON.stringify(subs, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
