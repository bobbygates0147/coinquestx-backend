import { Router } from "express";
import { listMethods, createDeposit } from "../controllers/depositController.js";
import { authenticate } from "../middleware/auth.js";
import { requireKyc } from "../middleware/requireKyc.js";

const router = Router();

router.get("/Deposit/Methods", authenticate, listMethods);
router.post("/Deposit/Create", authenticate, requireKyc, createDeposit);

export default router;
