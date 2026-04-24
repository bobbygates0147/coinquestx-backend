import { Router } from "express";
import { miningController } from "../controllers/miningController.js";
import { authenticate } from "../middleware/auth.js";
import { requireMiningSubscription } from "../middleware/featureAccess.js";

const router = Router();

router.post("/Mining/Create", authenticate, requireMiningSubscription, miningController.create);
router.post("/Mining/Claim", authenticate, requireMiningSubscription, miningController.claim);
router.get("/Mining", authenticate, requireMiningSubscription, miningController.list);
router.get("/Mining/:id", authenticate, requireMiningSubscription, miningController.getById);
router.patch("/Mining/:id", authenticate, requireMiningSubscription, miningController.update);
router.delete("/Mining/:id", authenticate, requireMiningSubscription, miningController.remove);

export default router;
