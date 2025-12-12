import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient;
}

const prisma = new PrismaClient({log:["error", "warn"]});

// Middleware to auto-create library and systemSettings when user is created
prisma.$use(async (params, next) => {
  const result = await next(params);
  
  // After user creation, automatically create library and systemSettings
  if (params.model === 'User' && params.action === 'create' && result) {
    console.log("🔍 Prisma Middleware: User created, checking for library and systemSettings...", result.id);
    try {
      // Small delay to ensure user is fully committed to database
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create Library
      const existingLibrary = await prisma.library.findFirst({
        where: { userId: result.id },
      });

      if (!existingLibrary) {
        const newLibrary = await prisma.library.create({
          data: {
            userId: result.id,
          },
        });
        console.log("✅ Auto Library Created For User:", result.id, "Library ID:", newLibrary.id);
      } else {
        console.log("ℹ️ Library already exists for User:", result.id);
      }

      // Create SystemSettings
      const existingSystemSettings = await prisma.system_Setting.findFirst({
        where: { userId: result.id },
      });

      if (!existingSystemSettings) {
        const newSystemSettings = await prisma.system_Setting.create({
          data: {
            userId: result.id,
          },
        });
        console.log("✅ Auto SystemSettings Created For User:", result.id, "SystemSettings ID:", newSystemSettings.id);
      } else {
        console.log("ℹ️ SystemSettings already exists for User:", result.id);
      }
    } catch (err: any) {
      console.error("❌ Library/SystemSettings Create Error in Middleware:", err?.message || err);
      console.error("Error details:", err);
      // Don't throw - library/systemSettings creation failure shouldn't break user signup
    }
  }
  
  return result;
});

global.prisma = prisma;

export const connectDB = async (retries = 3, delay = 2000) => {
    console.log("Connecting to database...");
    let attempts = 0;
  
    while (attempts < retries) {
      try {
        await prisma.$connect();
        console.log("✅ Connected to the database");
        return;
      } catch (err) {
        attempts++;
        console.error(`❌ Database connection failed (attempt ${attempts}/${retries}):`, err);
  
        if (attempts >= retries) {
          console.error("🚨 Max retries reached. Exiting process.");
          process.exit(1);
        }
  
        console.log(`⏳ Retrying in ${delay / 1000}s...`);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
};
export const disconnectDB = async () => {
    try {
        await prisma.$disconnect();
        console.log("Disconnected from the database 🔴");
    } catch (error) {
        console.error("Error disconnecting from the database:", error);
    }
}

export default prisma;
