import BuyBot from "../models/BuyBot.js";
import Mining from "../models/Mining.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { applyBalanceChange, roundCurrency } from "../utils/walletLedger.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const NETWORK_BOOST_PER_ACTIVE_MINER = 0.08;
const FLEET_BOOST_PER_PURCHASED_BOT = 0.12;
const SELECTED_BOT_LEVEL_BOOST_DIVISOR = 65;

const COIN_CONFIG = {
  BTC: { price: 30000, rate: 0.00000002 },
  ETH: { price: 2000, rate: 0.0000005 },
  LTC: { price: 90, rate: 0.000005 },
  DOGE: { price: 0.12, rate: 0.0001 },
  SOL: { price: 160, rate: 0.000001 },
};

const formatUsd = (value) => `$${Number(value || 0).toFixed(2)}`;

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const safeText = (value, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

const toDate = (value, fallback = null) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const normalizeStatus = (value, fallback = "Active") => {
  const lowered = `${value || ""}`.trim().toLowerCase();
  if (lowered === "paused") return "Paused";
  if (lowered === "completed") return "Completed";
  if (lowered === "active") return "Active";
  return fallback;
};

const calculateBotCost = (hashRate) => roundCurrency(toPositiveNumber(hashRate) / 100);

const getSelectedBoostLevel = (activeBuyBots, selectedBoostBotId) => {
  const selectedId = Number(selectedBoostBotId);
  if (!Number.isFinite(selectedId) || selectedId <= 0) return 0;

  const selectedBot = activeBuyBots.find(
    (bot) => Number(bot?.settings?.botId) === selectedId
  );
  return toPositiveNumber(selectedBot?.settings?.level);
};

const getMiningMultiplier = ({
  activeMiningBotCount,
  activeBuyBotCount,
  selectedBoostLevel,
}) => {
  const networkBoostMultiplier =
    1 + Math.max(0, activeMiningBotCount - 1) * NETWORK_BOOST_PER_ACTIVE_MINER;
  const fleetBoostMultiplier =
    1 + Math.max(0, activeBuyBotCount) * FLEET_BOOST_PER_PURCHASED_BOT;
  const selectedBoostMultiplier =
    selectedBoostLevel > 0
      ? 1 + selectedBoostLevel / SELECTED_BOT_LEVEL_BOOST_DIVISOR
      : 1;

  return networkBoostMultiplier * fleetBoostMultiplier * selectedBoostMultiplier;
};

const accrueBotUsd = (doc, multiplier, now = new Date()) => {
  if (doc.status !== "Active") return 0;

  const config = COIN_CONFIG[doc.asset];
  if (!config) return 0;

  const lastCheckpoint = toDate(doc.lastClaimedAt, toDate(doc.createdAt, now)) || now;
  const elapsedMs = Math.max(0, now.getTime() - lastCheckpoint.getTime());
  if (!elapsedMs) return 0;

  const coinPerSecond = toPositiveNumber(doc.hashRate) * config.rate * multiplier;
  const usdPerSecond = coinPerSecond * config.price;
  return roundCurrency(usdPerSecond * (elapsedMs / 1000));
};

const buildContext = async (userId, selectedBoostBotId = null) => {
  const [activeMiningBots, activeBuyBots] = await Promise.all([
    Mining.find({ user: userId, status: "Active" }).select("_id"),
    BuyBot.find({ user: userId, status: "Active" }).select("settings"),
  ]);

  return {
    activeMiningBotCount: activeMiningBots.length,
    activeBuyBotCount: activeBuyBots.length,
    selectedBoostLevel: getSelectedBoostLevel(activeBuyBots, selectedBoostBotId),
  };
};

export const miningController = {
  create: asyncHandler(async (req, res) => {
    const asset = safeText(req.body.asset).toUpperCase();
    const hashRate = toPositiveNumber(req.body.hashRate);

    if (!COIN_CONFIG[asset]) {
      return res.status(400).json({
        success: false,
        message: "Unsupported mining asset",
      });
    }

    if (!hashRate) {
      return res.status(400).json({
        success: false,
        message: "hashRate must be greater than zero",
      });
    }

    const activationCost = calculateBotCost(hashRate);
    let doc = null;

    try {
      doc = await Mining.create({
        user: req.user._id,
        asset,
        hashRate,
        boostBotId: Number.isFinite(Number(req.body.boostBotId))
          ? Number(req.body.boostBotId)
          : null,
        rewardBalance: 0,
        totalPaidUsd: 0,
        lastClaimedAt: new Date(),
        status: "Active",
      });

      await applyBalanceChange({
        user: req.user,
        delta: -activationCost,
        type: "Mining",
        paymentMethod: asset,
        details: `Mining bot activated: ${asset}`,
        sourceFeature: "mining",
        actorRole: "user",
        actor: req.user?._id || null,
        actorLabel: req.user?.email || "",
        metadata: {
          miningId: doc._id.toString(),
          asset,
          hashRate,
          activationCost,
          phase: "opened",
        },
      });

      await sendUserNotificationEmail({
        user: req.user,
        type: "investment",
        subject: "Mining rig activated",
        headline: `Your ${asset} mining rig is active`,
        intro:
          "CoinQuestX activated your mining position and deducted the setup cost from your wallet.",
        bullets: [
          `Asset: ${asset}`,
          `Hash rate: ${hashRate}`,
          `Activation cost: ${formatUsd(activationCost)}`,
        ],
        metadata: {
          miningId: doc._id.toString(),
          asset,
          phase: "opened",
        },
      });
    } catch (error) {
      if (doc?._id) {
        await Mining.findByIdAndDelete(doc._id).catch(() => {});
      }
      throw error;
    }

    res.status(201).json({ success: true, data: doc });
  }),

  claim: asyncHandler(async (req, res) => {
    const requestedIds = Array.isArray(req.body?.botIds)
      ? req.body.botIds.map((value) => `${value || ""}`.trim()).filter(Boolean)
      : [];
    const filter = { user: req.user._id };
    if (requestedIds.length) {
      filter._id = { $in: requestedIds };
    }

    const docs = await Mining.find(filter).sort({ createdAt: -1 });
    const context = await buildContext(req.user._id, req.body?.selectedBoostBotId);
    const multiplier = getMiningMultiplier(context);
    const now = new Date();

    const payoutRows = docs.map((doc) => {
      const accrued = accrueBotUsd(doc, multiplier, now);
      if (accrued > 0) {
        doc.rewardBalance = roundCurrency(toPositiveNumber(doc.rewardBalance) + accrued);
        doc.lastClaimedAt = now;
      }

      const claimable = Math.max(
        0,
        roundCurrency(toPositiveNumber(doc.rewardBalance) - toPositiveNumber(doc.totalPaidUsd))
      );

      if (claimable > 0) {
        doc.totalPaidUsd = roundCurrency(toPositiveNumber(doc.totalPaidUsd) + claimable);
      }

      return {
        doc,
        claimable,
      };
    });

    await Promise.all(payoutRows.map((row) => row.doc.save()));

    const claimBreakdown = payoutRows.filter((row) => row.claimable > 0);
    const payoutAmount = roundCurrency(
      claimBreakdown.reduce((sum, row) => sum + row.claimable, 0)
    );

    let nextBalance = roundCurrency(req.user.balance);
    if (payoutAmount > 0) {
      const balanceChange = await applyBalanceChange({
        user: req.user,
        delta: payoutAmount,
        type: "Mining",
        paymentMethod: "Mining Claim",
        details: `Mining payout credited from ${claimBreakdown.length} rig${claimBreakdown.length === 1 ? "" : "s"}`,
        sourceFeature: "mining",
        actorRole: "system",
        actor: req.user?._id || null,
        actorLabel: "Mining Engine",
        metadata: {
          phase: "claim",
          rigCount: claimBreakdown.length,
          payoutBreakdown: claimBreakdown.map((row) => ({
            miningId: row.doc._id.toString(),
            asset: row.doc.asset,
            amount: row.claimable,
          })),
        },
      });
      nextBalance = balanceChange.balance;

      await sendUserNotificationEmail({
        user: req.user,
        type: "investment",
        subject: "Mining payout claimed",
        headline: "Your mining payout was credited",
        intro:
          "CoinQuestX settled the currently claimable mining rewards and credited them back to your wallet.",
        bullets: [
          `Payout amount: ${formatUsd(payoutAmount)}`,
          `Rig count: ${claimBreakdown.length}`,
          `New balance: ${formatUsd(nextBalance)}`,
        ],
        metadata: {
          phase: "claim",
          rigCount: claimBreakdown.length,
          payoutAmount,
        },
      });
    }

    res.json({
      success: true,
      data: {
        payoutAmount,
        balance: nextBalance,
        rigs: payoutRows.map((row) => ({
          id: row.doc._id.toString(),
          asset: row.doc.asset,
          status: row.doc.status,
          rewardBalance: roundCurrency(row.doc.rewardBalance),
          totalPaidUsd: roundCurrency(row.doc.totalPaidUsd),
          claimable: row.claimable,
          lastClaimedAt: row.doc.lastClaimedAt,
        })),
      },
    });
  }),

  list: asyncHandler(async (req, res) => {
    const docs = await Mining.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  }),

  getById: asyncHandler(async (req, res) => {
    const doc = await Mining.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Mining not found",
      });
    }
    res.json({ success: true, data: doc });
  }),

  update: asyncHandler(async (req, res) => {
    const doc = await Mining.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Mining not found",
      });
    }

    const nextStatus = normalizeStatus(req.body.status, doc.status);
    if (doc.status === "Active" && nextStatus !== "Active") {
      const context = await buildContext(req.user._id, doc.boostBotId);
      const multiplier = getMiningMultiplier(context);
      const accrued = accrueBotUsd(doc, multiplier, new Date());
      if (accrued > 0) {
        doc.rewardBalance = roundCurrency(toPositiveNumber(doc.rewardBalance) + accrued);
      }
      doc.lastClaimedAt = new Date();
    }

    if (doc.status !== "Active" && nextStatus === "Active") {
      doc.lastClaimedAt = new Date();
    }

    if (req.body.asset !== undefined) {
      const nextAsset = safeText(req.body.asset, doc.asset).toUpperCase();
      if (COIN_CONFIG[nextAsset]) {
        doc.asset = nextAsset;
      }
    }
    if (req.body.hashRate !== undefined) {
      doc.hashRate = toPositiveNumber(req.body.hashRate, doc.hashRate);
    }
    if (req.body.boostBotId !== undefined) {
      const parsedBoostId = Number(req.body.boostBotId);
      doc.boostBotId = Number.isFinite(parsedBoostId) ? parsedBoostId : null;
    }
    doc.status = nextStatus;

    await doc.save();
    res.json({ success: true, data: doc });
  }),

  remove: asyncHandler(async (req, res) => {
    const doc = await Mining.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Mining not found",
      });
    }
    res.json({ success: true, data: { id: doc._id.toString() } });
  }),
};
