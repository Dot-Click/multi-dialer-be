import prisma from "../src/lib/prisma";

async function main() {
  const rows = await prisma.billing.findMany({
    select: { id: true, userId: true, stripeInvoiceId: true, amount: true, status: true, date: true, invoicePdfUrl: true },
  });
  console.log("Billing rows:", JSON.stringify(rows, null, 2));

  const subs = await prisma.userSubscription.findMany({
    select: { userId: true, stripeCustomerId: true, plan: true, status: true, amount: true },
  });
  console.log("Subscriptions:", JSON.stringify(subs, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
