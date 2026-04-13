import { Router } from "express";
import {
  getHistory,
  createTransaction,
} from "../controllers/transactionController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/Transaction/History", authenticate, getHistory);
router.post("/Transaction/Create", authenticate, createTransaction);

export default router;
