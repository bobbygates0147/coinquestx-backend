import { Router } from "express";
import { body } from "express-validator";
import {
  confirmRegistration,
  login,
  logout,
  register,
  forgotPassword,
  resetPassword,
} from "../controllers/authController.js";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post(
  "/User/Register",
  [
    body("firstName").notEmpty(),
    body("lastName").notEmpty(),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("confirmPassword").isLength({ min: 6 }),
  ],
  validate,
  register
);

router.post(
  "/User/Register/Confirm",
  [body("challengeId").notEmpty(), body("code").notEmpty()],
  validate,
  confirmRegistration
);

router.post(
  "/Authentication/Login",
  [body("email").isEmail(), body("password").notEmpty()],
  validate,
  login
);

router.post("/User/Logout", authenticate, logout);
router.post("/Authentication/ForgotPassword", forgotPassword);
router.post("/Authentication/ResetPassword", resetPassword);

export default router;
