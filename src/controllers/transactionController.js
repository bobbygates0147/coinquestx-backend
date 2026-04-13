import Transaction from "../models/Transaction.js";
import Subscription from "../models/Subscription.js";
import Signal from "../models/Signal.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { syncUserPlanAndFeatureAccess } from "../utils/subscriptionAccess.js";

const TRANSACTION_TYPES = [
  "Deposit",
  "Withdrawal",
  "Trade",
  "CopyTrade",
  "PlaceTrade",
  "RealEstate",
  "Signal",
  "Subscription",
  "Mining",
  "Stake",
  "BuyBot",
  "Adjustment",
];

const TYPE_MAP = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  trade: "Trade",
  copytrade: "CopyTrade",
  copy_trade: "CopyTrade",
  placetrade: "PlaceTrade",
  place_trade: "PlaceTrade",
  realestate: "RealEstate",
  "real estate": "RealEstate",
  signal: "Signal",
  signals: "Signal",
  subscription: "Subscription",
  subscriptions: "Subscription",
  mining: "Mining",
  stake: "Stake",
  buybot: "BuyBot",
  bot: "BuyBot",
  bots: "BuyBot",
  adjustment: "Adjustment",
  balanceadjustment: "Adjustment",
};

const normalizeType = (value) => {
  if (!value) return null;
  const trimmed = `${value}`.trim();
  if (TRANSACTION_TYPES.includes(trimmed)) return trimmed;

  const lowered = trimmed.toLowerCase();
  if (TYPE_MAP[lowered]) return TYPE_MAP[lowered];

  const compact = lowered.replace(/[\s_-]+/g, "");
  if (TYPE_MAP[compact]) return TYPE_MAP[compact];

  return null;
};

const normalizeStatus = (value) => {
  if (!value) return "Completed";
  if (typeof value === "number") {
    switch (value) {
      case 1:
        return "Pending";
      case 2:
        return "Completed";
      case 3:
        return "Failed";
      case 4:
        return "Cancelled";
      default:
        return "Completed";
    }
  }

  const normalized = `${value}`.trim().toLowerCase();
  if (normalized === "active") return "Completed";
  if (normalized === "completed") return "Completed";
  if (normalized === "pending") return "Pending";
  if (normalized === "failed") return "Failed";
  if (normalized === "cancelled" || normalized === "canceled") {
    return "Cancelled";
  }

  return "Completed";
};

const parseAmount = (value) => {
  if (typeof value === "number") return value;
  if (!value) return NaN;
  const cleaned = `${value}`.replace(/[^0-9.-]+/g, "");
  return Number(cleaned);
};

const buildWorkflow = (status, existing = {}, at = new Date()) => {
  const next = { ...(existing || {}) };
  if (!next.submittedAt) {
    next.submittedAt = at;
  }

  if (status === "Completed" && !next.completedAt) {
    next.completedAt = at;
  }
  if (status === "Pending" && !next.pendingAt) {
    next.pendingAt = at;
  }
  if (status === "Failed" && !next.failedAt) {
    next.failedAt = at;
  }
  if (status === "Cancelled" && !next.cancelledAt) {
    next.cancelledAt = at;
  }

  return next;
};

const resolveSourceFeature = (type, metadata = {}) => {
  if (typeof metadata.sourceFeature === "string" && metadata.sourceFeature.trim()) {
    return metadata.sourceFeature.trim();
  }

  switch (type) {
    case "Deposit":
    case "Withdrawal":
      return "wallet";
    case "Trade":
    case "CopyTrade":
    case "PlaceTrade":
      return "trading";
    case "Signal":
      return "signals";
    case "Subscription":
      return "subscription";
    case "Mining":
      return "mining";
    case "Stake":
      return "staking";
    case "BuyBot":
      return "bots";
    case "RealEstate":
      return "real-estate";
    case "Adjustment":
      return "balance-ledger";
    default:
      return "account";
  }
};

const dedupeHistoryTransactions = (transactions = []) => {
  const seenPlaceTradeEntries = new Set();

  return transactions.filter((transaction) => {
    const tradeId = `${transaction?.metadata?.tradeId || ""}`.trim();
    const phase = `${transaction?.metadata?.phase || ""}`.trim().toLowerCase();

    if (transaction?.type !== "PlaceTrade" || !tradeId || !phase) {
      return true;
    }

    const key = `${transaction.user?.toString?.() || transaction.user}:${transaction.type}:${tradeId}:${phase}`;
    if (seenPlaceTradeEntries.has(key)) {
      return false;
    }

    seenPlaceTradeEntries.add(key);
    return true;
  });
};

export const getHistory = asyncHandler(async (req, res) => {
  const transactions = dedupeHistoryTransactions(
    await Transaction.find({ user: req.user._id }).sort({
      createdAt: -1,
    })
  );

  const data = transactions.map((tx) => ({
    id: tx._id.toString(),
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    paymentMethod: tx.paymentMethod,
    status: tx.status,
    createdAt: tx.createdAt,
    walletAddress: tx.walletAddress,
    network: tx.network,
    details: tx.details,
    sourceFeature: tx.sourceFeature || "",
    balanceBefore: Number(tx.balanceBefore) || 0,
    balanceAfter: Number(tx.balanceAfter) || 0,
    actorRole: tx.actorRole || "user",
    actorLabel: tx.actorLabel || "",
    workflow: tx.workflow || {},
    destination: tx.metadata?.destination || {},
    metadata: tx.metadata || {},
  }));

  res.json({ success: true, data });
});

export const createTransaction = asyncHandler(async (req, res) => {
  const normalizedType = normalizeType(req.body.type);
  if (!normalizedType) {
    return res.status(400).json({
      success: false,
      message: "Invalid transaction type",
    });
  }

  const amountValue = Math.abs(parseAmount(req.body.amount));
  if (!Number.isFinite(amountValue)) {
    return res.status(400).json({
      success: false,
      message: "Invalid transaction amount",
    });
  }

  const statusValue = normalizeStatus(req.body.status);
  const paymentMethod = req.body.paymentMethod || req.body.method || "";
  const details = req.body.details || req.body.description || "";
  const metadata = req.body.metadata || {};
  const currency = req.body.currency || req.user?.currencyCode || "USD";

  if (normalizedType === "Adjustment") {
    return res.status(403).json({
      success: false,
      message: "Adjustment transactions can only be created by the server.",
    });
  }

  if (amountValue > 0) {
    return res.status(403).json({
      success: false,
      message:
        "Direct positive-value transaction entries are disabled. Use the secured feature endpoints instead.",
    });
  }

  const entryDirection = `${metadata.entryDirection || ""}`.trim().toLowerCase();
  const currentBalance = Number(req.user?.balance) || 0;
  const explicitBefore = Number(metadata.balanceBefore);
  const explicitAfter = Number(metadata.balanceAfter);
  let balanceBefore = Number.isFinite(explicitBefore) ? explicitBefore : currentBalance;
  let balanceAfter = Number.isFinite(explicitAfter) ? explicitAfter : currentBalance;

  if (!Number.isFinite(explicitBefore) || !Number.isFinite(explicitAfter)) {
    if (entryDirection === "debit") {
      balanceAfter = currentBalance;
      balanceBefore = currentBalance + amountValue;
    } else if (entryDirection === "credit") {
      balanceAfter = currentBalance;
      balanceBefore = currentBalance - amountValue;
    }
  }

  const transaction = await Transaction.create({
    user: req.user._id,
    type: normalizedType,
    amount: amountValue,
    currency,
    paymentMethod,
    status: statusValue,
    details,
    sourceFeature: resolveSourceFeature(normalizedType, metadata),
    balanceBefore,
    balanceAfter,
    actorRole: "user",
    actor: req.user?._id || null,
    actorLabel: req.user?.email || "",
    workflow: buildWorkflow(statusValue),
    metadata,
  });

  if (normalizedType === "Subscription") {
    if (statusValue === "Completed") {
      const planName =
        metadata?.planName || metadata?.subscriptionPlan || paymentMethod || "";
      if (planName) {
        await Subscription.updateMany(
          { user: req.user._id, status: "Active" },
          { status: "Cancelled", endsAt: new Date() }
        );
        await Subscription.create({
          user: req.user._id,
          planName,
          price: amountValue,
          status: "Active",
          startsAt: new Date(),
        });
        req.user.subscriptionPlan = planName;
        await req.user.save();
      }
    }

    if (statusValue === "Cancelled") {
      await Subscription.updateMany(
        { user: req.user._id, status: "Active" },
        { status: "Cancelled", endsAt: new Date() }
      );
      req.user.subscriptionPlan = "Basic";
      await req.user.save();
    }

    await syncUserPlanAndFeatureAccess(req.user);
  }

  if (normalizedType === "Signal") {
    if (statusValue === "Completed") {
      const signalDetails = metadata?.signalDetails || {};
      const planName =
        signalDetails.planName || metadata?.planName || paymentMethod || "";
      const planId = signalDetails.planId || metadata?.planId;
      if (planName) {
        await Signal.updateMany(
          { user: req.user._id, status: "active" },
          { status: "cancelled" }
        );
        await Signal.create({
          user: req.user._id,
          planId,
          planName,
          amountPaid: amountValue,
          purchaseDate: new Date(),
          status: "active",
          winRate: signalDetails.winRate || "",
          dailySignals: Number(signalDetails.dailySignals) || 0,
          description: signalDetails.description || "",
          features: Array.isArray(signalDetails.features)
            ? signalDetails.features
            : [],
        });
      }
    }

    if (statusValue === "Cancelled") {
      await Signal.updateMany(
        { user: req.user._id, status: "active" },
        { status: "cancelled" }
      );
    }
  }

  res.status(201).json({
    success: true,
    data: {
      id: transaction._id.toString(),
      type: transaction.type,
      status: transaction.status,
      subscriptionPlan: req.user.subscriptionPlan,
    },
  });
});
