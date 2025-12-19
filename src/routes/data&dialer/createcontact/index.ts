import { Router } from "express";
import {
  createContact,
  getAllContactsOfAllUsers,
  getAllContactsOfSpecificUser,
  getContactById,
  updateContact,
  deleteContact
} from "./controller";
import { checkRole } from "../../../middlewares/auth.middleware";

const router = Router();

// Create
router.post("/create", createContact);

// Get All (Admin/Owner only)
router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllContactsOfAllUsers);

// Get User Specific
router.get("/", getAllContactsOfSpecificUser);

// Get ID Based
router.get("/:id", getContactById);

// Update (Full and Partial)
router.put("/:id", updateContact);
router.patch("/:id", updateContact);

// Delete
router.delete("/:id", deleteContact);

export default router;



  