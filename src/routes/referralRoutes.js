import { Router } from "express";
import { getReferralOverview } from "../controllers/referralController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/Referral/Overview", authenticate, getReferralOverview);

export default router;
