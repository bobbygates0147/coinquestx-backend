import Deposit from "../models/Deposit.js";
import Transaction from "../models/Transaction.js";
import { depositMethods } from "../config/depositMethods.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const findMethod = (paymentMethod) => {
  if (!paymentMethod) return null;
  const key = paymentMethod.toLowerCase();
  return (
    depositMethods.find((method) => method.id === key) ||
    depositMethods.find(
      (method) => method.currencyCode.toLowerCase() === key
    )
  );
};

const getConfiguredWalletAddress = (method) => method?.walletAddress?.trim() || "";

export const listMethods = asyncHandler(async (req, res) => {
  const data = depositMethods.map((method) => ({
    ...method,
    walletAddress: getConfiguredWalletAddress(method),
    isConfigured: Boolean(getConfiguredWalletAddress(method)),
  }));
  res.json({ success: true, data });
});

export const createDeposit = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  const paymentMethod = req.body.paymentMethod;
  const requestId = req.headers["x-request-id"] || "";

  if (!amount || Number.isNaN(amount) || amount < 10) {
    return res.status(400).json({
      success: false,
      message: "Minimum deposit amount is $10",
    });
  }

  const method = findMethod(paymentMethod);
  if (!method) {
    return res.status(400).json({
      success: false,
      message: "Unsupported deposit method",
    });
  }

  const walletAddress = getConfiguredWalletAddress(method);
  if (!walletAddress) {
    return res.status(503).json({
      success: false,
      message: `${method.currencyName} deposit address is not configured yet`,
    });
  }

  if (requestId) {
    const existing = await Deposit.findOne({
      user: req.user._id,
      requestId,
      status: "Pending",
    });
    if (existing) {
      return res.json({
        success: true,
        data: {
          id: existing._id.toString(),
          walletAddress: existing.walletAddress,
          amount: existing.amount,
          status: existing.status,
        },
      });
    }
  }

  const currency = req.body.currency || req.user?.currencyCode || "USD";
  const currentBalance = Number(req.user?.balance) || 0;
  const submittedAt = new Date();

  const transaction = await Transaction.create({
    user: req.user._id,
    type: "Deposit",
    amount,
    currency,
    paymentMethod: method.currencyCode,
    status: "Pending",
    walletAddress,
    network: method.network,
    details: `${method.currencyName} deposit`,
    sourceFeature: "wallet",
    balanceBefore: currentBalance,
    balanceAfter: currentBalance,
    actorRole: "user",
    actor: req.user?._id || null,
    actorLabel: req.user?.email || "",
    workflow: {
      submittedAt,
      pendingAt: submittedAt,
    },
  });

  const deposit = await Deposit.create({
    user: req.user._id,
    amount,
    currency,
    paymentMethod: method.id,
    walletAddress,
    network: method.network,
    status: "Pending",
    requestId,
    transaction: transaction._id,
  });

  await sendUserNotificationEmail({
    user: req.user,
    type: "deposit",
    subject: "Deposit request created",
    headline: "Your deposit request is pending",
    intro:
      "CoinQuestX created a new deposit request for your account. Send funds to the configured wallet and upload payment proof if required.",
    bullets: [
      `Amount: $${amount.toFixed(2)}`,
      `Asset: ${method.currencyCode}`,
      `Network: ${method.network}`,
      `Wallet: ${walletAddress}`,
    ],
    metadata: {
      depositId: deposit._id.toString(),
      transactionId: transaction._id.toString(),
      paymentMethod: method.currencyCode,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      id: deposit._id.toString(),
      walletAddress: deposit.walletAddress,
      amount: deposit.amount,
      status: deposit.status,
      paymentMethod: deposit.paymentMethod,
      network: deposit.network,
    },
  });
});
