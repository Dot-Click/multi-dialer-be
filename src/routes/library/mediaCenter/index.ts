import { Router } from "express";
import {
  createMediaCenter,
  getAllMediaCenterOfAllUsers,
  getAllMediaCenterOfSpecificUser,
  getMediaCenterById,
  updateMediaCenter,
  deleteMediaCenter
} from "./controller";
import { checkRole, protectRoute } from "../../../middlewares/auth.middleware";
import { singleUpload } from "../../../middlewares/multer.middleware";

const router = Router();

// Audio MIME types
const audioMimeTypes = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4", "audio/m4a"];

// Video MIME types
const videoMimeTypes = ["video/mp4", "video/mpeg", "video/quicktime", "video/x-msvideo", "video/webm"];

// All allowed MIME types (audio + video)
const allMediaMimeTypes = [...audioMimeTypes, ...videoMimeTypes];

// Create a media center item (with file upload)
// Using 20MB as max size (largest allowed) - validation happens in service based on mediaType
router.post("/create", singleUpload("file", allMediaMimeTypes, 20 * 1024 * 1024), createMediaCenter);

// Get all media center items of all users
router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllMediaCenterOfAllUsers);

// Get all media center items of specific user
router.get("/", getAllMediaCenterOfSpecificUser);

// Get a single media center item by ID
router.get("/:id", getMediaCenterById);

// Update a media center item by ID
router.put("/:id", updateMediaCenter);

// Delete a media center item by ID
router.delete("/:id", deleteMediaCenter);

export default router;

