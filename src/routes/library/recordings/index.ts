import { Router } from "express";
import {
  createRecording,
  getAllRecordingsOfAllUsers,
  getAllRecordingsOfSpecificUser,
  getRecordingById,
  updateRecording,
  deleteRecording,
} from "./controller";
import { checkRole, protectRoute } from "../../../middlewares/auth.middleware";
import { singleUpload } from "../../../middlewares/multer.middleware";

const router = Router();

// only audio files are allowed for recordings
const audioMimeTypes = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
];

// create requires file + optional slot and name
router.post(
  "/create",
  singleUpload("file", audioMimeTypes, 20 * 1024 * 1024),
  createRecording
);

// admin/owner can view all recordings
router.get("/all", checkRole(["ADMIN", "OWNER"]), getAllRecordingsOfAllUsers);

// get recordings belonging to the authenticated user
router.get("/", getAllRecordingsOfSpecificUser);

// single recording by id (must belong to user)
router.get("/:id", getRecordingById);

// update recording (optionally with new file)
router.put(
  "/:id",
  singleUpload("file", audioMimeTypes, 20 * 1024 * 1024),
  updateRecording
);

// delete recording
router.delete("/:id", deleteRecording);

export default router;
