import { Router } from "express";
import {
  createEmailTemplate,
  getAllEmailTemplatesOfAllUsers,
  getAllEmailTemplatesOfSpecificUser,
  getEmailTemplateById,
  updateEmailTemplate,
  deleteEmailTemplate
} from "./controller";
import { checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

// Create an email template
router.post("/create", createEmailTemplate);

// Get all email templates of all users
router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllEmailTemplatesOfAllUsers);

// Get all email templates of specific user
router.get("/", getAllEmailTemplatesOfSpecificUser);

// Get a single email template by ID
router.get("/:id", getEmailTemplateById);

// Update an email template by ID
router.put("/:id", updateEmailTemplate);

// Delete an email template by ID
router.delete("/:id", deleteEmailTemplate);

export default router;
