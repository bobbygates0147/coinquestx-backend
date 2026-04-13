import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  confirmEnableTwoFactor,
  confirmWhitelistAdd,
  disableTwoFactor,
  listWalletWhitelist,
  removeWhitelistEntry,
  requestEnableTwoFactor,
  requestWhitelistAdd,
} from "../controllers/securityController.js";

const router = Router();

router.get("/User/Security/Whitelist", authenticate, listWalletWhitelist);
router.post(
  "/User/Security/2FA/RequestEnable",
  authenticate,
  requestEnableTwoFactor
);
router.post(
  "/User/Security/2FA/ConfirmEnable",
  authenticate,
  confirmEnableTwoFactor
);
router.post("/User/Security/2FA/Disable", authenticate, disableTwoFactor);
router.post(
  "/User/Security/Whitelist/RequestAdd",
  authenticate,
  requestWhitelistAdd
);
router.post(
  "/User/Security/Whitelist/ConfirmAdd",
  authenticate,
  confirmWhitelistAdd
);
router.delete(
  "/User/Security/Whitelist/:entryId",
  authenticate,
  removeWhitelistEntry
);

export default router;
