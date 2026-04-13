import { Router } from "express";
import {
  getDashboard,
  getProfile,
  updateProfile,
  getKycStatus,
  changePassword,
  adjustBalance,
} from "../controllers/userController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/User/Dashboard", authenticate, getDashboard);
router.get("/User/Profile", authenticate, getProfile);
router.put("/User/Profile", authenticate, updateProfile);
router.get("/User/KycStatus", authenticate, getKycStatus);
router.post("/User/ChangePassword", authenticate, changePassword);
router.post("/User/Balance", authenticate, adjustBalance);

export default router;
