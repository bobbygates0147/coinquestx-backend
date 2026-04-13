import { Router } from "express";
import { copyTradeController } from "../controllers/copyTradeController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/CopyTrade/Create", authenticate, copyTradeController.create);
router.post("/CopyTrade/Claim", authenticate, copyTradeController.claim);
router.get("/CopyTrade", authenticate, copyTradeController.list);
router.get("/CopyTrade/:id", authenticate, copyTradeController.getById);
router.patch("/CopyTrade/:id", authenticate, copyTradeController.update);
router.delete("/CopyTrade/:id", authenticate, copyTradeController.remove);

export default router;
