// import prisma from "../../../lib/prisma";
// import { validateData } from "../../../middlewares/vald.middleware";

// import { createCallbackPromptSchema } from "../../../schemas/callbackPrompt.schema";

// export async function insertCallbackPromptInDb(payload: any, userId: string) {
//   try {
    
//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       select: { role: true },
//     });

//     if (!user) {
//       throw { status: 404, message: "User not found." };
//     }

    
//     if (user.role === 'AGENT') {
//       throw { status: 401, message: "Unauthorized: Agents cannot create callback prompts." };
//     }

//     const result = await validateData(createCallbackPromptSchema, payload) as any;

//     if (!('data' in result)) {
//       throw { status: 400, errors: result };
//     }

//     const data = result.data;

  
    
//     let library = await prisma.library.findFirst({
//       where: { userId },
//     });

//     if (!library) {
//       library = await prisma.library.create({
//         data: {
//           userId,
//         },
//       });
//     }

  
    
//     const callbackPrompt = await prisma.callbackPrompt.create({
//       data: {
//         ...data,
//         libraryId: library.id,
//       },
//     });

//     return callbackPrompt;

//   } catch (error: any) {
    

//     if (error.code === 'P2002') {
//       const target = error.meta?.target;
      
    
//       if (Array.isArray(target) && target.includes('templateName')) {
//         throw { status: 409, message: "Callback prompt name (templateName) already exists for this library" };
//       }
  
      
//       if (JSON.stringify(target).includes('templateName') || JSON.stringify(target).includes('promptName')) {
//          throw { status: 409, message: "Callback prompt name already exists for this library" };
//       }
//     }
    
    
//     throw error;
//   }
// }




import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import { createCallbackPromptSchema } from "../../../schemas/callbackPrompt.schema";

export async function insertCallbackPromptInDb(payload: any, userId: string) {
  try {
    // 1. Get User Details
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      throw { status: 404, message: "User not found." };
    }

    // 2. Strict Role Check: ONLY Admin or Super Owner
    // Agents are not allowed to create Callback Prompts
    const allowedRoles = ["ADMIN", "OWNER"];
    if (!allowedRoles.includes(user.role)) {
      throw { status: 403, message: "Access Denied: Only Admins can create Callback Prompts." };
    }

    // 3. Validate Payload
    const result = await validateData(createCallbackPromptSchema, payload) as any;

    if (!('data' in result)) {
      throw { status: 400, errors: result };
    }

    const data = result.data;

    // 4. Get User's EXISTING Library
    // SCALABILITY RULE: We never create a library here. It creates at Signup.
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      throw { 
        status: 404, 
        message: "Critical Error: Library not found. Please contact support (Library should generate at signup)." 
      };
    }

    // 5. Create Callback Prompt linked to existing Library
    const callbackPrompt = await prisma.callbackPrompt.create({
      data: {
        ...data,
        libraryId: library.id,
      },
    });

    return callbackPrompt;

  } catch (error: any) {
    // Handle Unique Constraint (e.g., promptName unique per library)
    if (error.code === 'P2002') {
      const target = error.meta?.target;
      
      if (Array.isArray(target) && (target.includes('templateName') || target.includes('promptName'))) {
        throw { status: 409, message: "Callback prompt name already exists for this library" };
      }
      
      // Fallback for string target
      if (JSON.stringify(target).includes('templateName') || JSON.stringify(target).includes('promptName')) {
         throw { status: 409, message: "Callback prompt name already exists for this library" };
      }
    }
    
    throw error;
  }
}