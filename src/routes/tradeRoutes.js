import { Router } from "express";
import {
  createTrade,
  listTrades,
  completeTrade,
} from "../controllers/tradeController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/Trade/Create", authenticate, createTrade);
router.get("/Trade", authenticate, listTrades);
router.post("/Trades/Complete", authenticate, completeTrade);

export default router;
