import { PrismaClient } from '@prisma/client';
import twilio from 'twilio';

if (process.env.NODE_ENV === "production") {
  console.error("❌ Script not allowed in production");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Twilio API Key Migration ---');
  
  const integrations = await prisma.integration.findMany({
    where: {
      provider: 'TWILIO'
    }
  });

  console.log(`Found ${integrations.length} Twilio integrations total.`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const integration of integrations) {
    const creds = integration.credentials as any;
    
    // Check if it's a sub-account (has accountSid) and missing apiKeySid
    if (creds && creds.accountSid && creds.authToken && !creds.apiKeySid) {
      console.log(`Migrating integration ID: ${integration.id} (Account: ${creds.accountSid})`);
      
      try {
        const subClient = twilio(creds.accountSid, creds.authToken);
        
        console.log(`[Twilio] Creating API Key for ${creds.accountSid}...`);
        const newKey = await subClient.newKeys.create({ friendlyName: 'MultiDialer Key' });
        
        await prisma.integration.update({
          where: { id: integration.id },
          data: {
            credentials: {
              ...creds,
              apiKeySid: newKey.sid,
              apiKeySecret: newKey.secret
            }
          }
        });
        
        console.log(`[Success] API Key created: ${newKey.sid}`);
        updatedCount++;
      } catch (err: any) {
        console.error(`[Error] Failed to migrate integration ${integration.id}:`, err.message);
      }
    } else {
      skippedCount++;
    }
  }

  console.log(`--- Migration complete ---`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped: ${skippedCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
