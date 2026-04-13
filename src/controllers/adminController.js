import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Transaction from "../models/Transaction.js";
import Deposit from "../models/Deposit.js";
import Withdrawal from "../models/Withdrawal.js";
import Kyc from "../models/Kyc.js";
import Trade from "../models/Trade.js";
import PlaceTrade from "../models/PlaceTrade.js";
import Subscription from "../models/Subscription.js";
import Signal from "../models/Signal.js";
import CopyTrade from "../models/CopyTrade.js";
import BuyBot from "../models/BuyBot.js";
import Mining from "../models/Mining.js";
import Stake from "../models/Stake.js";
import RealEstate from "../models/RealEstate.js";
import Referral from "../models/Referral.js";
import SupportThread from "../models/SupportThread.js";
import AdminEvent from "../models/AdminEvent.js";
import User from "../models/User.js";
import BalanceLedger from "../models/BalanceLedger.js";
import OutboundNotification from "../models/OutboundNotification.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const normalizeStatus = (value) => {
  if (value === undefined || value === null) return null;
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
        return null;
    }
  }

  const normalized = `${value}`.trim().toLowerCase();
  if (["pending", "completed", "failed", "cancelled"].includes(normalized)) {
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  return null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseLimit = (value, fallback = 120, min = 20, max = 500) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
};

const asNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const asDateMs = (value) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const safeTrim = (value) => `${value || ""}`.trim();

const ADMIN_ADJUSTMENT_REASON_MAP = {
  copy_trade: { key: "copy_trade", label: "Copy Trade", sourceFeature: "copy-trading" },
  mining: { key: "mining", label: "Mining", sourceFeature: "mining" },
  buy_bot: { key: "buy_bot", label: "Buy Bots", sourceFeature: "bots" },
  daily_signal: { key: "daily_signal", label: "Daily Signal", sourceFeature: "signals" },
  subscription: { key: "subscription", label: "Subscription", sourceFeature: "subscription" },
  stake: { key: "stake", label: "Stake", sourceFeature: "staking" },
  place_trade: { key: "place_trade", label: "Place Trade", sourceFeature: "trading" },
  trades_roi: { key: "trades_roi", label: "Trades ROI", sourceFeature: "trading" },
  real_estate: { key: "real_estate", label: "Real Estate", sourceFeature: "real-estate" },
  buy_crypto: { key: "buy_crypto", label: "Buy Crypto", sourceFeature: "trading" },
  deposit: { key: "deposit", label: "Deposit", sourceFeature: "wallet" },
  withdrawal: { key: "withdrawal", label: "Withdrawal", sourceFeature: "wallet" },
  referral: { key: "referral", label: "Referral Reward", sourceFeature: "referrals" },
  bonus: { key: "bonus", label: "Bonus / Promo", sourceFeature: "account" },
  account_review: { key: "account_review", label: "Account Review", sourceFeature: "account" },
  manual: { key: "manual", label: "Manual Adjustment", sourceFeature: "account" },
};

const resolveAdminAdjustmentReason = (value) => {
  const normalized = safeTrim(value).toLowerCase();
  return ADMIN_ADJUSTMENT_REASON_MAP[normalized] || ADMIN_ADJUSTMENT_REASON_MAP.manual;
};

const buildAdminAdjustmentSummary = ({
  operation,
  reasonLabel,
  referenceName,
  noteText,
}) => {
  const prefix = operation === "deduct" ? "Debited for" : "Credited from";
  const referenceSuffix = referenceName ? ` - ${referenceName}` : "";
  return `${prefix} ${reasonLabel}${referenceSuffix}${noteText ? `. ${noteText}` : ""}`;
};

const buildWorkflow = (status, existing = {}, at = new Date()) => {
  const next = { ...(existing || {}) };
  if (!next.submittedAt) {
    next.submittedAt = at;
  }
  next.reviewedAt = at;

  if (status === "Completed") next.completedAt = at;
  if (status === "Failed") next.failedAt = at;
  if (status === "Cancelled") next.cancelledAt = at;
  if (status === "Pending") next.pendingAt = at;

  return next;
};

const normalizePlanFilter = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : `${value}`.split(",");
  return list
    .map((item) => `${item || ""}`.trim().toLowerCase())
    .filter(Boolean);
};

const createAdminEvent = async ({
  type,
  message,
  actorId,
  targetUserId = null,
  metadata = {},
}) => {
  if (!type || !message || !actorId) return;

  try {
    await AdminEvent.create({
      type,
      message: safeTrim(message).slice(0, 500),
      actor: actorId,
      targetUser: targetUserId || null,
      metadata,
    });
  } catch (error) {
    console.error("Failed to persist admin event:", error);
  }
};

const toIsoStringOrNull = (value) => {
  const timestamp = asDateMs(value);
  return timestamp ? new Date(timestamp).toISOString() : null;
};

const getUserKey = (id) => {
  if (!id) return "";
  return typeof id === "string" ? id : id.toString();
};

const createEmptyMetrics = () => ({
  transactionsTotal: 0,
  pendingTransactions: 0,
  completedTransactions: 0,
  depositsCompleted: 0,
  totalDeposits: 0,
  withdrawalsCompleted: 0,
  totalWithdrawals: 0,
  subscriptionsTotal: 0,
  subscriptionsActive: 0,
  subscriptionSpend: 0,
  signalsTotal: 0,
  signalsActive: 0,
  signalSpend: 0,
  copyTradesTotal: 0,
  copyTradesActive: 0,
  copyTradesCompleted: 0,
  copyTradeCapital: 0,
  placeTradesTotal: 0,
  placeTradesActive: 0,
  placeTradesCompleted: 0,
  placeTradeVolume: 0,
  placeTradePnl: 0,
  tradesTotal: 0,
  tradesActive: 0,
  tradesCompleted: 0,
  tradeVolume: 0,
  tradePnl: 0,
  buyBotsTotal: 0,
  buyBotsActive: 0,
  buyBotBudget: 0,
  miningTotal: 0,
  miningActive: 0,
  miningRewards: 0,
  stakesTotal: 0,
  stakesActive: 0,
  totalStaked: 0,
  realEstateTotal: 0,
  realEstateActive: 0,
  totalRealEstateInvested: 0,
  lastActivityAt: null,
});

const mergeLatest = (existingIso, incomingDateValue) => {
  const existingMs = asDateMs(existingIso);
  const incomingMs = asDateMs(incomingDateValue);
  if (!incomingMs) return existingIso || null;
  return incomingMs > existingMs
    ? new Date(incomingMs).toISOString()
    : existingIso || null;
};

const buildMetricsByUser = async (userIds) => {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return {};
  }

  const ids = userIds.map((id) => getUserKey(id)).filter(Boolean);
  const filter = { user: { $in: userIds } };
  const metricsByUser = Object.fromEntries(
    ids.map((id) => [id, createEmptyMetrics()])
  );

  const [
    transactionAgg,
    subscriptionAgg,
    signalAgg,
    copyTradeAgg,
    placeTradeAgg,
    tradeAgg,
    buyBotAgg,
    miningAgg,
    stakeAgg,
    realEstateAgg,
  ] = await Promise.all([
    Transaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
          },
          depositsCompleted: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$type", "Deposit"] },
                    { $eq: ["$status", "Completed"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalDeposits: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$type", "Deposit"] },
                    { $eq: ["$status", "Completed"] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          withdrawalsCompleted: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$type", "Withdrawal"] },
                    { $eq: ["$status", "Completed"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalWithdrawals: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$type", "Withdrawal"] },
                    { $eq: ["$status", "Completed"] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    Subscription.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          spend: { $sum: { $ifNull: ["$price", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    Signal.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: [
                { $eq: [{ $toLower: { $ifNull: ["$status", ""] } }, "active"] },
                1,
                0,
              ],
            },
          },
          spend: { $sum: { $ifNull: ["$amountPaid", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    CopyTrade.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
          },
          capital: { $sum: { $ifNull: ["$amount", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    PlaceTrade.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
          },
          volume: { $sum: { $ifNull: ["$amount", 0] } },
          pnl: { $sum: { $ifNull: ["$profitLoss", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    Trade.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
          },
          volume: { $sum: { $ifNull: ["$amount", 0] } },
          pnl: { $sum: { $ifNull: ["$profitLoss", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    BuyBot.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          budget: { $sum: { $ifNull: ["$budget", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    Mining.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          rewards: { $sum: { $ifNull: ["$rewardBalance", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    Stake.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          totalAmount: { $sum: { $ifNull: ["$amount", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
    RealEstate.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$user",
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          totalAmount: { $sum: { $ifNull: ["$amount", 0] } },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]),
  ]);

  const applyAggregate = (aggItems, updater) => {
    aggItems.forEach((item) => {
      const key = getUserKey(item?._id);
      if (!key || !metricsByUser[key]) return;
      updater(metricsByUser[key], item);
    });
  };

  applyAggregate(transactionAgg, (metrics, item) => {
    metrics.transactionsTotal = asNumber(item.total);
    metrics.pendingTransactions = asNumber(item.pending);
    metrics.completedTransactions = asNumber(item.completed);
    metrics.depositsCompleted = asNumber(item.depositsCompleted);
    metrics.totalDeposits = asNumber(item.totalDeposits);
    metrics.withdrawalsCompleted = asNumber(item.withdrawalsCompleted);
    metrics.totalWithdrawals = asNumber(item.totalWithdrawals);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(subscriptionAgg, (metrics, item) => {
    metrics.subscriptionsTotal = asNumber(item.total);
    metrics.subscriptionsActive = asNumber(item.active);
    metrics.subscriptionSpend = asNumber(item.spend);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(signalAgg, (metrics, item) => {
    metrics.signalsTotal = asNumber(item.total);
    metrics.signalsActive = asNumber(item.active);
    metrics.signalSpend = asNumber(item.spend);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(copyTradeAgg, (metrics, item) => {
    metrics.copyTradesTotal = asNumber(item.total);
    metrics.copyTradesActive = asNumber(item.active);
    metrics.copyTradesCompleted = asNumber(item.completed);
    metrics.copyTradeCapital = asNumber(item.capital);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(placeTradeAgg, (metrics, item) => {
    metrics.placeTradesTotal = asNumber(item.total);
    metrics.placeTradesActive = asNumber(item.active);
    metrics.placeTradesCompleted = asNumber(item.completed);
    metrics.placeTradeVolume = asNumber(item.volume);
    metrics.placeTradePnl = asNumber(item.pnl);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(tradeAgg, (metrics, item) => {
    metrics.tradesTotal = asNumber(item.total);
    metrics.tradesActive = asNumber(item.active);
    metrics.tradesCompleted = asNumber(item.completed);
    metrics.tradeVolume = asNumber(item.volume);
    metrics.tradePnl = asNumber(item.pnl);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(buyBotAgg, (metrics, item) => {
    metrics.buyBotsTotal = asNumber(item.total);
    metrics.buyBotsActive = asNumber(item.active);
    metrics.buyBotBudget = asNumber(item.budget);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(miningAgg, (metrics, item) => {
    metrics.miningTotal = asNumber(item.total);
    metrics.miningActive = asNumber(item.active);
    metrics.miningRewards = asNumber(item.rewards);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(stakeAgg, (metrics, item) => {
    metrics.stakesTotal = asNumber(item.total);
    metrics.stakesActive = asNumber(item.active);
    metrics.totalStaked = asNumber(item.totalAmount);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  applyAggregate(realEstateAgg, (metrics, item) => {
    metrics.realEstateTotal = asNumber(item.total);
    metrics.realEstateActive = asNumber(item.active);
    metrics.totalRealEstateInvested = asNumber(item.totalAmount);
    metrics.lastActivityAt = mergeLatest(metrics.lastActivityAt, item.lastAt);
  });

  return metricsByUser;
};

const createActivityItem = ({
  id,
  type,
  status = "",
  amount = 0,
  title = "",
  description = "",
  asset = "",
  direction = "",
  createdAt,
  metadata = {},
}) => ({
  id,
  type,
  status,
  amount: asNumber(amount),
  title,
  description,
  asset,
  direction,
  createdAt: toIsoStringOrNull(createdAt),
  metadata,
});

const formatAdminAmount = (value) => `$${asNumber(value).toFixed(2)}`;

const getAdminRecordTail = (value) => {
  const key = getUserKey(value);
  return key ? key.slice(-6).toUpperCase() : "000000";
};

const getAdminAdjustmentEntityType = (reasonKey) => {
  switch (reasonKey) {
    case "copy_trade":
      return "CopyTrade";
    case "mining":
      return "Mining";
    case "buy_bot":
      return "BuyBot";
    case "daily_signal":
      return "Signal";
    case "subscription":
      return "Subscription";
    case "stake":
      return "Stake";
    case "place_trade":
      return "PlaceTrade";
    case "trades_roi":
      return "Trade";
    case "real_estate":
      return "RealEstate";
    case "deposit":
      return "Deposit";
    case "withdrawal":
      return "Withdrawal";
    case "referral":
      return "Referral";
    default:
      return "Manual";
  }
};

const buildAdminAdjustmentReferenceName = (reasonKey, record = {}) => {
  switch (reasonKey) {
    case "copy_trade":
      return (
        safeTrim(record.traderName) ||
        safeTrim(record.traderData?.name) ||
        safeTrim(record.sourceTraderId) ||
        `Trader ${getAdminRecordTail(record._id)}`
      );
    case "mining":
      return safeTrim(record.asset)
        ? `${safeTrim(record.asset)} Mining`
        : `Mining ${getAdminRecordTail(record._id)}`;
    case "buy_bot":
      return (
        safeTrim(record.strategyName) ||
        (safeTrim(record.asset)
          ? `${safeTrim(record.asset)} Bot`
          : `Bot ${getAdminRecordTail(record._id)}`)
      );
    case "daily_signal":
      return (
        safeTrim(record.planName) ||
        safeTrim(record.title) ||
        safeTrim(record.provider) ||
        `Signal ${getAdminRecordTail(record._id)}`
      );
    case "subscription":
      return safeTrim(record.planName) || `Subscription ${getAdminRecordTail(record._id)}`;
    case "stake":
      return (
        safeTrim(record.reference) ||
        (safeTrim(record.asset)
          ? `${safeTrim(record.asset)} Stake`
          : `Stake ${getAdminRecordTail(record._id)}`)
      );
    case "place_trade":
      return safeTrim(record.asset) || `Place Trade ${getAdminRecordTail(record._id)}`;
    case "trades_roi":
      return safeTrim(record.asset) || `ROI Trade ${getAdminRecordTail(record._id)}`;
    case "real_estate":
      return (
        safeTrim(record.propertyName) ||
        safeTrim(record.reference) ||
        `Real Estate ${getAdminRecordTail(record._id)}`
      );
    case "deposit": {
      const paymentLabel = safeTrim(record.paymentMethod).toUpperCase();
      return (
        safeTrim(record.requestId) ||
        [paymentLabel, safeTrim(record.network)].filter(Boolean).join(" / ") ||
        `Deposit ${getAdminRecordTail(record._id)}`
      );
    }
    case "withdrawal":
      return (
        [safeTrim(record.paymentMethod), safeTrim(record.destination?.cryptoAsset)].filter(Boolean).join(" / ") ||
        `Withdrawal ${getAdminRecordTail(record._id)}`
      );
    case "referral":
      return safeTrim(record.referredEmail) || `Referral ${getAdminRecordTail(record._id)}`;
    default:
      return "";
  }
};

const getAdminAdjustmentRecordAmount = (reasonKey, record = {}) => {
  switch (reasonKey) {
    case "copy_trade":
      return asNumber(record.amount);
    case "mining":
      return asNumber(record.rewardBalance || record.hashRate);
    case "buy_bot":
      return asNumber(record.budget);
    case "daily_signal":
      return asNumber(record.amountPaid);
    case "subscription":
      return asNumber(record.price);
    case "stake":
      return asNumber(record.principalUsd || record.amount);
    case "place_trade":
      return asNumber(record.amount);
    case "trades_roi":
      return asNumber(record.profitLoss || record.amount);
    case "real_estate":
      return asNumber(record.amount);
    case "deposit":
      return asNumber(record.amount);
    case "withdrawal":
      return asNumber(record.amount);
    case "referral":
      return asNumber(record.rewardAmount);
    default:
      return 0;
  }
};

const PROFIT_ADJUSTABLE_REASON_KEYS = new Set([
  "copy_trade",
  "mining",
  "buy_bot",
  "daily_signal",
  "subscription",
  "stake",
  "place_trade",
  "trades_roi",
  "real_estate",
  "referral",
]);

const isProfitAdjustableReason = (reasonKey) =>
  PROFIT_ADJUSTABLE_REASON_KEYS.has(reasonKey);

const getAdminAdjustmentRecordProfitLabel = (reasonKey) => {
  switch (reasonKey) {
    case "copy_trade":
    case "place_trade":
    case "trades_roi":
    case "buy_bot":
    case "daily_signal":
    case "subscription":
    case "real_estate":
      return "Profit";
    case "mining":
      return "Reward";
    case "stake":
      return "Payout";
    case "referral":
      return "Referral Reward";
    default:
      return "Amount";
  }
};

const getAdminAdjustmentRecordProfit = (reasonKey, record = {}) => {
  switch (reasonKey) {
    case "copy_trade":
      return asNumber(
        record.realizedProfit ??
          record.traderData?.settledProfit ??
          record.traderData?.realizedProfit
      );
    case "mining":
      return asNumber(record.rewardBalance);
    case "buy_bot":
      return asNumber(record.generatedProfit);
    case "daily_signal":
      return asNumber(record.payoutUsd);
    case "subscription":
      return asNumber(record.payoutUsd);
    case "stake":
      return asNumber(record.payoutUsd || record.rewardUsdTotal);
    case "place_trade":
    case "trades_roi":
      return asNumber(record.profitLoss);
    case "real_estate":
      return asNumber(record.payoutUsd || record.expectedPayoutUsd);
    case "referral":
      return asNumber(record.rewardAmount);
    default:
      return 0;
  }
};

const buildAdminAdjustmentRecordSummary = (
  reasonKey,
  record = {},
  scope = "balance"
) => {
  const statusText =
    safeTrim(record.status) ||
    safeTrim(record.rewardStatus) ||
    "Recorded";
  const profitValue = getAdminAdjustmentRecordProfit(reasonKey, record);
  const profitLabel = getAdminAdjustmentRecordProfitLabel(reasonKey);
  const profitText = `${profitLabel} ${formatAdminAmount(profitValue)}`;

  switch (reasonKey) {
    case "copy_trade":
      return scope === "profit"
        ? `Status ${statusText} / ${profitText} / Capital ${formatAdminAmount(record.amount)} / Performance ${asNumber(record.performance).toFixed(2)}%`
        : `Status ${statusText} / Capital ${formatAdminAmount(record.amount)} / Performance ${asNumber(record.performance).toFixed(2)}% / ${profitText}`;
    case "mining":
      return `Status ${statusText} / ${profitText} / Hash Rate ${asNumber(record.hashRate)}`;
    case "buy_bot":
      return `Status ${statusText} / ${profitText} / Budget ${formatAdminAmount(record.budget)}${safeTrim(record.asset) ? ` / Asset ${safeTrim(record.asset)}` : ""}`;
    case "daily_signal":
      return `Status ${statusText} / ${profitText} / Plan ${formatAdminAmount(record.amountPaid)}${safeTrim(record.provider) ? ` / Provider ${safeTrim(record.provider)}` : ""}`;
    case "subscription":
      return `Status ${statusText} / ${profitText} / Plan ${formatAdminAmount(record.price)}`;
    case "stake":
      return `Status ${statusText} / ${profitText} / Principal ${formatAdminAmount(record.principalUsd || record.amount)} / APY ${asNumber(record.apy).toFixed(2)}%`;
    case "place_trade":
      return `Status ${statusText} / ${safeTrim(record.direction || record.tradeType) || "Trade"}${safeTrim(record.asset) ? ` / ${safeTrim(record.asset)}` : ""} / Size ${formatAdminAmount(record.amount)} / ${profitText}`;
    case "trades_roi":
      return `Status ${statusText} / ${safeTrim(record.direction) || "Trade"}${safeTrim(record.asset) ? ` / ${safeTrim(record.asset)}` : ""} / PnL ${formatAdminAmount(record.profitLoss || record.amount)}`;
    case "real_estate":
      return `Status ${statusText} / ${profitText} / Invested ${formatAdminAmount(record.amount)}${safeTrim(record.location) ? ` / ${safeTrim(record.location)}` : ""}`;
    case "deposit":
      return `Status ${statusText} / ${formatAdminAmount(record.amount)}${safeTrim(record.paymentMethod) ? ` / ${safeTrim(record.paymentMethod).toUpperCase()}` : ""}`;
    case "withdrawal":
      return `Status ${statusText} / ${formatAdminAmount(record.amount)}${safeTrim(record.paymentMethod) ? ` / ${safeTrim(record.paymentMethod)}` : ""}`;
    case "referral":
      return `${profitText} / ${safeTrim(record.rewardStatus) || "Pending"}${safeTrim(record.referredEmail) ? ` / ${safeTrim(record.referredEmail)}` : ""}`;
    default:
      return "Linked activity";
  }
};

const toAdminAdjustmentSourceItem = (
  reasonKey,
  record = {},
  scope = "balance"
) => {
  const reason = resolveAdminAdjustmentReason(reasonKey);
  const referenceName = buildAdminAdjustmentReferenceName(reason.key, record);
  const sourceAmount = getAdminAdjustmentRecordAmount(reason.key, record);
  const profitAmount = getAdminAdjustmentRecordProfit(reason.key, record);
  const amount = scope === "profit" ? profitAmount : sourceAmount;

  return {
    id: getUserKey(record._id),
    reasonKey: reason.key,
    reasonLabel: reason.label,
    sourceFeature: reason.sourceFeature,
    entityType: getAdminAdjustmentEntityType(reason.key),
    referenceName,
    status:
      safeTrim(record.status) ||
      safeTrim(record.rewardStatus) ||
      "Recorded",
    amount,
    displayAmount: formatAdminAmount(amount),
    sourceAmount,
    displaySourceAmount: formatAdminAmount(sourceAmount),
    profitAmount,
    displayProfitAmount: formatAdminAmount(profitAmount),
    profitLabel: getAdminAdjustmentRecordProfitLabel(reason.key),
    scope,
    createdAt: toIsoStringOrNull(
      record.createdAt ||
        record.purchaseDate ||
        record.startedAt ||
        record.startDate
    ),
    summary: buildAdminAdjustmentRecordSummary(reason.key, record, scope),
  };
};

const getAdminAdjustmentQueryConfig = ({ userId, reasonKey }) => {
  switch (reasonKey) {
    case "copy_trade":
      return { model: CopyTrade, filter: { user: userId } };
    case "mining":
      return { model: Mining, filter: { user: userId } };
    case "buy_bot":
      return { model: BuyBot, filter: { user: userId } };
    case "daily_signal":
      return { model: Signal, filter: { user: userId } };
    case "subscription":
      return { model: Subscription, filter: { user: userId } };
    case "stake":
      return { model: Stake, filter: { user: userId } };
    case "place_trade":
      return { model: PlaceTrade, filter: { user: userId } };
    case "trades_roi":
      return { model: Trade, filter: { user: userId } };
    case "real_estate":
      return { model: RealEstate, filter: { user: userId } };
    case "deposit":
      return { model: Deposit, filter: { user: userId } };
    case "withdrawal":
      return { model: Withdrawal, filter: { user: userId } };
    case "referral":
      return { model: Referral, filter: { referrer: userId } };
    default:
      return { model: null, filter: {} };
  }
};

const findAdminAdjustmentRecords = async ({
  model,
  filter,
  relatedEntityId,
  limit = 60,
  lean = true,
}) => {
  if (relatedEntityId) {
    let query = model.findOne({
      ...filter,
      _id: relatedEntityId,
    });
    if (lean) {
      query = query.lean();
    }
    const item = await query;
    return item ? [item] : [];
  }

  let query = model.find(filter).sort({ createdAt: -1 }).limit(limit);
  if (lean) {
    query = query.lean();
  }
  return query;
};

const fetchAdminAdjustmentSourcesByReason = async ({
  userId,
  reasonKey,
  relatedEntityId = "",
  limit = 60,
  scope = "balance",
}) => {
  if (scope === "profit" && !isProfitAdjustableReason(reasonKey)) {
    return [];
  }

  const { model, filter } = getAdminAdjustmentQueryConfig({ userId, reasonKey });
  if (!model) {
    return [];
  }

  return findAdminAdjustmentRecords({
    model,
    filter,
    relatedEntityId,
    limit,
  });
};

const loadAdminAdjustmentRecordForUpdate = async ({
  userId,
  reasonKey,
  relatedEntityId,
}) => {
  if (!relatedEntityId) return null;

  const { model, filter } = getAdminAdjustmentQueryConfig({ userId, reasonKey });
  if (!model) return null;

  const records = await findAdminAdjustmentRecords({
    model,
    filter,
    relatedEntityId,
    limit: 1,
    lean: false,
  });

  return records[0] || null;
};

const resolveAdminAdjustmentLinkedRecord = async ({
  userId,
  reasonKey,
  relatedEntityId,
  scope = "balance",
}) => {
  if (!relatedEntityId) return null;

  const records = await fetchAdminAdjustmentSourcesByReason({
    userId,
    reasonKey,
    relatedEntityId,
    limit: 1,
    scope,
  });

  if (!records.length) return null;

  const sourceItem = toAdminAdjustmentSourceItem(reasonKey, records[0], scope);
  return {
    ...sourceItem,
    relatedEntityId: sourceItem.id,
    relatedEntityType: sourceItem.entityType,
    relatedEntityLabel: sourceItem.referenceName,
  };
};

const applyAdminProfitValueToRecord = (reasonKey, record, nextProfitValue) => {
  switch (reasonKey) {
    case "copy_trade":
      record.realizedProfit = nextProfitValue;
      record.traderData = {
        ...(record.traderData || {}),
        settledProfit: nextProfitValue,
        realizedProfit: nextProfitValue,
      };
      break;
    case "mining":
      record.rewardBalance = nextProfitValue;
      break;
    case "buy_bot":
      record.generatedProfit = nextProfitValue;
      break;
    case "daily_signal":
      record.payoutUsd = nextProfitValue;
      break;
    case "subscription":
      record.payoutUsd = nextProfitValue;
      break;
    case "stake":
      record.payoutUsd = nextProfitValue;
      record.rewardUsdTotal = nextProfitValue;
      break;
    case "place_trade":
    case "trades_roi":
      record.profitLoss = nextProfitValue;
      break;
    case "real_estate":
      record.payoutUsd = nextProfitValue;
      record.expectedPayoutUsd = nextProfitValue;
      break;
    case "referral":
      record.rewardAmount = nextProfitValue;
      break;
    default:
      break;
  }
};

const toSentenceCaseWords = (value = "") =>
  safeTrim(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) =>
      index === 0
        ? `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
        : word.toLowerCase()
    )
    .join(" ");

const getProfitAdjustmentSourceLabel = (reasonKey) => {
  switch (reasonKey) {
    case "copy_trade":
      return "Trader";
    case "mining":
      return "Plan";
    case "buy_bot":
      return "Bot";
    case "daily_signal":
      return "Provider";
    case "subscription":
      return "Plan";
    case "stake":
      return "Position";
    case "place_trade":
    case "trades_roi":
      return "Trade";
    case "real_estate":
      return "Property";
    case "referral":
      return "Referral";
    default:
      return "Source";
  }
};

const getProfitAdjustmentDisplayLabel = (reasonKey, reasonLabel) => {
  const prefix = toSentenceCaseWords(reasonLabel) || "Account";
  const profitLabel = getAdminAdjustmentRecordProfitLabel(reasonKey).toLowerCase();
  return `${prefix} ${profitLabel}`.trim();
};

const buildAdminProfitAdjustmentSummary = ({
  reasonKey,
  reasonLabel,
  referenceName,
  previousProfit,
  nextProfit,
}) => {
  const cleanReference = safeTrim(referenceName);
  const profitDelta = Number(nextProfit) - Number(previousProfit);
  const displayLabel = getProfitAdjustmentDisplayLabel(reasonKey, reasonLabel);

  if (profitDelta < 0) {
    return `${displayLabel} updated${
      cleanReference ? ` for ${cleanReference}` : ""
    }: -${formatAdminAmount(Math.abs(profitDelta))}`;
  }

  if (profitDelta > 0) {
    return `${displayLabel} credited${
      cleanReference ? ` from ${cleanReference}` : ""
    }: ${formatAdminAmount(Math.abs(profitDelta))}`;
  }

  return `${displayLabel} recorded${
    cleanReference ? ` for ${cleanReference}` : ""
  }`;
};

const buildProfitAdjustmentNotificationPayload = ({
  reasonKey,
  reasonLabel,
  referenceName,
  previousProfit,
  nextProfit,
  nextBalance,
}) => {
  const cleanReference = safeTrim(referenceName);
  const profitDelta = Number(nextProfit) - Number(previousProfit);
  const displayLabel = getProfitAdjustmentDisplayLabel(reasonKey, reasonLabel);
  const sourceLabel = getProfitAdjustmentSourceLabel(reasonKey);
  const displayLabelLower = displayLabel.toLowerCase();
  const profitLabel = getAdminAdjustmentRecordProfitLabel(reasonKey);

  return {
    subject:
      profitDelta < 0
        ? `${displayLabel} updated`
        : `${displayLabel} credited`,
    headline:
      profitDelta < 0
        ? `Your ${displayLabelLower} was updated`
        : `Your ${displayLabelLower} was credited`,
    intro:
      profitDelta < 0
        ? `CoinQuestX synced the latest settled ${displayLabelLower} to your wallet.`
        : `CoinQuestX settled the latest ${displayLabelLower} and credited it to your wallet.`,
    bullets: [
      cleanReference
        ? `${sourceLabel}: ${cleanReference}`
        : `Feature: ${toSentenceCaseWords(reasonLabel) || "Account"}`,
      profitDelta < 0
        ? `${profitLabel} change: -${formatAdminAmount(Math.abs(profitDelta))}`
        : `${profitLabel} credited: ${formatAdminAmount(Math.abs(profitDelta))}`,
      `Total ${profitLabel.toLowerCase()}: ${formatAdminAmount(nextProfit)}`,
      `New balance: ${formatAdminAmount(nextBalance)}`,
    ],
  };
};

export const updateTransactionStatus = asyncHandler(async (req, res) => {
  const { transactionId, newStatus } = req.body;
  if (!transactionId) {
    return res.status(400).json({
      success: false,
      message: "transactionId is required",
    });
  }

  const normalizedStatus = normalizeStatus(newStatus);
  if (!normalizedStatus) {
    return res.status(400).json({
      success: false,
      message: "Invalid status value",
    });
  }

  const transaction = await Transaction.findById(transactionId);
  if (!transaction) {
    return res.status(404).json({
      success: false,
      message: "Transaction not found",
    });
  }

  const previousStatus = transaction.status;
  transaction.status = normalizedStatus;

  const user = await User.findById(transaction.user);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const balanceBeforeMutation = Number(user.balance) || 0;
  let didBalanceChange = false;

  if (transaction.type === "Deposit") {
    const deposit = await Deposit.findOne({ transaction: transaction._id });
    if (deposit) {
      deposit.status = normalizedStatus;
      await deposit.save();
    }

    if (normalizedStatus === "Completed" && previousStatus !== "Completed") {
      user.balance = Math.max(0, user.balance + transaction.amount);
      await user.save();
      didBalanceChange = true;
    }
  }

  if (transaction.type === "Withdrawal") {
    const withdrawal = await Withdrawal.findOne({
      transaction: transaction._id,
    });
    if (withdrawal) {
      withdrawal.status = normalizedStatus;
      await withdrawal.save();
    }

    const isRefundStatus =
      normalizedStatus === "Failed" || normalizedStatus === "Cancelled";
    const wasRefundStatus =
      previousStatus === "Failed" || previousStatus === "Cancelled";

    if (isRefundStatus && !wasRefundStatus) {
      user.balance = Math.max(0, user.balance + transaction.amount);
      await user.save();
      didBalanceChange = true;
    }
  }

  if (didBalanceChange) {
    transaction.balanceBefore = balanceBeforeMutation;
  }
  transaction.balanceAfter = Number(user.balance) || 0;
  transaction.workflow = buildWorkflow(normalizedStatus, transaction.workflow);
  transaction.actorRole = "admin";
  transaction.actor = req.user?._id || null;
  transaction.actorLabel = req.user?.email || "Admin";
  await transaction.save();

  if (transaction.type === "Deposit") {
    await sendUserNotificationEmail({
      user,
      type: "deposit",
      subject: `Deposit ${normalizedStatus.toLowerCase()}`,
      headline: `Your deposit is now ${normalizedStatus.toLowerCase()}`,
      intro:
        normalizedStatus === "Completed"
          ? "CoinQuestX completed your deposit review and credited your wallet."
          : "CoinQuestX updated the status of one of your deposit requests.",
      bullets: [
        `Amount: ${formatAdminAmount(transaction.amount)}`,
        `Status: ${normalizedStatus}`,
        `Method: ${transaction.paymentMethod || "Deposit"}`,
      ],
      metadata: {
        transactionId: transaction._id.toString(),
        status: normalizedStatus,
      },
    });
  }

  if (transaction.type === "Withdrawal") {
    await sendUserNotificationEmail({
      user,
      type: "withdrawal",
      subject: `Withdrawal ${normalizedStatus.toLowerCase()}`,
      headline: `Your withdrawal is now ${normalizedStatus.toLowerCase()}`,
      intro:
        normalizedStatus === "Completed"
          ? "CoinQuestX completed your withdrawal request."
          : normalizedStatus === "Failed" || normalizedStatus === "Cancelled"
          ? "CoinQuestX refunded your withdrawal back to your wallet balance."
          : "CoinQuestX updated the status of one of your withdrawal requests.",
      bullets: [
        `Amount: ${formatAdminAmount(transaction.amount)}`,
        `Status: ${normalizedStatus}`,
        `Method: ${transaction.paymentMethod || "Withdrawal"}`,
      ],
      metadata: {
        transactionId: transaction._id.toString(),
        status: normalizedStatus,
      },
    });
  }

  await createAdminEvent({
    type: "transaction_status",
    message: `Updated ${transaction.type} transaction to ${normalizedStatus}`,
    actorId: req.user?._id,
    targetUserId: user._id,
    metadata: {
      transactionId: transaction._id.toString(),
      previousStatus,
      nextStatus: normalizedStatus,
      type: transaction.type,
      amount: asNumber(transaction.amount),
      currency: transaction.currency || "USD",
    },
  });

  res.json({
    success: true,
    data: {
      id: transaction._id.toString(),
      status: transaction.status,
    },
  });
});

export const updateKycStatus = asyncHandler(async (req, res) => {
  const { userId, status } = req.body;
  if (!userId || !status) {
    return res.status(400).json({
      success: false,
      message: "userId and status are required",
    });
  }

  const normalized = `${status}`.toLowerCase();
  if (!["pending", "verified", "rejected"].includes(normalized)) {
    return res.status(400).json({
      success: false,
      message: "Invalid KYC status",
    });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  user.kycStatus = normalized;
  user.kycVerified = normalized === "verified";
  await user.save();

  const reviewNotes = safeTrim(req.body.reviewNotes);
  await Kyc.findOneAndUpdate(
    { user: user._id },
    {
      status: normalized,
      reviewNotes,
      reviewedAt: new Date(),
      reviewedBy: req.user?._id || null,
    },
    { new: true }
  );

  await createAdminEvent({
    type: "kyc_status",
    message: `KYC ${normalized === "verified" ? "completed" : normalized} for ${user.email}`,
    actorId: req.user?._id,
    targetUserId: user._id,
    metadata: {
      userId: user._id.toString(),
      status: normalized,
      kycVerified: normalized === "verified",
      reviewNotes,
    },
  });

  res.json({
    success: true,
    data: {
      userId: user._id.toString(),
      kycStatus: user.kycStatus,
      kycVerified: user.kycVerified,
    },
  });
});

const buildAdminToken = (user) =>
  jwt.sign(
    {
      sub: user._id.toString(),
      userId: user._id.toString(),
      uid: user._id.toString(),
      email: user.email,
      role: user.role,
    },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );

export const registerAdmin = asyncHandler(async (req, res) => {
  const { email, password, authCode, firstName, lastName } = req.body;

  if (!email || !password || !authCode) {
    return res.status(400).json({
      success: false,
      message: "Email, password, and admin code are required",
    });
  }

  if (env.ADMIN_AUTH_CODE && authCode !== env.ADMIN_AUTH_CODE) {
    return res.status(403).json({
      success: false,
      message: "Invalid admin authorization code",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "Email already registered",
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    firstName: (firstName || "Admin").trim(),
    lastName: (lastName || "User").trim(),
    email: normalizedEmail,
    passwordHash,
    role: "admin",
    status: "active",
    subscriptionPlan: "Admin",
  });

  const token = buildAdminToken(user);

  res.status(201).json({
    success: true,
    token,
    data: {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      token,
    },
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });

  const [depositAgg, withdrawalAgg, profitAgg] = await Promise.all([
    Transaction.aggregate([
      { $match: { type: "Deposit", status: "Completed" } },
      { $group: { _id: "$user", total: { $sum: "$amount" } } },
    ]),
    Transaction.aggregate([
      { $match: { type: "Withdrawal", status: "Completed" } },
      { $group: { _id: "$user", total: { $sum: "$amount" } } },
    ]),
    Trade.aggregate([
      { $match: { status: "Completed" } },
      { $group: { _id: "$user", total: { $sum: "$profitLoss" } } },
    ]),
  ]);

  const depositMap = Object.fromEntries(
    depositAgg.map((item) => [item._id.toString(), item.total])
  );
  const withdrawalMap = Object.fromEntries(
    withdrawalAgg.map((item) => [item._id.toString(), item.total])
  );
  const profitMap = Object.fromEntries(
    profitAgg.map((item) => [item._id.toString(), item.total])
  );

  const data = users.map((user) => ({
    id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    status: user.status,
    balance: Number(user.balance) || 0,
    transactionCode: user.transactionCode || "",
    totalDeposit: depositMap[user._id.toString()] || 0,
    totalWithdrawal: withdrawalMap[user._id.toString()] || 0,
    profit: profitMap[user._id.toString()] || 0,
  }));

  res.json({ success: true, data });
});

export const listUserAdjustmentSources = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(
    "firstName lastName email balance currencyCode currencySymbol"
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const resolvedReason = resolveAdminAdjustmentReason(req.query.reasonKey);
  const scope = safeTrim(req.query.scope).toLowerCase() === "profit"
    ? "profit"
    : "balance";
  const limit = parseLimit(req.query.limit, 60, 10, 120);
  const records = await fetchAdminAdjustmentSourcesByReason({
    userId: user._id,
    reasonKey: resolvedReason.key,
    limit,
    scope,
  });

  res.json({
    success: true,
    data: {
      user: {
        id: user._id.toString(),
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        balance: asNumber(user.balance),
        currencyCode: user.currencyCode || "USD",
        currencySymbol: user.currencySymbol || "$",
      },
      reasonKey: resolvedReason.key,
      reasonLabel: resolvedReason.label,
      sourceFeature: resolvedReason.sourceFeature,
      scope,
      sources: records.map((record) =>
        toAdminAdjustmentSourceItem(resolvedReason.key, record, scope)
      ),
      generatedAt: new Date().toISOString(),
    },
  });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({
      success: false,
      message: "Status is required",
    });
  }

  const normalized = `${status}`.toLowerCase();
  if (!["active", "suspended"].includes(normalized)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status",
    });
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status: normalized },
    { new: true }
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.json({
    success: true,
    data: { id: user._id.toString(), status: user.status },
  });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.json({ success: true, data: { id: user._id.toString() } });
});

export const adjustUserBalance = asyncHandler(async (req, res) => {
  const {
    userId,
    amount,
    operation,
    note,
    reasonKey,
    referenceName,
    relatedEntityId,
  } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "userId is required",
    });
  }

  const normalizedOperation = `${operation || ""}`.trim().toLowerCase();
  if (!["increase", "deduct"].includes(normalizedOperation)) {
    return res.status(400).json({
      success: false,
      message: "operation must be either 'increase' or 'deduct'",
    });
  }

  const amountValue = Number(amount);
  if (!Number.isFinite(amountValue) || amountValue <= 0) {
    return res.status(400).json({
      success: false,
      message: "amount must be a positive number",
    });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const currentBalance = Number(user.balance) || 0;
  const signedDelta =
    normalizedOperation === "deduct" ? -amountValue : amountValue;
  const nextBalance = currentBalance + signedDelta;

  if (nextBalance < 0) {
    return res.status(400).json({
      success: false,
      message: "Insufficient balance for deduction",
    });
  }

  const noteText = safeTrim(note).slice(0, 280);
  const resolvedReason = resolveAdminAdjustmentReason(reasonKey);
  const linkedRecord = await resolveAdminAdjustmentLinkedRecord({
    userId: user._id,
    reasonKey: resolvedReason.key,
    relatedEntityId: safeTrim(relatedEntityId),
  });

  if (safeTrim(relatedEntityId) && !linkedRecord) {
    return res.status(404).json({
      success: false,
      message: `No ${resolvedReason.label} source was found for that user.`,
    });
  }

  user.balance = nextBalance;
  await user.save();

  const trimmedReferenceName = safeTrim(
    referenceName || linkedRecord?.referenceName
  ).slice(0, 160);
  const detailSummary = buildAdminAdjustmentSummary({
    operation: normalizedOperation,
    reasonLabel: resolvedReason.label,
    referenceName: trimmedReferenceName,
    noteText,
  });

  await Transaction.create({
    user: user._id,
    type: "Adjustment",
    amount: amountValue,
    currency: user.currencyCode || "USD",
    paymentMethod: resolvedReason.label,
    status: "Completed",
    details: detailSummary,
    sourceFeature: resolvedReason.sourceFeature,
    balanceBefore: currentBalance,
    balanceAfter: nextBalance,
    actorRole: "admin",
    actor: req.user?._id || null,
    actorLabel: req.user?.email || "Admin",
    workflow: {
      submittedAt: new Date(),
      completedAt: new Date(),
      reviewedAt: new Date(),
    },
    metadata: {
      operation: normalizedOperation,
      delta: signedDelta,
      note: noteText,
      reasonKey: resolvedReason.key,
      reasonLabel: resolvedReason.label,
      referenceName: trimmedReferenceName,
      sourceFeature: resolvedReason.sourceFeature,
      userFacingSummary: detailSummary,
      relatedEntityId: linkedRecord?.relatedEntityId || "",
      relatedEntityType: linkedRecord?.relatedEntityType || "",
      relatedEntityLabel: linkedRecord?.relatedEntityLabel || "",
      relatedEntityStatus: linkedRecord?.status || "",
      relatedEntityAmount: asNumber(linkedRecord?.amount),
      relatedEntityCreatedAt: linkedRecord?.createdAt || null,
      relatedEntitySummary: linkedRecord?.summary || "",
    },
  });

  await createAdminEvent({
    type: "balance_adjustment",
    message: `Balance ${normalizedOperation} by ${amountValue.toFixed(2)} for ${user.email} via ${resolvedReason.label}${trimmedReferenceName ? ` - ${trimmedReferenceName}` : ""}`,
    actorId: req.user?._id,
    targetUserId: user._id,
    metadata: {
      operation: normalizedOperation,
      amount: amountValue,
      delta: signedDelta,
      previousBalance: currentBalance,
      nextBalance,
      note: noteText,
      reasonKey: resolvedReason.key,
      reasonLabel: resolvedReason.label,
      referenceName: trimmedReferenceName,
      sourceFeature: resolvedReason.sourceFeature,
      userFacingSummary: detailSummary,
      relatedEntityId: linkedRecord?.relatedEntityId || "",
      relatedEntityType: linkedRecord?.relatedEntityType || "",
      relatedEntityLabel: linkedRecord?.relatedEntityLabel || "",
      relatedEntityStatus: linkedRecord?.status || "",
      relatedEntityAmount: asNumber(linkedRecord?.amount),
      relatedEntityCreatedAt: linkedRecord?.createdAt || null,
      relatedEntitySummary: linkedRecord?.summary || "",
    },
  });

  await sendUserNotificationEmail({
    user,
    type: "admin_adjustment",
    subject: "Your wallet balance was adjusted",
    headline: "An admin updated your wallet balance",
    intro:
      "CoinQuestX recorded a manual balance adjustment on your account. Review the reason and updated balance below.",
    bullets: [
      `Change: ${signedDelta >= 0 ? "+" : "-"}${formatAdminAmount(Math.abs(signedDelta))}`,
      `Reason: ${resolvedReason.label}${trimmedReferenceName ? ` - ${trimmedReferenceName}` : ""}`,
      `New balance: ${formatAdminAmount(user.balance)}`,
      noteText ? `Admin note: ${noteText}` : "Admin note: None",
    ],
    metadata: {
      adjustmentKind: "balance",
      delta: signedDelta,
      reasonKey: resolvedReason.key,
      reasonLabel: resolvedReason.label,
      referenceName: trimmedReferenceName,
      updatedBy: req.user?.email || "Admin",
    },
    bypassPreferences: true,
  });

  res.json({
    success: true,
    data: {
      userId: user._id.toString(),
      operation: normalizedOperation,
      amount: amountValue,
      delta: signedDelta,
      previousBalance: currentBalance,
      balance: user.balance,
      note: noteText,
      reasonKey: resolvedReason.key,
      reasonLabel: resolvedReason.label,
      referenceName: trimmedReferenceName,
      sourceFeature: resolvedReason.sourceFeature,
      details: detailSummary,
      relatedEntityId: linkedRecord?.relatedEntityId || "",
      relatedEntityType: linkedRecord?.relatedEntityType || "",
      relatedEntityLabel: linkedRecord?.relatedEntityLabel || "",
      relatedEntityStatus: linkedRecord?.status || "",
      relatedEntitySummary: linkedRecord?.summary || "",
      updatedBy: req.user?._id?.toString() || "",
    },
  });
});

export const adjustUserFeatureProfit = asyncHandler(async (req, res) => {
  const { userId, reasonKey, relatedEntityId, profitAmount, note } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "userId is required",
    });
  }

  if (!relatedEntityId) {
    return res.status(400).json({
      success: false,
      message: "relatedEntityId is required",
    });
  }

  const resolvedReason = resolveAdminAdjustmentReason(reasonKey);
  if (!isProfitAdjustableReason(resolvedReason.key)) {
    return res.status(400).json({
      success: false,
      message: `${resolvedReason.label} does not support profit-history adjustments.`,
    });
  }

  const nextProfitValue = Number(profitAmount);
  if (!Number.isFinite(nextProfitValue)) {
    return res.status(400).json({
      success: false,
      message: "profitAmount must be a valid number",
    });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const linkedRecord = await loadAdminAdjustmentRecordForUpdate({
    userId: user._id,
    reasonKey: resolvedReason.key,
    relatedEntityId: safeTrim(relatedEntityId),
  });

  if (!linkedRecord) {
    return res.status(404).json({
      success: false,
      message: `No ${resolvedReason.label} record was found for that user.`,
    });
  }

  const previousProfitValue = getAdminAdjustmentRecordProfit(
    resolvedReason.key,
    linkedRecord
  );
  const profitDelta = nextProfitValue - previousProfitValue;
  const currentBalance = Number(user.balance) || 0;
  const nextBalance = currentBalance + profitDelta;

  if (nextBalance < 0) {
    return res.status(400).json({
      success: false,
      message: "This revision would reduce the user's balance below zero.",
    });
  }

  applyAdminProfitValueToRecord(
    resolvedReason.key,
    linkedRecord,
    nextProfitValue
  );
  await linkedRecord.save();

  const refreshedLinkedRecord = await resolveAdminAdjustmentLinkedRecord({
    userId: user._id,
    reasonKey: resolvedReason.key,
    relatedEntityId: safeTrim(relatedEntityId),
    scope: "profit",
  });

  if (profitDelta === 0) {
    return res.json({
      success: true,
      data: {
        userId: user._id.toString(),
        reasonKey: resolvedReason.key,
        reasonLabel: resolvedReason.label,
        referenceName: refreshedLinkedRecord?.referenceName || "",
        previousProfit: previousProfitValue,
        updatedProfit: nextProfitValue,
        delta: 0,
        balance: currentBalance,
        unchanged: true,
        relatedEntityId: refreshedLinkedRecord?.relatedEntityId || "",
      },
    });
  }

  user.balance = nextBalance;
  await user.save();

  const noteText = safeTrim(note).slice(0, 280);
  const detailSummary = buildAdminProfitAdjustmentSummary({
    reasonKey: resolvedReason.key,
    reasonLabel: resolvedReason.label,
    referenceName: refreshedLinkedRecord?.referenceName || "",
    previousProfit: previousProfitValue,
    nextProfit: nextProfitValue,
  });
  const profitReasonLabel = `${resolvedReason.label} Profit`;
  const profitNotification = buildProfitAdjustmentNotificationPayload({
    reasonKey: resolvedReason.key,
    reasonLabel: resolvedReason.label,
    referenceName: refreshedLinkedRecord?.referenceName || "",
    previousProfit: previousProfitValue,
    nextProfit: nextProfitValue,
    nextBalance,
  });

  await Transaction.create({
    user: user._id,
    type: "Adjustment",
    amount: Math.abs(profitDelta),
    currency: user.currencyCode || "USD",
    paymentMethod: profitReasonLabel,
    status: "Completed",
    details: detailSummary,
    sourceFeature: resolvedReason.sourceFeature,
    balanceBefore: currentBalance,
    balanceAfter: nextBalance,
    actorRole: "admin",
    actor: req.user?._id || null,
    actorLabel: req.user?.email || "Admin",
    workflow: {
      submittedAt: new Date(),
      completedAt: new Date(),
      reviewedAt: new Date(),
    },
    metadata: {
      adjustmentKind: "profit_history",
      operation: profitDelta < 0 ? "deduct" : "increase",
      delta: profitDelta,
      note: noteText,
      reasonKey: resolvedReason.key,
      reasonLabel: profitReasonLabel,
      referenceName: refreshedLinkedRecord?.referenceName || "",
      sourceFeature: resolvedReason.sourceFeature,
      userFacingSummary: detailSummary,
      relatedEntityId: refreshedLinkedRecord?.relatedEntityId || "",
      relatedEntityType: refreshedLinkedRecord?.relatedEntityType || "",
      relatedEntityLabel: refreshedLinkedRecord?.referenceName || "",
      relatedEntityStatus: refreshedLinkedRecord?.status || "",
      relatedEntityAmount: asNumber(refreshedLinkedRecord?.sourceAmount),
      relatedEntityCreatedAt: refreshedLinkedRecord?.createdAt || null,
      relatedEntitySummary: refreshedLinkedRecord?.summary || "",
      relatedEntityProfitLabel:
        refreshedLinkedRecord?.profitLabel ||
        getAdminAdjustmentRecordProfitLabel(resolvedReason.key),
      relatedEntityProfitBefore: previousProfitValue,
      relatedEntityProfitAfter: nextProfitValue,
      relatedEntityProfitDelta: profitDelta,
    },
  });

  await createAdminEvent({
    type: "profit_adjustment",
    message: `${
      profitDelta < 0
        ? "Profit debited for"
        : profitDelta > 0
        ? "Profit credited from"
        : "Profit recorded for"
    } ${resolvedReason.label}${refreshedLinkedRecord?.referenceName ? ` - ${refreshedLinkedRecord.referenceName}` : ""} on ${user.email}${
      profitDelta === 0 ? "" : `: ${formatAdminAmount(Math.abs(profitDelta))}`
    }`,
    actorId: req.user?._id,
    targetUserId: user._id,
    metadata: {
      reasonKey: resolvedReason.key,
      reasonLabel: resolvedReason.label,
      previousProfit: previousProfitValue,
      updatedProfit: nextProfitValue,
      delta: profitDelta,
      previousBalance: currentBalance,
      nextBalance,
      referenceName: refreshedLinkedRecord?.referenceName || "",
      note: noteText,
      relatedEntityId: refreshedLinkedRecord?.relatedEntityId || "",
      relatedEntityType: refreshedLinkedRecord?.relatedEntityType || "",
      relatedEntitySummary: refreshedLinkedRecord?.summary || "",
    },
  });

  await sendUserNotificationEmail({
    user,
    type: "admin_adjustment",
    subject: profitNotification.subject,
    headline: profitNotification.headline,
    intro: profitNotification.intro,
    bullets: profitNotification.bullets,
    metadata: {
      adjustmentKind: "profit_history",
      delta: profitDelta,
      reasonKey: resolvedReason.key,
      reasonLabel: resolvedReason.label,
      referenceName: refreshedLinkedRecord?.referenceName || "",
      relatedEntityId: refreshedLinkedRecord?.relatedEntityId || "",
      updatedBy: req.user?.email || "Admin",
    },
    bypassPreferences: true,
  });

  res.json({
    success: true,
    data: {
      userId: user._id.toString(),
      reasonKey: resolvedReason.key,
      reasonLabel: resolvedReason.label,
      referenceName: refreshedLinkedRecord?.referenceName || "",
      previousProfit: previousProfitValue,
      updatedProfit: nextProfitValue,
      delta: profitDelta,
      previousBalance: currentBalance,
      balance: nextBalance,
      note: noteText,
      relatedEntityId: refreshedLinkedRecord?.relatedEntityId || "",
      relatedEntityType: refreshedLinkedRecord?.relatedEntityType || "",
      relatedEntitySummary: refreshedLinkedRecord?.summary || "",
      updatedBy: req.user?._id?.toString() || "",
    },
  });
});

export const listUserActivitySummary = asyncHandler(async (req, res) => {
  const users = await User.find()
    .select(
      "firstName lastName email role status balance currencyCode currencySymbol phoneNumber country kycStatus kycVerified createdAt updatedAt"
    )
    .sort({ createdAt: -1 });

  const userIds = users.map((user) => user._id);
  const metricsByUser = await buildMetricsByUser(userIds);

  const data = users
    .map((user) => {
      const userId = user._id.toString();
      const metrics = metricsByUser[userId] || createEmptyMetrics();

      return {
        id: userId,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        role: user.role || "user",
        status: user.status || "active",
        phoneNumber: user.phoneNumber || "",
        country: user.country || "",
        kycStatus: user.kycStatus || "not_verified",
        kycVerified: Boolean(user.kycVerified),
        currencyCode: user.currencyCode || "USD",
        currencySymbol: user.currencySymbol || "$",
        balance: asNumber(user.balance),
        createdAt: toIsoStringOrNull(user.createdAt),
        updatedAt: toIsoStringOrNull(user.updatedAt),
        lastActivityAt:
          metrics.lastActivityAt ||
          toIsoStringOrNull(user.updatedAt) ||
          toIsoStringOrNull(user.createdAt),
        metrics,
      };
    })
    .sort((a, b) => asDateMs(b.lastActivityAt) - asDateMs(a.lastActivityAt));

  const totals = data.reduce(
    (accumulator, item) => {
      accumulator.totalUsers += 1;
      accumulator.totalBalance += asNumber(item.balance);
      accumulator.activeSubscriptions += asNumber(
        item.metrics.subscriptionsActive
      );
      accumulator.activeSignals += asNumber(item.metrics.signalsActive);
      accumulator.activeCopyTrades += asNumber(item.metrics.copyTradesActive);
      accumulator.activePlaceTrades += asNumber(item.metrics.placeTradesActive);
      accumulator.pendingTransactions += asNumber(
        item.metrics.pendingTransactions
      );
      return accumulator;
    },
    {
      totalUsers: 0,
      totalBalance: 0,
      activeSubscriptions: 0,
      activeSignals: 0,
      activeCopyTrades: 0,
      activePlaceTrades: 0,
      pendingTransactions: 0,
    }
  );

  res.json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      users: data,
      totals,
    },
  });
});

export const getUserActivities = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(
    "firstName lastName email role status balance currencyCode currencySymbol phoneNumber country kycStatus kycVerified createdAt updatedAt"
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const limit = parseLimit(req.query.limit, 150, 20, 600);
  const baseFilter = { user: user._id };

  const [
    subscriptions,
    signals,
    copyTrades,
    placeTrades,
    trades,
    transactions,
    buyBots,
    miningRecords,
    stakes,
    realEstateRecords,
  ] = await Promise.all([
    Subscription.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    Signal.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    CopyTrade.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    PlaceTrade.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    Trade.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    Transaction.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    BuyBot.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    Mining.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    Stake.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
    RealEstate.find(baseFilter).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);

  const activities = [
    ...subscriptions.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "Subscription",
        status: item.status,
        amount: item.price,
        title: item.planName || "Subscription",
        description: `Subscription ${item.status || "Active"}`,
        createdAt: item.createdAt,
        metadata: {
          startsAt: toIsoStringOrNull(item.startsAt),
          endsAt: toIsoStringOrNull(item.endsAt),
          payoutUsd: asNumber(item.payoutUsd),
          profitAmount: asNumber(item.payoutUsd),
        },
      })
    ),
    ...signals.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "Signal",
        status: item.status,
        amount: item.amountPaid,
        title: item.planName || item.title || item.provider || "Signal Plan",
        description: item.description || item.message || "",
        asset: item.asset || "",
        createdAt: item.createdAt,
        metadata: {
          provider: item.provider || "",
          dailySignals: asNumber(item.dailySignals),
          winRate: item.winRate || "",
          payoutUsd: asNumber(item.payoutUsd),
          profitAmount: asNumber(item.payoutUsd),
        },
      })
    ),
    ...copyTrades.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "CopyTrade",
        status: item.status,
        amount: item.amount,
        title: item.traderName || "Copy Trade",
        description: `Source Trader: ${item.sourceTraderId || "N/A"}`,
        createdAt: item.createdAt,
        metadata: {
          performance: asNumber(item.performance),
          realizedProfit: asNumber(
            item.realizedProfit ??
              item.traderData?.settledProfit ??
              item.traderData?.realizedProfit
          ),
        },
      })
    ),
    ...placeTrades.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "PlaceTrade",
        status: item.status,
        amount: item.amount,
        title: item.asset || "Place Trade",
        description: `${item.tradeType || "Trade"} ${item.result || ""}`.trim(),
        asset: item.asset || "",
        direction: item.direction || "",
        createdAt: item.createdAt,
        metadata: {
          duration: item.duration || "",
          lotSize: asNumber(item.lotSize),
          takeProfit: item.takeProfit || "",
          stopLoss: item.stopLoss || "",
          profitLoss: asNumber(item.profitLoss),
        },
      })
    ),
    ...trades.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "Trade",
        status: item.status,
        amount: item.amount,
        title: item.asset || "Trade",
        description: `${item.result || ""}`.trim(),
        asset: item.asset || "",
        direction: item.direction || "",
        createdAt: item.createdAt,
        metadata: {
          leverage: asNumber(item.leverage),
          duration: item.duration || "",
          profitLoss: asNumber(item.profitLoss),
        },
      })
    ),
    ...transactions.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: item.type || "Transaction",
        status: item.status,
        amount: item.amount,
        title: `${item.type || "Transaction"} ${item.paymentMethod ? `(${item.paymentMethod})` : ""}`.trim(),
        description: item.details || "",
        createdAt: item.createdAt,
        metadata: {
          currency: item.currency || "USD",
          paymentMethod: item.paymentMethod || "",
          walletAddress: item.walletAddress || "",
          network: item.network || "",
        },
      })
    ),
    ...buyBots.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "BuyBot",
        status: item.status,
        amount: item.budget,
        title: item.strategyName || "Buy Bot",
        description: item.asset ? `Asset: ${item.asset}` : "",
        asset: item.asset || "",
        createdAt: item.createdAt,
        metadata: {
          generatedProfit: asNumber(item.generatedProfit),
          profitAmount: asNumber(item.generatedProfit),
        },
      })
    ),
    ...miningRecords.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "Mining",
        status: item.status,
        amount: item.rewardBalance,
        title: item.asset || "Mining",
        description: `Hash Rate: ${asNumber(item.hashRate)}`,
        asset: item.asset || "",
        createdAt: item.createdAt,
        metadata: {
          hashRate: asNumber(item.hashRate),
          rewardBalance: asNumber(item.rewardBalance),
          profitAmount: asNumber(item.rewardBalance),
        },
      })
    ),
    ...stakes.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "Stake",
        status: item.status,
        amount: item.amount,
        title: item.asset || "Stake",
        description: `APY: ${asNumber(item.apy)}%`,
        asset: item.asset || "",
        createdAt: item.createdAt,
        metadata: {
          apy: asNumber(item.apy),
          payoutUsd: asNumber(item.payoutUsd),
          rewardUsdTotal: asNumber(item.rewardUsdTotal),
          profitAmount: asNumber(item.payoutUsd || item.rewardUsdTotal),
        },
      })
    ),
    ...realEstateRecords.map((item) =>
      createActivityItem({
        id: item._id.toString(),
        type: "RealEstate",
        status: item.status,
        amount: item.amount,
        title: item.propertyName || "Real Estate",
        description: item.location || "",
        createdAt: item.createdAt,
        metadata: {
          roi: asNumber(item.roi),
          payoutUsd: asNumber(item.payoutUsd),
          expectedPayoutUsd: asNumber(item.expectedPayoutUsd),
          profitAmount: asNumber(item.payoutUsd || item.expectedPayoutUsd),
        },
      })
    ),
  ]
    .filter((item) => item.createdAt)
    .sort((a, b) => asDateMs(b.createdAt) - asDateMs(a.createdAt))
    .slice(0, limit);

  const metricsByUser = await buildMetricsByUser([user._id]);
  const metrics = metricsByUser[user._id.toString()] || createEmptyMetrics();

  res.json({
    success: true,
    data: {
      user: {
        id: user._id.toString(),
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        role: user.role || "user",
        status: user.status || "active",
        phoneNumber: user.phoneNumber || "",
        country: user.country || "",
        kycStatus: user.kycStatus || "not_verified",
        kycVerified: Boolean(user.kycVerified),
        currencyCode: user.currencyCode || "USD",
        currencySymbol: user.currencySymbol || "$",
        balance: asNumber(user.balance),
        createdAt: toIsoStringOrNull(user.createdAt),
        updatedAt: toIsoStringOrNull(user.updatedAt),
      },
      metrics,
      activities,
      generatedAt: new Date().toISOString(),
    },
  });
});

export const listKycSubmissions = asyncHandler(async (req, res) => {
  const submissions = await Kyc.find()
    .populate("user")
    .sort({ createdAt: -1 });

  const data = submissions.map((item) => ({
    id: item._id.toString(),
    userId: item.user?._id?.toString() || item.user?.toString(),
    email: item.email || item.user?.email || "",
    name:
      `${item.legalName?.firstName || item.user?.firstName || ""} ${
        item.legalName?.lastName || item.user?.lastName || ""
      }`.trim() ||
      (item.user ? `${item.user.firstName || ""} ${item.user.lastName || ""}`.trim() : ""),
    status: item.status,
    legalFirstName: item.legalName?.firstName || item.user?.firstName || "",
    legalMiddleName: item.legalName?.middleName || "",
    legalLastName: item.legalName?.lastName || item.user?.lastName || "",
    dateOfBirth: item.dateOfBirth,
    phoneNumber: item.phoneNumber || item.user?.phoneNumber || "",
    countryOfResidence: item.countryOfResidence || item.user?.country || "",
    issuingCountry: item.issuingCountry || "",
    idType: item.idType || "",
    idNumber: item.idNumber || "",
    addressLine1: item.address?.line1 || "",
    addressLine2: item.address?.line2 || "",
    city: item.address?.city || "",
    stateProvince: item.address?.stateProvince || "",
    postalCode: item.address?.postalCode || "",
    governmentId: item.documents?.front || item.governmentId || "",
    governmentIdBack: item.documents?.back || item.governmentIdBack || "",
    selfie: item.documents?.selfie || item.selfie || "",
    reviewNotes: item.reviewNotes || "",
    reviewedAt: item.reviewedAt || null,
    submittedAt: item.submittedAt || item.createdAt,
  }));

  res.json({ success: true, data });
});

export const listReferralStats = asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 200, 20, 1000);

  const referrals = await Referral.find()
    .populate("referrer", "firstName lastName email")
    .populate("referred", "firstName lastName email createdAt")
    .sort({ createdAt: -1 })
    .limit(limit);

  const rows = referrals.map((item) => ({
    id: item._id.toString(),
    referrerId:
      item.referrer?._id?.toString() || item.referrer?.toString() || "",
    referrerName: item.referrer
      ? `${item.referrer.firstName || ""} ${item.referrer.lastName || ""}`.trim()
      : "Unknown",
    referrerEmail: item.referrer?.email || "",
    referredId:
      item.referred?._id?.toString() || item.referred?.toString() || "",
    referredName: item.referred
      ? `${item.referred.firstName || ""} ${item.referred.lastName || ""}`.trim()
      : "",
    referredEmail:
      item.referred?.email || item.referredEmail || "Pending user",
    status: item.status || "Pending",
    rewardAmount: asNumber(item.rewardAmount),
    rewardStatus: item.rewardStatus || "Pending",
    createdAt: toIsoStringOrNull(item.createdAt),
    updatedAt: toIsoStringOrNull(item.updatedAt),
  }));

  const totals = rows.reduce(
    (accumulator, row) => {
      accumulator.totalReferrals += 1;
      if (`${row.status}`.toLowerCase() === "active") {
        accumulator.activeReferrals += 1;
      }
      accumulator.totalRewardAmount += asNumber(row.rewardAmount);
      if (`${row.rewardStatus}`.toLowerCase() === "paid") {
        accumulator.paidRewards += asNumber(row.rewardAmount);
      }
      return accumulator;
    },
    {
      totalReferrals: 0,
      activeReferrals: 0,
      totalRewardAmount: 0,
      paidRewards: 0,
    }
  );

  res.json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      totals,
      referrals: rows,
    },
  });
});

export const listTransactions = asyncHandler(async (req, res) => {
  const transactions = await Transaction.find()
    .populate("user")
    .sort({ createdAt: -1 });

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
    balanceBefore: asNumber(tx.balanceBefore),
    balanceAfter: asNumber(tx.balanceAfter),
    actorRole: tx.actorRole || "user",
    actorLabel: tx.actorLabel || "",
    workflow: tx.workflow || {},
    destination: tx.metadata?.destination || {},
    metadata: tx.metadata || {},
    userId: tx.user?._id?.toString() || tx.user?.toString(),
    userName: tx.user
      ? `${tx.user.firstName || ""} ${tx.user.lastName || ""}`.trim()
      : "",
    userEmail: tx.user?.email || "",
  }));

  res.json({ success: true, data });
});

export const listSystemMetrics = asyncHandler(async (req, res) => {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    verifiedKycUsers,
    pendingKyc,
    completedKyc,
    rejectedKyc,
    pendingTransactions,
    completedTransactions,
    transactionVolume24hAgg,
    openTickets,
    pendingTickets,
    unreadForAdminThreads,
    activeTrades,
    activePlaceTrades,
    activeSignals,
    activeSubscriptions,
    activeCopyTrades,
    activeMining,
    activeStakes,
    sentEmails24h,
    failedEmails24h,
    ledgerEntries24h,
    depositingUsersAgg,
    tradingUsersAgg,
    withdrawingUsersAgg,
    matureUsers7d,
    retainedUsers7d,
    matureUsers30d,
    retainedUsers30d,
  ] = await Promise.all([
    User.countDocuments({ role: "user" }),
    User.countDocuments({ role: "user", status: "active" }),
    User.countDocuments({ role: "user", status: "suspended" }),
    User.countDocuments({ role: "user", kycVerified: true }),
    Kyc.countDocuments({ status: "pending" }),
    Kyc.countDocuments({ status: "verified" }),
    Kyc.countDocuments({ status: "rejected" }),
    Transaction.countDocuments({ status: "Pending" }),
    Transaction.countDocuments({ status: "Completed" }),
    Transaction.aggregate([
      {
        $match: {
          status: "Completed",
          createdAt: { $gte: dayAgo },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    SupportThread.countDocuments({ status: "open" }),
    SupportThread.countDocuments({ status: "pending" }),
    SupportThread.countDocuments({ unreadForAdmin: { $gt: 0 } }),
    Trade.countDocuments({ status: "Active" }),
    PlaceTrade.countDocuments({ status: "Active" }),
    Signal.countDocuments({
      status: { $regex: /^active$/i },
    }),
    Subscription.countDocuments({ status: "Active" }),
    CopyTrade.countDocuments({ status: "Active" }),
    Mining.countDocuments({ status: "Active" }),
    Stake.countDocuments({ status: "Active" }),
    OutboundNotification.countDocuments({
      status: "sent",
      createdAt: { $gte: dayAgo },
    }),
    OutboundNotification.countDocuments({
      status: "failed",
      createdAt: { $gte: dayAgo },
    }),
    BalanceLedger.countDocuments({
      createdAt: { $gte: dayAgo },
    }),
    Transaction.aggregate([
      { $match: { type: "Deposit", status: "Completed" } },
      { $group: { _id: "$user" } },
      { $count: "total" },
    ]),
    Transaction.aggregate([
      {
        $match: {
          type: { $in: ["Trade", "PlaceTrade", "CopyTrade"] },
        },
      },
      { $group: { _id: "$user" } },
      { $count: "total" },
    ]),
    Transaction.aggregate([
      { $match: { type: "Withdrawal" } },
      { $group: { _id: "$user" } },
      { $count: "total" },
    ]),
    User.countDocuments({
      role: "user",
      createdAt: { $lt: sevenDaysAgo },
    }),
    User.countDocuments({
      role: "user",
      createdAt: { $lt: sevenDaysAgo },
      lastLoginAt: { $gte: sevenDaysAgo },
    }),
    User.countDocuments({
      role: "user",
      createdAt: { $lt: thirtyDaysAgo },
    }),
    User.countDocuments({
      role: "user",
      createdAt: { $lt: thirtyDaysAgo },
      lastLoginAt: { $gte: thirtyDaysAgo },
    }),
  ]);

  const txVolume24h = asNumber(transactionVolume24hAgg?.[0]?.total);
  const depositingUsers = asNumber(depositingUsersAgg?.[0]?.total);
  const tradingUsers = asNumber(tradingUsersAgg?.[0]?.total);
  const withdrawingUsers = asNumber(withdrawingUsersAgg?.[0]?.total);
  const funnelBase = Math.max(totalUsers, 1);
  const kycConversionRate = (verifiedKycUsers / funnelBase) * 100;
  const depositConversionRate = (depositingUsers / funnelBase) * 100;
  const tradeConversionRate = (tradingUsers / funnelBase) * 100;
  const withdrawalConversionRate = (withdrawingUsers / funnelBase) * 100;
  const retention7dRate =
    matureUsers7d > 0 ? (retainedUsers7d / matureUsers7d) * 100 : 0;
  const retention30dRate =
    matureUsers30d > 0 ? (retainedUsers30d / matureUsers30d) * 100 : 0;
  const churnRisk30dRate =
    matureUsers30d > 0
      ? ((matureUsers30d - retainedUsers30d) / matureUsers30d) * 100
      : 0;

  res.json({
    success: true,
    data: {
      generatedAt: new Date(now).toISOString(),
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
      },
      emails: {
        sent24h: sentEmails24h,
        failed24h: failedEmails24h,
      },
      ledger: {
        entries24h: ledgerEntries24h,
      },
      kyc: {
        pending: pendingKyc,
        completed: completedKyc,
        rejected: rejectedKyc,
      },
      transactions: {
        pending: pendingTransactions,
        completed: completedTransactions,
        volume24h: txVolume24h,
      },
      support: {
        open: openTickets,
        pending: pendingTickets,
        unreadForAdmin: unreadForAdminThreads,
      },
      activeModules: {
        trades: activeTrades,
        placeTrades: activePlaceTrades,
        signals: activeSignals,
        subscriptions: activeSubscriptions,
        copyTrades: activeCopyTrades,
        mining: activeMining,
        stakes: activeStakes,
      },
      funnel: {
        signedUp: totalUsers,
        kycVerified: verifiedKycUsers,
        deposited: depositingUsers,
        firstTrade: tradingUsers,
        withdrawn: withdrawingUsers,
        kycConversionRate,
        depositConversionRate,
        tradeConversionRate,
        withdrawalConversionRate,
      },
      retention: {
        matureUsers7d,
        retainedUsers7d,
        retention7dRate,
        matureUsers30d,
        retainedUsers30d,
        retention30dRate,
        churnRisk30dRate,
      },
    },
  });
});

export const listBalanceLedger = asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 150, 20, 600);
  const userId = safeTrim(req.query.userId);
  const query = userId ? { user: userId } : {};

  const rows = await BalanceLedger.find(query)
    .populate("user", "firstName lastName email")
    .populate("actor", "firstName lastName email")
    .populate("transaction", "type status")
    .sort({ createdAt: -1 })
    .limit(limit);

  const data = rows.map((item) => ({
    id: item._id.toString(),
    eventKey: item.eventKey || "",
    sequence: asNumber(item.sequence),
    type: item.type || "",
    status: item.status || "",
    currency: item.currency || "USD",
    delta: asNumber(item.delta),
    amount: asNumber(item.amount),
    balanceBefore: asNumber(item.balanceBefore),
    balanceAfter: asNumber(item.balanceAfter),
    reasonKey: item.reasonKey || "",
    reasonLabel: item.reasonLabel || "",
    sourceFeature: item.sourceFeature || "",
    actorRole: item.actorRole || "system",
    actorLabel: item.actorLabel || "",
    details: item.details || "",
    previousHash: item.previousHash || "",
    entryHash: item.entryHash || "",
    metadata: item.metadata || {},
    transaction: item.transaction
      ? {
          id: item.transaction._id?.toString() || item.transaction.toString(),
          type: item.transaction.type || "",
          status: item.transaction.status || "",
        }
      : null,
    user: item.user
      ? {
          id: item.user._id?.toString() || item.user.toString(),
          name: `${item.user.firstName || ""} ${item.user.lastName || ""}`.trim(),
          email: item.user.email || "",
        }
      : null,
    actor: item.actor
      ? {
          id: item.actor._id?.toString() || item.actor.toString(),
          name: `${item.actor.firstName || ""} ${item.actor.lastName || ""}`.trim(),
          email: item.actor.email || "",
        }
      : null,
    createdAt: toIsoStringOrNull(item.createdAt),
    updatedAt: toIsoStringOrNull(item.updatedAt),
  }));

  res.json({
    success: true,
    data,
    totals: {
      count: data.length,
    },
    generatedAt: new Date().toISOString(),
  });
});

export const listAdminLogs = asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 120, 20, 500);
  const typeFilter = safeTrim(req.query.type).toLowerCase();
  const query = typeFilter ? { type: typeFilter } : {};

  const rows = await AdminEvent.find(query)
    .populate("actor", "firstName lastName email")
    .populate("targetUser", "firstName lastName email")
    .sort({ createdAt: -1 })
    .limit(limit);

  const data = rows.map((item) => ({
    id: item._id.toString(),
    type: item.type || "system",
    message: item.message || "",
    actor: item.actor
      ? {
          id: item.actor._id.toString(),
          name: `${item.actor.firstName || ""} ${item.actor.lastName || ""}`.trim(),
          email: item.actor.email || "",
        }
      : null,
    targetUser: item.targetUser
      ? {
          id: item.targetUser._id.toString(),
          name: `${item.targetUser.firstName || ""} ${item.targetUser.lastName || ""}`.trim(),
          email: item.targetUser.email || "",
        }
      : null,
    metadata: item.metadata || {},
    createdAt: toIsoStringOrNull(item.createdAt),
    updatedAt: toIsoStringOrNull(item.updatedAt),
  }));

  res.json({
    success: true,
    data,
    totals: {
      count: data.length,
    },
    generatedAt: new Date().toISOString(),
  });
});

export const broadcastAdminMessage = asyncHandler(async (req, res) => {
  const subjectInput = safeTrim(req.body.subject);
  const messageInput = safeTrim(req.body.message || req.body.body);
  const includeOnlyActive = req.body.onlyActive !== false;
  const planFilters = normalizePlanFilter(req.body.plans);

  if (!messageInput) {
    return res.status(400).json({
      success: false,
      message: "message is required",
    });
  }

  const subject = subjectInput || "Platform Broadcast";
  const query = { role: "user" };

  if (includeOnlyActive) {
    query.status = "active";
  }

  if (planFilters.length > 0) {
    query.subscriptionPlan = {
      $in: planFilters.map((plan) => new RegExp(`^${plan}$`, "i")),
    };
  }

  const recipients = await User.find(query)
    .select("_id firstName lastName email subscriptionPlan status")
    .sort({ createdAt: -1 })
    .limit(5000);

  if (recipients.length === 0) {
    return res.status(404).json({
      success: false,
      message: "No users matched broadcast target.",
    });
  }

  const now = new Date();
  const statusByPlan = {};
  const threads = recipients.map((user) => {
    const normalizedPlan = safeTrim(user.subscriptionPlan || "Basic") || "Basic";
    statusByPlan[normalizedPlan] = (statusByPlan[normalizedPlan] || 0) + 1;
    return {
      user: user._id,
      subject,
      status: "pending",
      unreadForUser: 1,
      unreadForAdmin: 0,
      lastMessageAt: now,
      messages: [
        {
          senderRole: "admin",
          sender: req.user._id,
          text: messageInput,
          readByUser: false,
          readByAdmin: true,
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  });

  await SupportThread.insertMany(threads, { ordered: false });

  await createAdminEvent({
    type: "broadcast",
    message: `Broadcast sent to ${recipients.length} users`,
    actorId: req.user?._id,
    metadata: {
      subject,
      onlyActive: includeOnlyActive,
      plans: planFilters,
      recipients: recipients.length,
      plansBreakdown: statusByPlan,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      subject,
      recipients: recipients.length,
      plansBreakdown: statusByPlan,
      sentAt: now.toISOString(),
    },
  });
});
