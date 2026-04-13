import Withdrawal from "../models/Withdrawal.js";
import Transaction from "../models/Transaction.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";
import {
  createSecurityChallenge,
  findWhitelistEntry,
  getWithdrawalCooldownState,
  normalizeSecuritySettings,
  verifySecurityChallenge,
} from "../utils/security.js";

export const createWithdrawal = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  const currency = req.body.currency || req.user?.currencyCode || "USD";
  const paymentMethod = req.body.paymentMethod;
  const details = req.body.details || "";
  const destination = req.body.destination || {};
  const challengeId = `${req.body.challengeId || ""}`.trim();
  const otpCode = `${req.body.otpCode || req.body.code || ""}`.trim();

  if (!amount || Number.isNaN(amount) || amount < 10) {
    return res.status(400).json({
      success: false,
      message: "Minimum withdrawal amount is $10",
    });
  }

  if (!paymentMethod) {
    return res.status(400).json({
      success: false,
      message: "Payment method is required",
    });
  }

  if (amount > req.user.balance) {
    return res.status(400).json({
      success: false,
      message: "Insufficient balance",
    });
  }

  const securitySettings = normalizeSecuritySettings(req.user.securitySettings);
  const cooldown = getWithdrawalCooldownState(req.user);
  if (cooldown.active) {
    return res.status(429).json({
      success: false,
      message: `Withdrawal cooldown is active. Try again in ${cooldown.remainingMinutes} minute(s).`,
      data: {
        remainingMinutes: cooldown.remainingMinutes,
        unlockAt: cooldown.unlockAt,
      },
    });
  }

  const { entry, profile } = findWhitelistEntry(req.user, paymentMethod, destination);
  if (!entry) {
    return res.status(400).json({
      success: false,
      message:
        "This payout destination is not in your active wallet whitelist. Approve it from Security first.",
      data: {
        destinationSummary: profile.destinationSummary,
      },
    });
  }

  const requiresOtp =
    securitySettings.withdrawalProtection || securitySettings.twoFactorEnabled;

  if (requiresOtp) {
    if (!challengeId || !otpCode) {
      const challenge = await createSecurityChallenge({
        user: req.user,
        type: "withdrawal_confirmation",
        metadata: {
          amount,
          currency,
          paymentMethod,
          details,
          destination,
          destinationHash: profile.destinationHash,
          destinationSummary: profile.destinationSummary,
          whitelistEntryId: entry?._id?.toString() || "",
        },
        subject: "Confirm your CoinQuestX withdrawal",
        headline: "Approve this withdrawal request",
        intro:
          "Use this code to confirm a withdrawal from your CoinQuestX wallet. The request will not proceed until verification succeeds.",
        bullets: [
          `Amount: $${amount.toFixed(2)}`,
          `Method: ${paymentMethod}`,
          `Destination: ${profile.destinationSummary || profile.maskedDestination}`,
        ],
      });

      return res.status(202).json({
        success: false,
        requiresConfirmation: true,
        message: "Verification code sent to your email address.",
        data: {
          challengeId: challenge._id.toString(),
          expiresAt: challenge.expiresAt,
          destinationSummary: profile.destinationSummary,
        },
      });
    }

    try {
      const challenge = await verifySecurityChallenge({
        challengeId,
        userId: req.user._id,
        type: "withdrawal_confirmation",
        code: otpCode,
      });

      if (
        challenge?.metadata?.destinationHash &&
        challenge.metadata.destinationHash !== profile.destinationHash
      ) {
        return res.status(400).json({
          success: false,
          message:
            "The confirmed withdrawal destination no longer matches this request. Request a fresh verification code.",
        });
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "Invalid withdrawal verification code",
      });
    }
  }

  const currentBalance = Number(req.user.balance) || 0;
  const nextBalance = Math.max(0, currentBalance - amount);
  const submittedAt = new Date();

  const transaction = await Transaction.create({
    user: req.user._id,
    type: "Withdrawal",
    amount,
    currency,
    paymentMethod,
    status: "Pending",
    details,
    sourceFeature: "wallet",
    balanceBefore: currentBalance,
    balanceAfter: nextBalance,
    actorRole: "user",
    actor: req.user?._id || null,
    actorLabel: req.user?.email || "",
    workflow: {
      submittedAt,
      pendingAt: submittedAt,
    },
    metadata: {
      destination,
      destinationSummary: profile.destinationSummary,
      whitelistEntryId: entry?._id?.toString() || "",
      requiresOtp,
    },
  });

  const withdrawal = await Withdrawal.create({
    user: req.user._id,
    amount,
    currency,
    paymentMethod,
    details,
    destination,
    status: "Pending",
    transaction: transaction._id,
  });

  req.user.balance = nextBalance;
  req.user.securitySettings = {
    ...securitySettings,
    lastWithdrawalRequestedAt: submittedAt.toISOString(),
  };
  entry.lastUsedAt = submittedAt;
  await req.user.save();

  await sendUserNotificationEmail({
    user: req.user,
    type: "withdrawal",
    subject: "Withdrawal request received",
    headline: "Your withdrawal is pending review",
    intro:
      "CoinQuestX received your withdrawal request and it is now waiting for review.",
    bullets: [
      `Amount: $${amount.toFixed(2)}`,
      `Method: ${paymentMethod}`,
      `Destination: ${profile.destinationSummary || profile.maskedDestination}`,
      "Status: Pending",
    ],
    metadata: {
      withdrawalId: withdrawal._id.toString(),
      transactionId: transaction._id.toString(),
    },
  });

  res.status(201).json({
    success: true,
    data: {
      id: withdrawal._id.toString(),
      status: withdrawal.status,
    },
  });
});
