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


router.post("/create", createCallbackPrompt);


router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllCallbackPromptsOfAllUsers);


router.get("/", getAllCallbackPromptsOfSpecificUser);


router.get("/:id", getCallbackPromptById);


router.put("/:id", updateCallbackPrompt);



router.delete("/:id", deleteCallbackPrompt);

export default router;