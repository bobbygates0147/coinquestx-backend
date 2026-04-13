import { Router } from "express";
import {
  updateTransactionStatus,
  updateKycStatus,
  registerAdmin,
  listUsers,
  listUserActivitySummary,
  getUserActivities,
  listUserAdjustmentSources,
  updateUserStatus,
  deleteUser,
  adjustUserBalance,
  adjustUserFeatureProfit,
  listKycSubmissions,
  listReferralStats,
  listTransactions,
  listSystemMetrics,
  listBalanceLedger,
  listAdminLogs,
  broadcastAdminMessage,
} from "../controllers/adminController.js";
import {
  listAdminThreads,
  getAdminThread,
  replyAdminThread,
  updateAdminThreadStatus,
} from "../controllers/supportMessageController.js";
import {
  listAdminPaymentProofs,
  updatePaymentProofStatus,
} from "../controllers/paymentProofController.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

router.post(
  "/Admin/Register",
  registerAdmin
);

router.get(
  "/Admin/Users",
  authenticate,
  requireAdmin,
  listUsers
);

router.get(
  "/Admin/Users/ActivitySummary",
  authenticate,
  requireAdmin,
  listUserActivitySummary
);

router.get(
  "/Admin/Users/:id/Activities",
  authenticate,
  requireAdmin,
  getUserActivities
);

router.get(
  "/Admin/Users/:id/AdjustmentSources",
  authenticate,
  requireAdmin,
  listUserAdjustmentSources
);

router.patch(
  "/Admin/Users/:id",
  authenticate,
  requireAdmin,
  updateUserStatus
);

router.delete(
  "/Admin/Users/:id",
  authenticate,
  requireAdmin,
  deleteUser
);

router.post(
  "/Admin/AdjustBalance",
  authenticate,
  requireAdmin,
  adjustUserBalance
);

router.post(
  "/Admin/AdjustFeatureProfit",
  authenticate,
  requireAdmin,
  adjustUserFeatureProfit
);

router.get(
  "/Admin/Kyc",
  authenticate,
  requireAdmin,
  listKycSubmissions
);

router.get(
  "/Admin/Referrals",
  authenticate,
  requireAdmin,
  listReferralStats
);

router.get(
  "/Admin/Transactions",
  authenticate,
  requireAdmin,
  listTransactions
);

router.get(
  "/Admin/PaymentProofs",
  authenticate,
  requireAdmin,
  listAdminPaymentProofs
);

router.patch(
  "/Admin/PaymentProofs/:proofId",
  authenticate,
  requireAdmin,
  updatePaymentProofStatus
);

router.get(
  "/Admin/SystemMetrics",
  authenticate,
  requireAdmin,
  listSystemMetrics
);

router.get(
  "/Admin/Ledger",
  authenticate,
  requireAdmin,
  listBalanceLedger
);

router.get(
  "/Admin/Logs",
  authenticate,
  requireAdmin,
  listAdminLogs
);

router.post(
  "/Admin/Broadcast",
  authenticate,
  requireAdmin,
  broadcastAdminMessage
);

router.post(
  "/Admin/UpdateTransactionStatus",
  authenticate,
  requireAdmin,
  updateTransactionStatus
);

router.post(
  "/Admin/UpdateKycStatus",
  authenticate,
  requireAdmin,
  updateKycStatus
);

router.get(
  ["/Admin/Messages", "/Admin/Message", "/admin/messages", "/admin/message"],
  authenticate,
  requireAdmin,
  listAdminThreads
);

router.get(
  [
    "/Admin/Messages/:threadId",
    "/Admin/Message/:threadId",
    "/admin/messages/:threadId",
    "/admin/message/:threadId",
  ],
  authenticate,
  requireAdmin,
  getAdminThread
);

router.post(
  [
    "/Admin/Messages/:threadId/Reply",
    "/Admin/Message/:threadId/Reply",
    "/admin/messages/:threadId/reply",
    "/admin/message/:threadId/reply",
  ],
  authenticate,
  requireAdmin,
  replyAdminThread
);

router.patch(
  [
    "/Admin/Messages/:threadId",
    "/Admin/Message/:threadId",
    "/admin/messages/:threadId",
    "/admin/message/:threadId",
  ],
  authenticate,
  requireAdmin,
  updateAdminThreadStatus
);

export default router;
