import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting TwiML App SID Cleanup ---');
  
  const integrations = await prisma.integration.findMany({
    where: {
      provider: 'TWILIO'
    }
  });

  console.log(`Found ${integrations.length} Twilio integrations.`);

  for (const integration of integrations) {
    const creds = integration.credentials as any;
    if (creds && creds.twimlAppSid) {
      console.log(`Clearing twimlAppSid for integration ID: ${integration.id} (SID was: ${creds.twimlAppSid})`);
      
      const { twimlAppSid, ...remainingCreds } = creds;
      
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          credentials: remainingCreds
        }
      });
    }
  }

  console.log('--- Cleanup complete ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
