import BuyBot from "../models/BuyBot.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { applyBalanceChange } from "../utils/walletLedger.js";
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
  if (lowered === "completed") return "Completed";
  if (lowered === "active") return "Active";
  return fallback;
};

const buildPayload = (body = {}, current = null) => ({
  strategyName: safeText(body.strategyName, current?.strategyName || ""),
  asset: safeText(body.asset, current?.asset || ""),
  budget: toPositiveNumber(body.budget, current?.budget || 0),
  generatedProfit: toPositiveNumber(
    body.generatedProfit,
    current?.generatedProfit || 0
  ),
  status: normalizeStatus(body.status, current?.status || "Active"),
  settings:
    body?.settings && typeof body.settings === "object"
      ? {
          ...(current?.settings || {}),
          ...body.settings,
        }
      : current?.settings || {},
});

const chargeForActivation = async ({ req, doc, amount }) => {
  if (amount <= 0) return null;

  return applyBalanceChange({
    user: req.user,
    delta: -amount,
    type: "BuyBot",
    paymentMethod: doc.strategyName || "Buy Bot",
    details: `Bot activated: ${doc.strategyName || doc._id.toString()}`,
    sourceFeature: "bots",
    actorRole: "user",
    actor: req.user?._id || null,
    actorLabel: req.user?.email || "",
    metadata: {
      buyBotId: doc._id.toString(),
      strategyName: doc.strategyName || "",
      budget: amount,
      phase: "opened",
    },
  });
};

export const buyBotController = {
  create: asyncHandler(async (req, res) => {
    const payload = buildPayload(req.body);
    if (!payload.budget) {
      return res.status(400).json({
        success: false,
        message: "Bot budget must be greater than zero",
      });
    }

    let doc = null;
    try {
      doc = await BuyBot.create({
        ...payload,
        user: req.user._id,
      });

      if (payload.status === "Active") {
        await chargeForActivation({ req, doc, amount: payload.budget });

        await sendUserNotificationEmail({
          user: req.user,
          type: "investment",
          subject: "Buy bot activated",
          headline: `${doc.strategyName || "Your buy bot"} is now active`,
          intro:
            "CoinQuestX activated your AI bot allocation and reserved the selected capital for automated execution.",
          bullets: [
            `Strategy: ${doc.strategyName || "Buy Bot"}`,
            `Capital allocated: ${formatUsd(doc.budget)}`,
            `Status: ${doc.status}`,
          ],
          metadata: {
            buyBotId: doc._id.toString(),
            strategyName: doc.strategyName || "",
            status: doc.status,
            phase: "opened",
          },
        });
      }
    } catch (error) {
      if (doc?._id) {
        await BuyBot.findByIdAndDelete(doc._id).catch(() => {});
      }
      throw error;
    }

    res.status(201).json({ success: true, data: doc });
  }),

  list: asyncHandler(async (req, res) => {
    const docs = await BuyBot.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  }),

  getById: asyncHandler(async (req, res) => {
    const doc = await BuyBot.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "BuyBot not found",
      });
    }
    res.json({ success: true, data: doc });
  }),

  update: asyncHandler(async (req, res) => {
    const doc = await BuyBot.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "BuyBot not found",
      });
    }

    const previousStatus = doc.status;
    const previousGeneratedProfit = Number(doc.generatedProfit || 0);
    const nextPayload = buildPayload(req.body, doc);

    doc.strategyName = nextPayload.strategyName;
    doc.asset = nextPayload.asset;
    doc.budget = nextPayload.budget;
    doc.generatedProfit = nextPayload.generatedProfit;
    doc.status = nextPayload.status;
    doc.settings = nextPayload.settings;

    if (previousStatus !== "Active" && nextPayload.status === "Active") {
      await chargeForActivation({ req, doc, amount: nextPayload.budget });
    }

    await doc.save();

    const nextGeneratedProfit = Number(doc.generatedProfit || 0);
    const statusChanged = previousStatus !== doc.status;

    if (statusChanged) {
      const statusEmailConfig =
        doc.status === "Active"
          ? {
              subject: "Buy bot activated",
              headline: `${doc.strategyName || "Your buy bot"} is active again`,
              intro:
                "CoinQuestX reactivated your buy bot and resumed its automated trading allocation.",
            }
          : doc.status === "Paused"
          ? {
              subject: "Buy bot paused",
              headline: `${doc.strategyName || "Your buy bot"} was paused`,
              intro:
                "CoinQuestX paused this automated bot. It remains on record, but the strategy is no longer running actively.",
            }
          : {
              subject: "Buy bot completed",
              headline: `${doc.strategyName || "Your buy bot"} reached completion`,
              intro:
                "CoinQuestX marked this bot cycle completed. Review the generated profit summary in your dashboard activity history.",
            };

      await sendUserNotificationEmail({
        user: req.user,
        type: "investment",
        ...statusEmailConfig,
        bullets: [
          `Strategy: ${doc.strategyName || "Buy Bot"}`,
          `Capital: ${formatUsd(doc.budget)}`,
          `Generated profit: ${formatUsd(nextGeneratedProfit)}`,
          `Status: ${doc.status}`,
        ],
        metadata: {
          buyBotId: doc._id.toString(),
          strategyName: doc.strategyName || "",
          previousStatus,
          status: doc.status,
          generatedProfit: nextGeneratedProfit,
          phase: doc.status.toLowerCase(),
        },
      });
    } else if (
      doc.status === "Completed" &&
      Math.abs(nextGeneratedProfit - previousGeneratedProfit) >= 0.01
    ) {
      await sendUserNotificationEmail({
        user: req.user,
        type: "investment",
        subject: "Buy bot profit updated",
        headline: `${doc.strategyName || "Your buy bot"} profit was updated`,
        intro:
          "CoinQuestX revised the recorded profit for this completed buy bot cycle.",
        bullets: [
          `Strategy: ${doc.strategyName || "Buy Bot"}`,
          `Previous profit: ${formatUsd(previousGeneratedProfit)}`,
          `Updated profit: ${formatUsd(nextGeneratedProfit)}`,
          `Status: ${doc.status}`,
        ],
        metadata: {
          buyBotId: doc._id.toString(),
          strategyName: doc.strategyName || "",
          previousGeneratedProfit,
          generatedProfit: nextGeneratedProfit,
          phase: "profit_update",
        },
      });
    }

    res.json({ success: true, data: doc });
  }),

  remove: asyncHandler(async (req, res) => {
    const doc = await BuyBot.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "BuyBot not found",
      });
    }

    await sendUserNotificationEmail({
      user: req.user,
      type: "investment",
      subject: "Buy bot removed",
      headline: `${doc.strategyName || "Your buy bot"} was removed`,
      intro:
        "CoinQuestX removed this buy bot record from your account history.",
      bullets: [
        `Strategy: ${doc.strategyName || "Buy Bot"}`,
        `Capital: ${formatUsd(doc.budget)}`,
        `Final status: ${doc.status}`,
      ],
      metadata: {
        buyBotId: doc._id.toString(),
        strategyName: doc.strategyName || "",
        status: doc.status,
        phase: "removed",
      },
    });

    res.json({ success: true, data: { id: doc._id } });
  }),
};
