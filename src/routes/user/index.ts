import { Router } from "express";
import { getAllUsers, createUser, updateUser, deleteUser, deleteAllUsers, uploadProfileImage } from "./controller";
import { singleUpload } from "../../middlewares/multer.middleware";

const router = Router();

router.post("/create", createUser);
router.post("/profile-image", singleUpload("image", ["image/jpeg", "image/png", "image/jpg"]), uploadProfileImage);
router.get("/", getAllUsers);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);
router.delete("/", deleteAllUsers);

export default router;
