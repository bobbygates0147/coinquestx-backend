import { Router } from "express";
import { createWithdrawal } from "../controllers/withdrawalController.js";
import { authenticate } from "../middleware/auth.js";
import { requireKyc } from "../middleware/requireKyc.js";

const router = Router();

router.post("/Withdrawal/Create", authenticate, requireKyc, createWithdrawal);

export default router;
