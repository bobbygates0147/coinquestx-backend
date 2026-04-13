import { Router } from "express";
import { buyBotController } from "../controllers/buyBotController.js";
import { authenticate } from "../middleware/auth.js";
import { requireAiBotSubscription } from "../middleware/featureAccess.js";

const router = Router();

router.post(
  "/BuyBot/Create",
  authenticate,
  requireAiBotSubscription,
  buyBotController.create
);
router.get("/BuyBot", authenticate, requireAiBotSubscription, buyBotController.list);
router.get(
  "/BuyBot/:id",
  authenticate,
  requireAiBotSubscription,
  buyBotController.getById
);
router.patch(
  "/BuyBot/:id",
  authenticate,
  requireAiBotSubscription,
  buyBotController.update
);
router.delete(
  "/BuyBot/:id",
  authenticate,
  requireAiBotSubscription,
  buyBotController.remove
);

export default router;
