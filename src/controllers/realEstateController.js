import RealEstate from "../models/RealEstate.js";
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

const buildPayload = (body = {}) => {
  const startDate = toDate(body.startDate, new Date());
  const durationDays = Math.max(1, Math.round(toPositiveNumber(body.durationDays, 30)));
  const endDate =
    toDate(body.endDate) ||
    new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const amount = toPositiveNumber(body.amount);
  const roi = toPositiveNumber(body.roi);
  const expectedPayoutUsd = roundCurrency(
    toPositiveNumber(body.expectedPayoutUsd, amount + (amount * roi) / 100)
  );

  return {
    projectId: Number.isFinite(Number(body.projectId))
      ? Number(body.projectId)
      : undefined,
    reference: safeText(body.reference),
    propertyName: safeText(body.propertyName),
    location: safeText(body.location),
    amount,
    roi,
    durationDays,
    startDate,
    endDate,
    expectedPayoutUsd,
    payoutUsd: 0,
    status: "Active",
  };
};

export const realEstateController = {
  create: asyncHandler(async (req, res) => {
    const payload = buildPayload(req.body);
    if (!payload.amount) {
      return res.status(400).json({
        success: false,
        message: "Investment amount must be greater than zero",
      });
    }

    let doc = null;
    try {
      doc = await RealEstate.create({
        ...payload,
        user: req.user._id,
      });

      await applyBalanceChange({
        user: req.user,
        delta: -payload.amount,
        type: "RealEstate",
        paymentMethod: payload.propertyName || "Real Estate",
        details: `Real estate investment: ${payload.propertyName || payload.reference || doc._id.toString()}`,
        sourceFeature: "real-estate",
        actorRole: "user",
        actor: req.user?._id || null,
        actorLabel: req.user?.email || "",
        metadata: {
          realEstateId: doc._id.toString(),
          amount: payload.amount,
          roi: payload.roi,
          expectedPayoutUsd: payload.expectedPayoutUsd,
          phase: "opened",
        },
      });

      await sendUserNotificationEmail({
        user: req.user,
        type: "investment",
        subject: "Real estate investment started",
        headline: `${payload.propertyName || "Your real estate plan"} is active`,
        intro:
          "CoinQuestX opened your real-estate investment and reserved the capital from your wallet.",
        bullets: [
          `Property: ${payload.propertyName || payload.reference || "Real Estate"}`,
          `Amount: ${formatUsd(payload.amount)}`,
          `Expected payout: ${formatUsd(payload.expectedPayoutUsd)}`,
        ],
        metadata: {
          realEstateId: doc._id.toString(),
          phase: "opened",
        },
      });
    } catch (error) {
      if (doc?._id) {
        await RealEstate.findByIdAndDelete(doc._id).catch(() => {});
      }
      throw error;
    }

    res.status(201).json({ success: true, data: doc });
  }),

  complete: asyncHandler(async (req, res) => {
    const doc = await RealEstate.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "RealEstate not found",
      });
    }

    if (doc.status === "Completed") {
      return res.json({ success: true, data: doc });
    }

    const now = new Date();
    const endDate = toDate(doc.endDate);
    if (endDate && now < endDate) {
      return res.status(400).json({
        success: false,
        message: "This investment is not ready for settlement yet",
      });
    }

    const payoutUsd = roundCurrency(
      toPositiveNumber(doc.expectedPayoutUsd, doc.amount)
    );

    doc.status = "Completed";
    doc.payoutUsd = payoutUsd;
    await doc.save();

    const balanceChange = await applyBalanceChange({
      user: req.user,
      delta: payoutUsd,
      type: "RealEstate",
      paymentMethod: doc.propertyName || "Real Estate",
      details: `Real estate payout: ${doc.propertyName || doc.reference || doc._id.toString()}`,
      sourceFeature: "real-estate",
      actorRole: "system",
      actor: req.user?._id || null,
      actorLabel: "Real Estate Engine",
      metadata: {
        realEstateId: doc._id.toString(),
        principalUsd: roundCurrency(doc.amount),
        payoutUsd,
        profitUsd: roundCurrency(Math.max(0, payoutUsd - doc.amount)),
        phase: "settled",
      },
    });

    await sendUserNotificationEmail({
      user: req.user,
      type: "investment",
      subject: "Real estate payout settled",
      headline: `${doc.propertyName || "Your real estate plan"} completed`,
      intro:
        "CoinQuestX settled your real-estate investment and credited the payout to your wallet.",
      bullets: [
        `Invested amount: ${formatUsd(doc.amount)}`,
        `Payout: ${formatUsd(payoutUsd)}`,
        `New balance: ${formatUsd(balanceChange.balance)}`,
      ],
      metadata: {
        realEstateId: doc._id.toString(),
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
    const docs = await RealEstate.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  }),

  getById: asyncHandler(async (req, res) => {
    const doc = await RealEstate.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "RealEstate not found",
      });
    }
    res.json({ success: true, data: doc });
  }),

  update: asyncHandler(async (req, res) => {
    const doc = await RealEstate.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "RealEstate not found",
      });
    }

    if (req.body.reference !== undefined) doc.reference = safeText(req.body.reference, doc.reference);
    if (req.body.propertyName !== undefined) doc.propertyName = safeText(req.body.propertyName, doc.propertyName);
    if (req.body.location !== undefined) doc.location = safeText(req.body.location, doc.location);
    await doc.save();

    res.json({ success: true, data: doc });
  }),

  remove: asyncHandler(async (req, res) => {
    const doc = await RealEstate.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "RealEstate not found",
      });
    }

    if (doc.status === "Active" && doc.amount > 0) {
      await applyBalanceChange({
        user: req.user,
        delta: roundCurrency(doc.amount),
        type: "RealEstate",
        paymentMethod: doc.propertyName || "Real Estate",
        details: `Real estate investment cancelled: ${doc.propertyName || doc.reference || doc._id.toString()}`,
        sourceFeature: "real-estate",
        actorRole: "user",
        actor: req.user?._id || null,
        actorLabel: req.user?.email || "",
        metadata: {
          realEstateId: doc._id.toString(),
          principalUsd: roundCurrency(doc.amount),
          phase: "cancelled",
        },
      });

      await sendUserNotificationEmail({
        user: req.user,
        type: "investment",
        subject: "Real estate investment cancelled",
        headline: `${doc.propertyName || "Your real estate plan"} was cancelled`,
        intro:
          "CoinQuestX cancelled your active real-estate investment and returned the reserved amount to your wallet.",
        bullets: [
          `Refunded amount: ${formatUsd(doc.amount)}`,
          `Reference: ${doc.reference || doc._id.toString()}`,
        ],
        metadata: {
          realEstateId: doc._id.toString(),
          phase: "cancelled",
        },
      });
    }

    await RealEstate.deleteOne({ _id: doc._id });
    res.json({ success: true, data: { id: doc._id.toString() } });
  }),
};
