import PlaceTrade from "../models/PlaceTrade.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizeResultInput = (value) => {
  const normalized = `${value || ""}`.trim().toLowerCase();
  if (normalized === "win" || normalized === "won") return "Win";
  if (normalized === "loss" || normalized === "lost") return "Loss";
  return null;
};

const buildSettlementSeed = (trade) =>
  `${trade?._id || ""}:${trade?.asset || ""}:${trade?.startTime || 0}:${trade?.amount || 0}:${trade?.direction || ""}`;

const hashSeed = (seed) =>
  [...`${seed || ""}`].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % 1000003,
    17
  );

const resolveSettlement = (trade, payload = {}) => {
  const explicitResult = normalizeResultInput(payload.result);
  const storedResult = normalizeResultInput(trade?.result);
  const amount = roundCurrency(trade?.amount);
  const seedValue = hashSeed(buildSettlementSeed(trade));
  const outcome =
    explicitResult || storedResult || (seedValue % 100 < 56 ? "Win" : "Loss");

  let profitLoss = Number(payload.profitLoss);
  if (!Number.isFinite(profitLoss)) {
    const swing = 0.06 + (seedValue % 7) * 0.01;
    profitLoss = roundCurrency(amount * swing);
    if (outcome === "Loss") {
      profitLoss = -profitLoss;
    }
  }

  if (outcome === "Win" && profitLoss < 0) {
    profitLoss = Math.abs(profitLoss);
  }
  if (outcome === "Loss" && profitLoss > 0) {
    profitLoss = -profitLoss;
  }

  const settlementAmount = trade?.stakeReserved
    ? Math.max(0, roundCurrency(amount + profitLoss))
    : roundCurrency(profitLoss);

  return {
    outcome,
    profitLoss: roundCurrency(profitLoss),
    settlementAmount: roundCurrency(settlementAmount),
  };
};

const buildTradeOpenTransaction = ({ user, trade, currentBalance, nextBalance }) =>
  Transaction.create({
    user: user._id,
    type: "PlaceTrade",
    amount: roundCurrency(trade.amount),
    currency: user?.currencyCode || "USD",
    paymentMethod: "PlaceTrade",
    status: "Completed",
    details: `Opened place trade ${trade.asset || trade._id.toString()}`,
    sourceFeature: "trading",
    balanceBefore: currentBalance,
    balanceAfter: nextBalance,
    actorRole: "user",
    actor: user?._id || null,
    actorLabel: user?.email || "",
    workflow: {
      submittedAt: trade.createdAt || new Date(),
      completedAt: trade.createdAt || new Date(),
    },
    metadata: {
      tradeId: trade._id.toString(),
      asset: trade.asset || "",
      direction: trade.direction || "",
      entryDirection: "debit",
      phase: "opened",
      reservedStake: true,
    },
  });

const buildTradeSettlementTransaction = ({
  user,
  trade,
  currentBalance,
  nextBalance,
  settlementAmount,
}) =>
  Transaction.create({
    user: user._id,
    type: "PlaceTrade",
    amount: Math.abs(roundCurrency(settlementAmount)),
    currency: user?.currencyCode || "USD",
    paymentMethod: "PlaceTrade",
    status: "Completed",
    details: `Place trade ${trade.asset || trade._id.toString()} settled ${trade.result}`,
    sourceFeature: "trading",
    balanceBefore: currentBalance,
    balanceAfter: nextBalance,
    actorRole: "system",
    actor: user?._id || null,
    actorLabel: "Place Trade Engine",
    workflow: {
      submittedAt: trade.createdAt || trade.startTime || new Date(),
      completedAt: new Date(),
    },
    metadata: {
      tradeId: trade._id.toString(),
      asset: trade.asset || "",
      direction: trade.direction || "",
      profitLoss: roundCurrency(trade.profitLoss),
      settlementAmount: roundCurrency(settlementAmount),
      principal: roundCurrency(trade.amount),
      entryDirection: settlementAmount >= 0 ? "credit" : "debit",
      phase: "settled",
      reservedStake: !!trade.stakeReserved,
      result: trade.result,
    },
  });

const buildSettlementResponse = (trade, balance) => ({
  id: trade._id.toString(),
  status: trade.status,
  result: trade.result,
  profitLoss: roundCurrency(trade.profitLoss),
  newBalance: roundCurrency(balance),
  settlementAmount: trade.stakeReserved
    ? roundCurrency(trade.amount + trade.profitLoss)
    : roundCurrency(trade.profitLoss),
});

export const placeTradeController = {
  create: asyncHandler(async (req, res) => {
    const amount = roundCurrency(req.body.amount);
    if (!amount || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Trade amount must be greater than zero",
      });
    }

    const user = req.user;
    const currentBalance = roundCurrency(user?.balance);
    if (currentBalance < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance to open this trade",
      });
    }

    const payload = {
      ...req.body,
      user: user._id,
      amount,
      status: "Active",
      result: "Pending",
      profitLoss: 0,
      stakeReserved: true,
      settledAt: null,
    };

    const nextBalance = roundCurrency(currentBalance - amount);
    let trade = null;

    try {
      user.balance = nextBalance;
      await user.save();

      trade = await PlaceTrade.create(payload);
      await buildTradeOpenTransaction({
        user,
        trade,
        currentBalance,
        nextBalance,
      });

      res.status(201).json({
        success: true,
        data: trade,
        meta: {
          balanceBefore: currentBalance,
          balanceAfter: nextBalance,
        },
      });
    } catch (error) {
      if (trade?._id) {
        await PlaceTrade.findByIdAndDelete(trade._id).catch(() => {});
      }
      user.balance = currentBalance;
      await user.save().catch(() => {});
      throw error;
    }
  }),

  list: asyncHandler(async (req, res) => {
    const docs = await PlaceTrade.find({ user: req.user._id }).sort({
      createdAt: -1,
    });
    res.json({ success: true, data: docs });
  }),

  getById: asyncHandler(async (req, res) => {
    const doc = await PlaceTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "PlaceTrade not found",
      });
    }

    res.json({ success: true, data: doc });
  }),

  update: asyncHandler(async (req, res) => {
    const doc = await PlaceTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "PlaceTrade not found",
      });
    }

    const allowedFields = [
      "asset",
      "tradeType",
      "direction",
      "duration",
      "durationMs",
      "lotSize",
      "takeProfit",
      "stopLoss",
      "entryPrice",
      "startTime",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        doc[field] = req.body[field];
      }
    });

    await doc.save();
    res.json({ success: true, data: doc });
  }),

  complete: asyncHandler(async (req, res) => {
    const tradeId = req.params.id || req.body.tradeId;
    if (!tradeId) {
      return res.status(400).json({
        success: false,
        message: "tradeId is required",
      });
    }

    const existingTrade = await PlaceTrade.findOne({
      _id: tradeId,
      user: req.user._id,
    });

    if (!existingTrade) {
      return res.status(404).json({
        success: false,
        message: "PlaceTrade not found",
      });
    }

    const existingResult = normalizeResultInput(existingTrade.result);
    if (existingTrade.status === "Completed" && existingResult) {
      return res.json({
        success: true,
        data: buildSettlementResponse(existingTrade, req.user.balance),
      });
    }

    if (existingTrade.status !== "Active") {
      return res.status(409).json({
        success: false,
        message: "This place trade is no longer active",
      });
    }

    const { outcome, profitLoss, settlementAmount } = resolveSettlement(
      existingTrade,
      req.body
    );
    const settledAt = new Date();

    try {
      const trade = await PlaceTrade.findOneAndUpdate(
        {
          _id: tradeId,
          user: req.user._id,
          status: "Active",
        },
        {
          $set: {
            status: "Completed",
            result: outcome,
            profitLoss,
            settledAt,
          },
        },
        { new: true }
      );

      if (!trade) {
        const latestTrade = await PlaceTrade.findOne({
          _id: tradeId,
          user: req.user._id,
        });

        if (!latestTrade) {
          return res.status(404).json({
            success: false,
            message: "PlaceTrade not found",
          });
        }

        const latestUser = await User.findById(req.user._id).select("balance");

        return res.json({
          success: true,
          data: buildSettlementResponse(latestTrade, latestUser?.balance ?? req.user.balance),
        });
      }

      const user = await User.findById(req.user._id).select(
        "email balance currencyCode firstName lastName notificationSettings"
      );
      if (!user) {
        throw new Error("User not found during place trade settlement");
      }

      const currentBalance = roundCurrency(user.balance);
      const nextBalance = Math.max(
        0,
        roundCurrency(currentBalance + settlementAmount)
      );

      user.balance = nextBalance;
      await user.save();

      await buildTradeSettlementTransaction({
        user,
        trade,
        currentBalance,
        nextBalance,
        settlementAmount,
      });

      try {
        await sendUserNotificationEmail({
          user,
          type: "trade_close",
          subject: "Place trade settled",
          headline: `Your ${trade.asset || "place trade"} closed ${trade.result.toLowerCase()}`,
          intro:
            "CoinQuestX settled your place trade and posted the result to your wallet ledger.",
          bullets: [
            `Result: ${trade.result}`,
            `Profit/Loss: $${Number(trade.profitLoss || 0).toFixed(2)}`,
            `Settlement amount: $${Number(settlementAmount || 0).toFixed(2)}`,
            `New balance: $${Number(nextBalance || 0).toFixed(2)}`,
          ],
          metadata: {
            tradeId: trade._id.toString(),
            result: trade.result,
            profitLoss: trade.profitLoss,
            settlementAmount,
          },
        });
      } catch (notificationError) {
        console.error("Failed to send place trade settlement email:", notificationError);
      }

      req.user.balance = nextBalance;

      return res.json({
        success: true,
        data: buildSettlementResponse(trade, nextBalance),
      });
    } catch (error) {
      throw error;
    }
  }),

  remove: asyncHandler(async (req, res) => {
    const doc = await PlaceTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "PlaceTrade not found",
      });
    }

    if (doc.status === "Active" && doc.stakeReserved) {
      const currentBalance = roundCurrency(req.user.balance);
      const refundAmount = roundCurrency(doc.amount);
      const nextBalance = roundCurrency(currentBalance + refundAmount);

      req.user.balance = nextBalance;
      await req.user.save();

      await Transaction.create({
        user: req.user._id,
        type: "PlaceTrade",
        amount: refundAmount,
        currency: req.user?.currencyCode || "USD",
        paymentMethod: "PlaceTrade",
        status: "Completed",
        details: `Cancelled place trade ${doc.asset || doc._id.toString()}`,
        sourceFeature: "trading",
        balanceBefore: currentBalance,
        balanceAfter: nextBalance,
        actorRole: "user",
        actor: req.user?._id || null,
        actorLabel: req.user?.email || "",
        workflow: {
          submittedAt: doc.createdAt || new Date(),
          completedAt: new Date(),
        },
        metadata: {
          tradeId: doc._id.toString(),
          entryDirection: "credit",
          phase: "cancelled",
          reservedStake: true,
        },
      });
    }

    await PlaceTrade.deleteOne({ _id: doc._id });
    res.json({ success: true, data: { id: doc._id.toString() } });
  }),
};
