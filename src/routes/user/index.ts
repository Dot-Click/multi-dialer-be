import { Router } from "express";
import { getAllUsers, createUser, updateUser, setUserPassword, deleteUser, deleteAllUsers, uploadProfileImage, updateUserSubscription, endUserTrial } from "./controller";
import { singleUpload } from "../../middlewares/multer.middleware";
import { checkRole } from "../../middlewares/auth.middleware";

const router = Router();

router.post("/", createUser);
router.post("/profile-image", singleUpload("image", ["image/jpeg", "image/png", "image/jpg"]), uploadProfileImage);
router.get("/", getAllUsers);
router.put("/:id", updateUser);
router.put("/:id/password", setUserPassword);
router.post("/:id/subscription", updateUserSubscription);
// Charges the customer immediately — platform staff only.
router.post("/:id/end-trial", checkRole(["OWNER", "SUPER_ADMIN"]), endUserTrial);
router.delete("/:id", deleteUser);
router.delete("/", checkRole(["OWNER"]), deleteAllUsers);

export default router;
