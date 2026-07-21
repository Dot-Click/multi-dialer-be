import prisma from "../src/lib/prisma";

const SERVICES = [
  { name: "Expired Data", price: 5000, description: "Great for listing motivated sellers." },
  { name: "Neighborhood Search", price: 4900, description: "Great for circle prospecting." },
  { name: "FSBO", price: 3600, description: "Great for listing motivated sellers." },
  { name: "FRBO", price: 2500, description: "Great for finding tired landlords." },
  { name: "Skip Tracer", price: 3200, description: "Great for appending your address files." },
];

async function main() {
  for (const service of SERVICES) {
    const existing = await prisma.leadStoreService.findFirst({ where: { name: service.name } });
    if (existing) {
      await prisma.leadStoreService.update({ where: { id: existing.id }, data: service });
      console.log(`Updated: ${service.name}`);
    } else {
      await prisma.leadStoreService.create({ data: service });
      console.log(`Created: ${service.name}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
