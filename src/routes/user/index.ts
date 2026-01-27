import { Router } from "express";
import { getAllUsers, updateUser, deleteUser, deleteAllUsers } from "./controller";

const router = Router();

router.get("/", getAllUsers);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);
router.delete("/", deleteAllUsers);

export default router;
