import Stake from "../models/Stake.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { applyBalanceChange, roundCurrency } from "../utils/walletLedger.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const formatUsd = (value) => `$${Number(value || 0).toFixed(2)}`;

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const toDate = (value, fallback = null) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const safeText = (value, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

const buildStakePayload = (body = {}) => {
  const startedAt = toDate(body.startedAt, new Date());
  const durationDays = Math.max(1, Math.round(toPositiveNumber(body.durationDays, 30)));
  const endsAt =
    toDate(body.endsAt) ||
    new Date(startedAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

  return {
    reference: safeText(body.reference),
    asset: safeText(body.asset),
    coingeckoId: safeText(body.coingeckoId),
    amount: toPositiveNumber(body.amount),
    principalUsd: toPositiveNumber(body.principalUsd),
    apy: toPositiveNumber(body.apy),
    durationDays,
    rewardUsdTotal: toPositiveNumber(body.rewardUsdTotal),
    status: "Active",
    startedAt,
    endsAt,
    settledAt: null,
    payoutUsd: 0,
  };
};

const mapAllowedUpdate = (doc, body = {}) => {
  if (body.reference !== undefined) doc.reference = safeText(body.reference, doc.reference);
  if (body.asset !== undefined) doc.asset = safeText(body.asset, doc.asset);
  if (body.coingeckoId !== undefined) doc.coingeckoId = safeText(body.coingeckoId, doc.coingeckoId);
};

export const stakeController = {
  create: asyncHandler(async (req, res) => {
    const payload = buildStakePayload(req.body);
    if (!payload.amount || !payload.principalUsd) {
      return res.status(400).json({
        success: false,
        message: "Stake amount and principalUsd are required",
      });
    }

    let doc = null;
    try {
      doc = await Stake.create({
        ...payload,
        user: req.user._id,
      });

      await applyBalanceChange({
        user: req.user,
        delta: -payload.principalUsd,
        type: "Stake",
        paymentMethod: payload.asset || "Stake",
        details: `Stake opened: ${payload.asset || payload.reference || doc._id.toString()}`,
        sourceFeature: "staking",
        actorRole: "user",
        actor: req.user?._id || null,
        actorLabel: req.user?.email || "",
        metadata: {
          stakeId: doc._id.toString(),
          principalUsd: payload.principalUsd,
          rewardUsdTotal: payload.rewardUsdTotal,
          durationDays: payload.durationDays,
          phase: "opened",
        },
      });

      await sendUserNotificationEmail({
        user: req.user,
        type: "investment",
        subject: "Stake opened",
        headline: `Your ${payload.asset || "stake"} position is active`,
        intro:
          "CoinQuestX opened your staking position and reserved the principal from your wallet balance.",
        bullets: [
          `Principal: ${formatUsd(payload.principalUsd)}`,
          `Reward target: ${formatUsd(payload.rewardUsdTotal)}`,
          `Duration: ${payload.durationDays} day(s)`,
        ],
        metadata: {
          stakeId: doc._id.toString(),
          phase: "opened",
        },
      });
    } catch (error) {
      if (doc?._id) {
        await Stake.findByIdAndDelete(doc._id).catch(() => {});
      }
      throw error;
    }

    res.status(201).json({ success: true, data: doc });
  }),

  complete: asyncHandler(async (req, res) => {
    const doc = await Stake.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Stake not found",
      });
    }

    if (doc.status === "Completed") {
      return res.json({ success: true, data: doc });
    }

    const now = new Date();
    const endsAt = toDate(doc.endsAt);
    if (endsAt && now < endsAt) {
      return res.status(400).json({
        success: false,
        message: "Stake is not ready for settlement yet",
      });
    }

    const payoutUsd = roundCurrency(doc.principalUsd + doc.rewardUsdTotal);

    doc.status = "Completed";
    doc.settledAt = now;
    doc.payoutUsd = payoutUsd;
    await doc.save();

    const balanceChange = await applyBalanceChange({
      user: req.user,
      delta: payoutUsd,
      type: "Stake",
      paymentMethod: doc.asset || "Stake",
      details: `Stake matured: ${doc.asset || doc.reference || doc._id.toString()}`,
      sourceFeature: "staking",
      actorRole: "system",
      actor: req.user?._id || null,
      actorLabel: "Stake Engine",
      metadata: {
        stakeId: doc._id.toString(),
        principalUsd: roundCurrency(doc.principalUsd),
        rewardUsd: roundCurrency(doc.rewardUsdTotal),
        payoutUsd,
        phase: "settled",
      },
    });

    await sendUserNotificationEmail({
      user: req.user,
      type: "investment",
      subject: "Stake settled",
      headline: `Your ${doc.asset || "stake"} position matured`,
      intro:
        "CoinQuestX settled your staking position and credited the payout back to your wallet.",
      bullets: [
        `Principal: ${formatUsd(doc.principalUsd)}`,
        `Reward: ${formatUsd(doc.rewardUsdTotal)}`,
        `Payout: ${formatUsd(payoutUsd)}`,
        `New balance: ${formatUsd(balanceChange.balance)}`,
      ],
      metadata: {
        stakeId: doc._id.toString(),
        phase: "settled",
        payoutUsd,
      },
    });

    res.json({
      success: true,
      data: {
        ...doc.toObject(),
        balance: balanceChange.balance,
      },
    });
  }),

  list: asyncHandler(async (req, res) => {
    const docs = await Stake.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  }),

  getById: asyncHandler(async (req, res) => {
    const doc = await Stake.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Stake not found",
      });
    }

    res.json({ success: true, data: doc });
  }),

  update: asyncHandler(async (req, res) => {
    const doc = await Stake.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Stake not found",
      });
    }

    mapAllowedUpdate(doc, req.body);
    await doc.save();
    res.json({ success: true, data: doc });
  }),

  remove: asyncHandler(async (req, res) => {
    const doc = await Stake.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Stake not found",
      });
    }

    if (doc.status === "Active" && doc.principalUsd > 0) {
      await applyBalanceChange({
        user: req.user,
        delta: roundCurrency(doc.principalUsd),
        type: "Stake",
        paymentMethod: doc.asset || "Stake",
        details: `Stake cancelled: ${doc.asset || doc.reference || doc._id.toString()}`,
        sourceFeature: "staking",
        actorRole: "user",
        actor: req.user?._id || null,
        actorLabel: req.user?.email || "",
        metadata: {
          stakeId: doc._id.toString(),
          principalUsd: roundCurrency(doc.principalUsd),
          phase: "cancelled",
        },
      });

      await sendUserNotificationEmail({
        user: req.user,
        type: "investment",
        subject: "Stake cancelled",
        headline: `Your ${doc.asset || "stake"} position was cancelled`,
        intro:
          "CoinQuestX closed your active staking position and returned the reserved principal to your wallet.",
        bullets: [
          `Refunded principal: ${formatUsd(doc.principalUsd)}`,
          `Reference: ${doc.reference || doc._id.toString()}`,
        ],
        metadata: {
          stakeId: doc._id.toString(),
          phase: "cancelled",
        },
      });
    }

    await Stake.deleteOne({ _id: doc._id });
    res.json({ success: true, data: { id: doc._id.toString() } });
  }),
};
