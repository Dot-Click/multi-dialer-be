import { Router } from "express";
import { getAllUsers, createUser, updateUser, deleteUser, deleteAllUsers } from "./controller";

const router = Router();

router.post("/create", createUser);
router.get("/", getAllUsers);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);
router.delete("/", deleteAllUsers);

export default router;
