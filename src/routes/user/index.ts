import { Router } from "express";
import { getAllUsers, createUser, updateUser, setUserPassword, deleteUser, deleteAllUsers, uploadProfileImage, updateUserSubscription } from "./controller";
import { singleUpload } from "../../middlewares/multer.middleware";

const router = Router();

router.post("/", createUser);
router.post("/profile-image", singleUpload("image", ["image/jpeg", "image/png", "image/jpg"]), uploadProfileImage);
router.get("/", getAllUsers);
router.put("/:id", updateUser);
router.put("/:id/password", setUserPassword);
router.post("/:id/subscription", updateUserSubscription);
router.delete("/:id", deleteUser);
router.delete("/", deleteAllUsers);

export default router;
