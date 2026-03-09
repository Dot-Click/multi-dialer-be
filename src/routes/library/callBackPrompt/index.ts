// import { Router } from "express";
// import {
//   createCallbackPrompt,
//   getAllCallbackPromptsOfAllUsers,
//   getAllCallbackPromptsOfSpecificUser,
//   getCallbackPromptById,
//   updateCallbackPrompt,
//   deleteCallbackPrompt
// } from "./controller";
// import { checkRole } from "../../../middlewares/auth.middleware";

// const router = Router();


// router.post("/create", createCallbackPrompt);


// router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllCallbackPromptsOfAllUsers);


// router.get("/", getAllCallbackPromptsOfSpecificUser);


// router.get("/:id", getCallbackPromptById);


// router.put("/:id", updateCallbackPrompt);



// router.delete("/:id", deleteCallbackPrompt);

// export default router;



import { Router } from "express";
import {
  createCallbackPrompt,
  getAllCallbackPromptsOfAllUsers,
  getAllCallbackPromptsOfSpecificUser,
  getCallbackPromptById,
  updateCallbackPrompt,
  deleteCallbackPrompt
} from "./controller";
import { checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

// =================================================================
// STRICT ROLE POLICY: ONLY ADMIN & OWNER
// Agents have NO access to Callback Prompts (as per Figma)
// =================================================================

// Create
router.post(
  "/create", 
  checkRole(["ADMIN", "OWNER"]), 
  createCallbackPrompt
);

// Get All (Global View)
router.get(
  "/all", 
  checkRole(["ADMIN", "OWNER"]), 
  getAllCallbackPromptsOfAllUsers
);

// Get My Prompts (Logged in Admin's Library)
router.get(
  "/", 
  checkRole(["ADMIN", "OWNER"]), 
  getAllCallbackPromptsOfSpecificUser
);

// Get Single by ID
router.get(
  "/:id", 
  checkRole(["ADMIN", "OWNER"]), 
  getCallbackPromptById
);

// Update
router.put(
  "/:id", 
  checkRole(["ADMIN", "OWNER"]), 
  updateCallbackPrompt
);

// Delete
router.delete(
  "/:id", 
  checkRole(["ADMIN", "OWNER"]), 
  deleteCallbackPrompt
);

export default router;