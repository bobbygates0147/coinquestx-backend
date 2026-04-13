import { Router } from "express";
import { stakeController } from "../controllers/stakeController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/Stake/Create", authenticate, stakeController.create);
router.post("/Stake/:id/Complete", authenticate, stakeController.complete);
router.get("/Stake", authenticate, stakeController.list);
router.get("/Stake/:id", authenticate, stakeController.getById);
router.patch("/Stake/:id", authenticate, stakeController.update);
router.delete("/Stake/:id", authenticate, stakeController.remove);

export default router;
