import CopyTrade from "../models/CopyTrade.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCopyTradeMetrics } from "../utils/investmentMetrics.js";
import { applyBalanceChange, roundCurrency } from "../utils/walletLedger.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const formatUsd = (value) => `$${Number(value || 0).toFixed(2)}`;

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const safeText = (value, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

const normalizeStatus = (value, fallback = "Active") => {
  const lowered = `${value || ""}`.trim().toLowerCase();
  if (lowered === "paused") return "Paused";
  if (lowered === "active") return "Active";
  if (lowered === "cancelled" || lowered === "canceled") return "Cancelled";
  if (lowered === "completed") return "Completed";
  return fallback;
};

const getDisplayName = (trade = {}) =>
  safeText(trade?.traderName) ||
  safeText(trade?.traderData?.name) ||
  safeText(trade?.sourceTraderId) ||
  "Copy Trader";

const getClaimBreakdown = (trade) => {
  const metrics = getCopyTradeMetrics(trade);
  const accruedProfit = roundCurrency(metrics.accruedProfit);
  const alreadySettled = roundCurrency(trade?.realizedProfit);
  const claimableProfit = Math.max(0, roundCurrency(accruedProfit - alreadySettled));

  return {
    metrics,
    accruedProfit,
    alreadySettled,
    claimableProfit,
  };
};

export const copyTradeController = {
  create: asyncHandler(async (req, res) => {
    const amount = toPositiveNumber(req.body.amount);
    if (!amount) {
      return res.status(400).json({
        success: false,
        message: "Copy trade amount must be greater than zero",
      });
    }

    const payload = {
      user: req.user._id,
      sourceTraderId: safeText(req.body.sourceTraderId),
      traderName: safeText(req.body.traderName),
      amount,
      status: "Active",
      performance: toPositiveNumber(req.body.performance),
      profitShare: toPositiveNumber(
        req.body.profitShare,
        toPositiveNumber(req.body?.traderData?.profitShare)
      ),
      realizedProfit: 0,
      lastProfitSettledAt: null,
      traderData:
        req.body?.traderData && typeof req.body.traderData === "object"
          ? req.body.traderData
          : {},
    };

    let doc = null;
    try {
      doc = await CopyTrade.create(payload);
      const traderName = getDisplayName(doc);

      await applyBalanceChange({
        user: req.user,
        delta: -amount,
        type: "CopyTrade",
        paymentMethod: traderName,
        details: `Copy trade started: ${traderName}`,
        sourceFeature: "trading",
        actorRole: "user",
        actor: req.user?._id || null,
        actorLabel: req.user?.email || "",
        metadata: {
          copyTradeId: doc._id.toString(),
          traderName,
          phase: "opened",
          capital: amount,
        },
      });

      await sendUserNotificationEmail({
        user: req.user,
        type: "copy_trade",
        subject: "Copy trade started",
        headline: `You started copying ${traderName}`,
        intro:
          "CoinQuestX activated a new copy trade and moved the selected capital into your copied strategy allocation.",
        bullets: [
          `Trader: ${traderName}`,
          `Capital allocated: ${formatUsd(amount)}`,
          `Status: Active`,
        ],
        metadata: {
          copyTradeId: doc._id.toString(),
          traderName,
          amount,
          phase: "opened",
        },
      });
    } catch (error) {
      if (doc?._id) {
        await CopyTrade.findByIdAndDelete(doc._id).catch(() => {});
      }
      throw error;
    }

    return res.status(201).json({
      success: true,
      data: doc,
    });
  }),

  claim: asyncHandler(async (req, res) => {
    const requestedIds = Array.isArray(req.body?.tradeIds)
      ? req.body.tradeIds.map((value) => `${value || ""}`.trim()).filter(Boolean)
      : [];

    const filter = {
      user: req.user._id,
      status: { $in: ["Active", "Paused"] },
    };
    if (requestedIds.length) {
      filter._id = { $in: requestedIds };
    }

    const rows = await CopyTrade.find(filter).sort({ createdAt: -1 });
    const payoutRows = rows
      .map((trade) => {
        const { accruedProfit, claimableProfit } = getClaimBreakdown(trade);
        if (claimableProfit <= 0) return null;
        return {
          trade,
          accruedProfit,
          claimableProfit,
          traderName: getDisplayName(trade),
        };
      })
      .filter(Boolean);

    if (!payoutRows.length) {
      return res.json({
        success: true,
        data: {
          claimedAmount: 0,
          trades: [],
          balance: roundCurrency(req.user.balance),
        },
      });
    }

    const claimedAmount = roundCurrency(
      payoutRows.reduce((sum, row) => sum + row.claimableProfit, 0)
    );
    const settledAt = new Date();

    payoutRows.forEach((row) => {
      row.trade.realizedProfit = row.accruedProfit;
      row.trade.lastProfitSettledAt = settledAt;
    });
    await Promise.all(payoutRows.map((row) => row.trade.save()));

    const balanceChange = await applyBalanceChange({
      user: req.user,
      delta: claimedAmount,
      type: "CopyTrade",
      paymentMethod: "Copy Trade Profit",
      details: `Copy trade profit claimed from ${payoutRows.length} trader${payoutRows.length === 1 ? "" : "s"}`,
      sourceFeature: "trading",
      actorRole: "system",
      actor: req.user?._id || null,
      actorLabel: "Copy Trade Engine",
      metadata: {
        phase: "profit_claim",
        tradeCount: payoutRows.length,
        payoutBreakdown: payoutRows.map((row) => ({
          copyTradeId: row.trade._id.toString(),
          traderName: row.traderName,
          amount: row.claimableProfit,
        })),
      },
    });

    await sendUserNotificationEmail({
      user: req.user,
      type: "copy_trade",
      subject: "Copy trade profit claimed",
      headline: "Your copy trade profit was credited",
      intro:
        "CoinQuestX settled the currently claimable copy trade profit and credited it back to your wallet.",
      bullets: [
        `Claimed amount: ${formatUsd(claimedAmount)}`,
        `Trader count: ${payoutRows.length}`,
        `New balance: ${formatUsd(balanceChange.balance)}`,
      ],
      metadata: {
        phase: "profit_claim",
        tradeCount: payoutRows.length,
        claimedAmount,
      },
    });

    return res.json({
      success: true,
      data: {
        claimedAmount,
        balance: balanceChange.balance,
        trades: payoutRows.map((row) => ({
          id: row.trade._id.toString(),
          traderName: row.traderName,
          claimedAmount: row.claimableProfit,
          settledProfit: row.accruedProfit,
          lastProfitSettledAt: settledAt,
        })),
      },
    });
  }),

  list: asyncHandler(async (req, res) => {
    const docs = await CopyTrade.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  }),

  getById: asyncHandler(async (req, res) => {
    const doc = await CopyTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "CopyTrade not found",
      });
    }

    res.json({ success: true, data: doc });
  }),

  update: asyncHandler(async (req, res) => {
    const doc = await CopyTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "CopyTrade not found",
      });
    }

    if (req.body.status !== undefined) {
      doc.status = normalizeStatus(req.body.status, doc.status);
    }

    if (req.body.traderName !== undefined) {
      doc.traderName = safeText(req.body.traderName, doc.traderName);
    }

    if (req.body.traderData && typeof req.body.traderData === "object") {
      doc.traderData = {
        ...(doc.traderData || {}),
        ...req.body.traderData,
      };
    }

    await doc.save();
    res.json({ success: true, data: doc });
  }),

  remove: asyncHandler(async (req, res) => {
    const doc = await CopyTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "CopyTrade not found",
      });
    }

    const traderName = getDisplayName(doc);
    const { alreadySettled, claimableProfit } = getClaimBreakdown(doc);
    const settlementAmount = roundCurrency(doc.amount + claimableProfit);

    if (settlementAmount > 0) {
      await applyBalanceChange({
        user: req.user,
        delta: settlementAmount,
        type: "CopyTrade",
        paymentMethod: traderName,
        details: `Copy trade closed: ${traderName}`,
        sourceFeature: "trading",
        actorRole: "system",
        actor: req.user?._id || null,
        actorLabel: "Copy Trade Engine",
        metadata: {
          copyTradeId: doc._id.toString(),
          traderName,
          phase: "closed",
          principal: roundCurrency(doc.amount),
          alreadySettledProfit: alreadySettled,
          pendingProfit: claimableProfit,
          settlementAmount,
        },
      });
    }

    await sendUserNotificationEmail({
      user: req.user,
      type: "copy_trade",
      subject: "Copy trade closed",
      headline: `Your copy trade with ${traderName} is closed`,
      intro:
        "CoinQuestX settled the copied position and returned the remaining capital and unclaimed profit to your wallet.",
      bullets: [
        `Trader: ${traderName}`,
        `Settlement amount: ${formatUsd(settlementAmount)}`,
        `Unclaimed profit included: ${formatUsd(claimableProfit)}`,
      ],
      metadata: {
        copyTradeId: doc._id.toString(),
        traderName,
        settlementAmount,
        profitLoss: roundCurrency(claimableProfit),
        phase: "closed",
      },
    });

    await CopyTrade.deleteOne({ _id: doc._id });

    res.json({
      success: true,
      data: {
        id: doc._id.toString(),
        traderName,
        settlementAmount,
        profitLoss: roundCurrency(claimableProfit),
      },
    });
  }),
};
