import { Router } from "express";
import multer from "multer";
import {
  listPaymentProofs,
  submitPaymentProof,
} from "../controllers/paymentProofController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get("/PaymentProof", authenticate, listPaymentProofs);
router.post(
  "/PaymentProof/Submit",
  authenticate,
  upload.single("PaymentProof"),
  submitPaymentProof
);

export default router;
