import { Router } from "express";
import { miningController } from "../controllers/miningController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/Mining/Create", authenticate, miningController.create);
router.post("/Mining/Claim", authenticate, miningController.claim);
router.get("/Mining", authenticate, miningController.list);
router.get("/Mining/:id", authenticate, miningController.getById);
router.patch("/Mining/:id", authenticate, miningController.update);
router.delete("/Mining/:id", authenticate, miningController.remove);

export default router;
