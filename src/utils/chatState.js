import CopyTrade from "../models/CopyTrade.js";
import Deposit from "../models/Deposit.js";
import Kyc from "../models/Kyc.js";
import Mining from "../models/Mining.js";
import PaymentProof from "../models/PaymentProof.js";
import PlaceTrade from "../models/PlaceTrade.js";
import RealEstate from "../models/RealEstate.js";
import Referral from "../models/Referral.js";
import Signal from "../models/Signal.js";
import Stake from "../models/Stake.js";
import Subscription from "../models/Subscription.js";
import SupportThread from "../models/SupportThread.js";
import Transaction from "../models/Transaction.js";
import Trade from "../models/Trade.js";
import Withdrawal from "../models/Withdrawal.js";
import BuyBot from "../models/BuyBot.js";

const normalizeStatus = (value) => `${value || ""}`.trim().toLowerCase();

const formatCurrency = (value, currencyCode = "USD") => {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeValue);
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeValue);
  }
};

const aggregateByStatus = (model, match, extraGroup = {}) =>
  model.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 }, ...extraGroup } }]);

const toStatusMap = (rows = []) =>
  rows.reduce((accumulator, row) => {
    accumulator[normalizeStatus(row._id)] = row;
    return accumulator;
  }, {});

const metric = (rows, status, key = "count") => Number(toStatusMap(rows)[status]?.[key]) || 0;
const metricFromMany = (rows, statuses, key = "count") =>
  statuses.reduce((total, status) => total + metric(rows, status, key), 0);
const sumKey = (rows, key) =>
  rows.reduce((total, row) => total + (Number(row?.[key]) || 0), 0);

const summarizeTransactions = (transactions = [], currencyCode = "USD") => {
  const latest = transactions[0];
  return {
    total: transactions.length,
    pending: transactions.filter((item) => normalizeStatus(item.status) === "pending").length,
    completed: transactions.filter((item) => normalizeStatus(item.status) === "completed").length,
    latestText: latest
      ? `${latest.type} ${formatCurrency(latest.amount, latest.currency || currencyCode)} (${latest.status})`
      : "No transactions recorded yet.",
  };
};

export const getUserChatState = async (user) => {
  if (!user) {
    return {
      isAuthenticated: false,
      currencyCode: "USD",
      balanceText: formatCurrency(0, "USD"),
      plan: "Basic",
      canMessageAdmin: false,
      kycVerified: false,
      kycStatus: "not_verified",
      transactionSummary: summarizeTransactions([], "USD"),
    };
  }

  const match = { user: user._id };
  const currencyCode = user.currencyCode || "USD";
  const [recentTransactions, deposits, withdrawals, paymentProofs, trades, placeTrades, copyTrades, subscriptions, signals, bots, miningRuns, stakes, realEstate, referrals, supportTotals, latestThread, latestKyc] = await Promise.all([
    Transaction.find(match).sort({ createdAt: -1 }).limit(5).lean(),
    aggregateByStatus(Deposit, match, { amountTotal: { $sum: "$amount" } }),
    aggregateByStatus(Withdrawal, match, { amountTotal: { $sum: "$amount" } }),
    aggregateByStatus(PaymentProof, match),
    aggregateByStatus(Trade, match, { profitLoss: { $sum: "$profitLoss" } }),
    aggregateByStatus(PlaceTrade, match, { profitLoss: { $sum: "$profitLoss" } }),
    aggregateByStatus(CopyTrade, match, {
      invested: { $sum: "$amount" },
      estimatedRevenue: { $sum: { $multiply: ["$amount", { $divide: ["$performance", 100] }] } },
    }),
    aggregateByStatus(Subscription, match),
    aggregateByStatus(Signal, match),
    aggregateByStatus(BuyBot, match, { budget: { $sum: "$budget" } }),
    aggregateByStatus(Mining, match, {
      rewardBalance: { $sum: "$rewardBalance" },
      hashRate: { $sum: "$hashRate" },
    }),
    aggregateByStatus(Stake, match, {
      principalUsd: { $sum: "$principalUsd" },
      rewardUsdTotal: { $sum: "$rewardUsdTotal" },
    }),
    aggregateByStatus(RealEstate, match, {
      amount: { $sum: "$amount" },
      expectedPayoutUsd: { $sum: "$expectedPayoutUsd" },
    }),
    aggregateByStatus(Referral, { referrer: user._id }, { rewardAmount: { $sum: "$rewardAmount" } }),
    SupportThread.aggregate([{ $match: match }, { $group: { _id: null, threadCount: { $sum: 1 }, unreadForUser: { $sum: "$unreadForUser" } } }]),
    SupportThread.findOne(match).sort({ lastMessageAt: -1 }).lean(),
    Kyc.findOne(match).sort({ createdAt: -1 }).lean(),
  ]);

  const plan = user.subscriptionPlan || "Basic";
  const kycStatus = normalizeStatus(user.kycStatus || latestKyc?.status || "not_verified");
  const activeCopyTrades = metricFromMany(copyTrades, ["active", "paused"]);
  const activeTrades = metric(trades, "active") + metric(placeTrades, "active") + activeCopyTrades;
  const grossRevenue =
    sumKey(trades, "profitLoss") +
    sumKey(placeTrades, "profitLoss") +
    sumKey(copyTrades, "estimatedRevenue") +
    sumKey(miningRuns, "rewardBalance") +
    sumKey(stakes, "rewardUsdTotal");
  const completedDepositsAmount = metric(deposits, "completed", "amountTotal");

  return {
    isAuthenticated: true,
    currencyCode,
    balanceText: formatCurrency(user.balance, currencyCode),
    plan,
    canMessageAdmin: ["platinum", "elite"].includes(normalizeStatus(plan)),
    kycVerified: Boolean(user.kycVerified) && kycStatus === "verified",
    kycStatus,
    transactionSummary: summarizeTransactions(recentTransactions, currencyCode),
    deposits: {
      pendingCount: metric(deposits, "pending"),
      completedCount: metric(deposits, "completed"),
      pendingAmountText: formatCurrency(metric(deposits, "pending", "amountTotal"), currencyCode),
      completedAmountText: formatCurrency(completedDepositsAmount, currencyCode),
    },
    withdrawals: {
      pendingCount: metric(withdrawals, "pending"),
      completedCount: metric(withdrawals, "completed"),
      pendingAmountText: formatCurrency(metric(withdrawals, "pending", "amountTotal"), currencyCode),
      completedAmountText: formatCurrency(metric(withdrawals, "completed", "amountTotal"), currencyCode),
    },
    paymentProofs: {
      pendingCount: metric(paymentProofs, "pending"),
      approvedCount: metric(paymentProofs, "approved"),
    },
    trading: {
      activeCount: activeTrades,
      activeSpot: metric(trades, "active"),
      activePlace: metric(placeTrades, "active"),
      activeCopy: activeCopyTrades,
      pnlText: formatCurrency(sumKey(trades, "profitLoss") + sumKey(placeTrades, "profitLoss"), currencyCode),
      copyInvestedText: formatCurrency(sumKey(copyTrades, "invested"), currencyCode),
    },
    products: {
      subscriptionCount: metric(subscriptions, "active"),
      signalCount: metric(signals, "active"),
      botCount: metric(bots, "active"),
      botBudgetText: formatCurrency(sumKey(bots, "budget"), currencyCode),
      miningCount: metric(miningRuns, "active"),
      miningRewardText: formatCurrency(sumKey(miningRuns, "rewardBalance"), currencyCode),
      stakeCount: metric(stakes, "active"),
      stakePrincipalText: formatCurrency(sumKey(stakes, "principalUsd"), currencyCode),
      realEstateCount: metric(realEstate, "active"),
      realEstateAmountText: formatCurrency(sumKey(realEstate, "amount"), currencyCode),
    },
    referrals: {
      totalCount: metricFromMany(referrals, ["pending", "active"]),
      activeCount: metric(referrals, "active"),
      earningsText: formatCurrency(sumKey(referrals, "rewardAmount"), currencyCode),
    },
    support: {
      threadCount: Number(supportTotals[0]?.threadCount) || 0,
      unreadCount: Number(supportTotals[0]?.unreadForUser) || 0,
      latestSubject: latestThread?.subject || "",
    },
    grossRevenueText: formatCurrency(grossRevenue, currencyCode),
  };
};
