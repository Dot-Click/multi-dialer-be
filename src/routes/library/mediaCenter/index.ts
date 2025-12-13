import { Router } from "express";
import { 
  createMediaCenter, 
  getAllMediaCenterOfAllUsers, 
  getAllMediaCenterOfSpecificUser, 
  getMediaCenterById, 
  updateMediaCenter, 
  deleteMediaCenter 
} from "./controller";
import { protectRoute } from "../../../middlewares/auth.middleware";
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
router.post("/create", protectRoute, singleUpload("file", allMediaMimeTypes, 20 * 1024 * 1024), createMediaCenter);

// Get all media center items of all users
router.get("/all", protectRoute, getAllMediaCenterOfAllUsers);

// Get all media center items of specific user
router.get("/", protectRoute, getAllMediaCenterOfSpecificUser);

// Get a single media center item by ID
router.get("/:id", protectRoute, getMediaCenterById);

// Update a media center item by ID
router.put("/:id", protectRoute, updateMediaCenter);

// Delete a media center item by ID
router.delete("/:id", protectRoute, deleteMediaCenter);

export default router;

