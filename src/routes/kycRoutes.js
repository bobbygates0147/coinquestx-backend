import { Router } from "express";
import multer from "multer";
import { getKycSubmission, submitKyc } from "../controllers/kycController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get("/Kyc/Submission", authenticate, getKycSubmission);

router.post(
  "/Kyc/Submit",
  authenticate,
  upload.fields([
    { name: "GovernmentIssuedId", maxCount: 1 },
    { name: "GovernmentIssuedIdBack", maxCount: 1 },
    { name: "SelfieWithId", maxCount: 1 },
  ]),
  submitKyc
);

export default router;
