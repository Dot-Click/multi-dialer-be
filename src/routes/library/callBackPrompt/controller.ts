// import { Request, Response } from "express";
// import prisma from "../../../lib/prisma";
// import { successResponse, errorResponse } from "../../../utils/handler";
// import { insertCallbackPromptInDb } from "./service";
// import { validateData } from "../../../middlewares/vald.middleware";
// import { updateCallbackPromptSchema } from "../../../schemas/callbackPrompt.schema";

// export const getAllCallbackPromptsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { id: userId } = req.user!;
    
//     // Get user's library
//     const library = await prisma.library.findFirst({
//       where: { userId },
//     });

//     if (!library) {
//       errorResponse(res, "Library not found for user", 404);
//       return;
//     }

//     // Get all callback prompts from user's library
//     const callbackPrompts = await prisma.callbackPrompt.findMany({
//       where: {
//         libraryId: library.id,
//       },
//       include: {
//         library: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//                 fullName: true,
//                 email: true,
//               },
//             },
//           },
//         },
//       },
//       orderBy: {
//         createdAt: "desc",
//       },
//     });
//     successResponse(res, 200, "Callback prompts fetched", callbackPrompts);
//   } catch (error: any) {
//     errorResponse(res, error.message || "Internal server error", 500);
//   }
// };

// export const getAllCallbackPromptsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
//   try {
//     // Get all callback prompts from all users
//     const callbackPrompts = await prisma.callbackPrompt.findMany({
//       include: {
//         library: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//                 fullName: true,
//                 email: true,
//               },
//             },
//           },
//         },
//       },
//       orderBy: {
//         createdAt: "desc",
//       },
//     });
//     successResponse(res, 200, "All callback prompts fetched", callbackPrompts);
//   } catch (error: any) {
//     errorResponse(res, error.message || "Internal server error", 500);
//   }
// };

// export const getCallbackPromptById = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const { id: userId } = req.user!;

//     // Get user's library
//     const library = await prisma.library.findFirst({
//       where: { userId },
//     });

//     if (!library) {
//       errorResponse(res, "Library not found for user", 404);
//       return;
//     }

//     const callbackPrompt = await prisma.callbackPrompt.findFirst({
//       where: { 
//         id,
//         libraryId: library.id, // Ensure it belongs to user's library
//       },
//       include: {
//         library: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//                 fullName: true,
//                 email: true,
//               },
//             },
//           },
//         },
//       },
//     });
    
//     if (!callbackPrompt) {
//       errorResponse(res, "Callback prompt not found", 404);
//       return;
//     }
//     successResponse(res, 200, "Callback prompt fetched", callbackPrompt);
//   } catch (error: any) {
//     errorResponse(res, error.message || "Internal server error", 500);
//   }
// };

// export const createCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { id: userId } = req.user!;
      
//     const payload = { ...req.body };
    
//     // Call service. 
//     // This service now handles: 
//     // 1. User existence check
//     // 2. AGENT role check (throws 403)
//     // 3. Validation (throws 400)
//     // 4. Creation
//     const newCallbackPrompt = await insertCallbackPromptInDb(payload, userId);

//     // Include populated library and user info in response
//     const populatedCallbackPrompt = await prisma.callbackPrompt.findUnique({
//       where: { id: newCallbackPrompt.id },
//       include: {
//         library: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//                 fullName: true,
//                 email: true,
//               },
//             },
//           },
//         },
//       },
//     });
    
//     successResponse(res, 201, "Callback prompt created", populatedCallbackPrompt);
    
//   } catch (error: any) {
//     // FIX: Use the status code provided by the service (403, 409, 400), 
//     // otherwise default to 500.
//     const statusCode = error.status || 500;
//     const message = error.message || "Internal server error";

//     // If there are Zod validation errors, you might want to return them differently
//     if (error.errors) {
//        // Assuming errorResponse handles just message/code. 
//        // You might want to console log the specific validation errors or send them in the response.
//        console.log("Validation Errors:", error.errors);
//        errorResponse(res, "Validation Error", statusCode);
//        return;
//     }

//     errorResponse(res, message, statusCode);
//   }
// };

// export const updateCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const { id: userId } = req.user!;

//     // Check if callback prompt exists
//     const callbackPrompt = await prisma.callbackPrompt.findUnique({
//       where: { id },
//       include: {
//         library: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//               },
//             },
//           },
//         },
//       },
//     });

//     // If it doesn't exist, return error
//     if (!callbackPrompt) {
//       errorResponse(res, "Callback prompt not found", 404);
//       return;
//     }

//     // Get user's library
//     const library = await prisma.library.findFirst({
//       where: { userId },
//     });

//     if (!library) {
//       errorResponse(res, "Library not found for user", 404);
//       return;
//     }

//     // Check ownership
//     if (callbackPrompt.libraryId !== library.id) {
//       errorResponse(res, "You cannot update another user's callback prompt", 403);
//       return;
//     }

//     // Validate payload with Zod
//     const payload = { ...req.body };
//     const result = await validateData(updateCallbackPromptSchema, payload) as any;

//     if (!('data' in result)) {
//       errorResponse(res, "Validation error", 400);
//       return;
//     }

//     const data = result.data;

//     // Update the callback prompt
//     const updatedCallbackPrompt = await prisma.callbackPrompt.update({
//       where: { id },
//       data: {
//         ...data,
//       },
//       include: {
//         library: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//                 fullName: true,
//                 email: true,
//               },
//             },
//           },
//         },
//       },
//     });

//     successResponse(res, 200, "Callback prompt updated", updatedCallbackPrompt);
    
//   } catch (error: any) {
//     // Handle unique constraint error
//     if (error.code === 'P2002' && error.meta?.target?.includes('promptName')) {
//       errorResponse(res, "Callback prompt name already exists for this library", 409);
//       return;
//     }
//     // Check if it's a Prisma error related to record not found
//     if (error.code === 'P2025') {
//       errorResponse(res, "Callback prompt not found", 404);
//       return;
//     }
//     errorResponse(res, error.message || "Internal server error", 500);
//   }
// };

// export const deleteCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const { id: userId } = req.user!;

//     // Check if callback prompt exists
//     const callbackPrompt = await prisma.callbackPrompt.findUnique({
//       where: { id },
//       include: {
//         library: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//               },
//             },
//           },
//         },
//       },
//     });

//     // If it doesn't exist, return error
//     if (!callbackPrompt) {
//       errorResponse(res, "Callback prompt not found", 404);
//       return;
//     }

//     // Get user's library
//     const library = await prisma.library.findFirst({
//       where: { userId },
//     });

//     if (!library) {
//       errorResponse(res, "Library not found for user", 404);
//       return;
//     }

//     // Check ownership
//     if (callbackPrompt.libraryId !== library.id) {
//       errorResponse(res, "You cannot delete another user's callback prompt", 403);
//       return;
//     }

//     // Delete the callback prompt
//     await prisma.callbackPrompt.delete({
//       where: { id },
//     });

//     successResponse(res, 200, "Callback prompt deleted successfully", null);
    
//   } catch (error: any) {
//     // Check if it's a Prisma error related to record not found
//     if (error.code === 'P2025') {
//       errorResponse(res, "Callback prompt not found", 404);
//       return;
//     }
//     errorResponse(res, error.message || "Internal server error", 500);
//   }
// };








import { Request, Response } from "express";
import prisma from "../../../lib/prisma";
import { successResponse, errorResponse } from "../../../utils/handler";
import { insertCallbackPromptInDb } from "./service";
import { validateData } from "../../../middlewares/vald.middleware";
import { updateCallbackPromptSchema } from "../../../schemas/callbackPrompt.schema";

// 1. Get All Prompts for the Logged-in Admin
export const getAllCallbackPromptsOfSpecificUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    
    // Get user's library
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      errorResponse(res, "Library not found. Contact support.", 404);
      return;
    }

    // Get all callback prompts linked to this library
    const callbackPrompts = await prisma.callbackPrompt.findMany({
      where: {
        libraryId: library.id,
      },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    successResponse(res, 200, "Callback prompts fetched successfully", callbackPrompts);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 2. Get All Prompts System-Wide (Super Admin View)
export const getAllCallbackPromptsOfAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const callbackPrompts = await prisma.callbackPrompt.findMany({
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    successResponse(res, 200, "All system callback prompts fetched", callbackPrompts);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 3. Get Single Prompt by ID
export const getCallbackPromptById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // Find User's Library first
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      errorResponse(res, "Library not found", 404);
      return;
    }

    const callbackPrompt = await prisma.callbackPrompt.findFirst({
      where: { 
        id,
        libraryId: library.id, // Security: Ensure it belongs to this Admin's library
      },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });
    
    if (!callbackPrompt) {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }
    successResponse(res, 200, "Callback prompt fetched", callbackPrompt);
  } catch (error: any) {
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 4. Create Callback Prompt
export const createCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: userId } = req.user!;
    const payload = { ...req.body };
    
    // Calls the Service (Role check + Library check inside)
    const newCallbackPrompt = await insertCallbackPromptInDb(payload, userId);

    // Return populated response
    const populatedCallbackPrompt = await prisma.callbackPrompt.findUnique({
      where: { id: newCallbackPrompt.id },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });
    
    successResponse(res, 201, "Callback prompt created successfully", populatedCallbackPrompt);
    
  } catch (error: any) {
    const statusCode = error.status || 500;
    const message = error.message || "Internal server error";

    // Handle Zod validation errors
    if (error.errors) {
       console.error("Validation Errors:", error.errors);
       errorResponse(res, "Validation Error", statusCode);
       return;
    }

    errorResponse(res, message, statusCode);
  }
};

// 5. Update Callback Prompt
export const updateCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // 1. Get User's Library
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      errorResponse(res, "Library not found for user", 404);
      return;
    }

    // 2. Find Prompt & Check Ownership
    const callbackPrompt = await prisma.callbackPrompt.findUnique({
      where: { id },
    });

    if (!callbackPrompt) {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }

    if (callbackPrompt.libraryId !== library.id) {
      errorResponse(res, "Access Denied: You cannot update a prompt you do not own.", 403);
      return;
    }

    // 3. Validate Data
    const payload = { ...req.body };
    const result = await validateData(updateCallbackPromptSchema, payload) as any;

    if (!('data' in result)) {
      errorResponse(res, "Validation error", 400);
      return;
    }

    const data = result.data;

    // 4. Update
    const updatedCallbackPrompt = await prisma.callbackPrompt.update({
      where: { id },
      data: { ...data },
      include: {
        library: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    successResponse(res, 200, "Callback prompt updated successfully", updatedCallbackPrompt);
    
  } catch (error: any) {
    if (error.code === 'P2002') {
      errorResponse(res, "Callback prompt name already exists for this library", 409);
      return;
    }
    if (error.code === 'P2025') {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};

// 6. Delete Callback Prompt
export const deleteCallbackPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user!;

    // 1. Get User's Library
    const library = await prisma.library.findFirst({
      where: { userId },
    });

    if (!library) {
      errorResponse(res, "Library not found", 404);
      return;
    }

    // 2. Find Prompt & Check Ownership
    const callbackPrompt = await prisma.callbackPrompt.findUnique({
      where: { id },
    });

    if (!callbackPrompt) {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }

    if (callbackPrompt.libraryId !== library.id) {
      errorResponse(res, "Access Denied: You cannot delete a prompt you do not own.", 403);
      return;
    }

    // 3. Delete
    await prisma.callbackPrompt.delete({
      where: { id },
    });

    successResponse(res, 200, "Callback prompt deleted successfully", null);
    
  } catch (error: any) {
    if (error.code === 'P2025') {
      errorResponse(res, "Callback prompt not found", 404);
      return;
    }
    errorResponse(res, error.message || "Internal server error", 500);
  }
};