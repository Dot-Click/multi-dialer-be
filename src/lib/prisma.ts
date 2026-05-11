import { PrismaClient } from "@prisma/client";
import {envConfig} from "./config";

// 1. Define the Singleton Factory
const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: ["error", "warn"],
  });

  // ---------------------------------------------------------
  // 2. Attach Middleware (Only runs once when client is created)
  // ---------------------------------------------------------
  client.$use(async (params, next) => {
    // Before user creation, ensure role and status are valid enum values
    if (params.model === 'User' && params.action === 'create' && params.args?.data) {
      const data = params.args.data;
      
      // Map 'name' to 'fullName' if BetterAuth sends 'name' field
      if (data.name && !data.fullName) {
        data.fullName = data.name;
        delete data.name;
      }
      
      // Ensure role is a valid enum value
      if (data.role !== undefined && !["AGENT", "ADMIN", "OWNER"].includes(data.role)) {
        console.warn(`⚠️ Invalid role value: ${data.role}, setting to AGENT`);
        data.role = "AGENT";
      } else if (data.role === undefined || data.role === null || data.role === "") {
        delete data.role;
      }

      // Ensure status is a valid enum value
      if (data.status !== undefined && !["ACTIVE", "DEACTIVATED", "SUSPENDED", "PENDING"].includes(data.status)) {
        console.warn(`⚠️ Invalid status value: ${data.status}, setting to ACTIVE`);
        data.status = "ACTIVE";
      } else if (data.status === undefined || data.status === null || data.status === "") {
        delete data.status;
      }
    }
    
    // Execute the query
    const result = await next(params);
    
    return result;
  });

  return client;
};

// 3. Global Definition to prevent multiple instances
declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

// 4. Create or Reuse the instance
const prisma = globalThis.prisma ?? prismaClientSingleton();

export default prisma;

// 5. Save instance to global in dev mode
if (envConfig.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

// 6. Connection Helpers (Optional, but updated to use the singleton)
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
        console.error("Error disconnecting:", error);
    }
}