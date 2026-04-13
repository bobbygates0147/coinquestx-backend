import Signal from "../models/Signal.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { applyBalanceChange } from "../utils/walletLedger.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const formatUsd = (value) => `$${Number(value || 0).toFixed(2)}`;

const normalizeStatus = (value, fallback = "active") => {
  const raw = `${value || ""}`.trim().toLowerCase();
  if (!raw) return fallback;
  if (["active", "cancelled", "canceled", "completed", "paused"].includes(raw)) {
    return raw === "canceled" ? "cancelled" : raw;
  }
  return fallback;
};

const deactivateOtherSignals = async (userId, excludeId = null) => {
  const filter = {
    user: userId,
    status: "active",
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  await Signal.updateMany(filter, { status: "cancelled" });
};

export const signalController = {
  create: asyncHandler(async (req, res) => {
    const payload = { ...req.body, user: req.user._id };
    payload.status = normalizeStatus(payload.status, "active");

    let doc = null;
    const previousActiveSignals =
      payload.status === "active"
        ? await Signal.find({ user: req.user._id, status: "active" })
        : [];
    try {
      if (payload.status === "active") {
        await deactivateOtherSignals(req.user._id);
      }

      doc = await Signal.create(payload);

      const amountPaid = Math.max(0, Number(payload.amountPaid) || 0);
      if (payload.status === "active" && amountPaid > 0) {
        await applyBalanceChange({
          user: req.user,
          delta: -amountPaid,
          type: "Signal",
          paymentMethod: payload.planName || payload.provider || "Signal",
          details: `Signal subscription activated: ${payload.planName || payload.provider || "Plan"}`,
          sourceFeature: "signals",
          actorRole: "user",
          actor: req.user?._id || null,
          actorLabel: req.user?.email || "",
          metadata: {
            signalId: doc._id.toString(),
            planName: payload.planName || "",
            provider: payload.provider || "",
            phase: "opened",
          },
        });

        await sendUserNotificationEmail({
          user: req.user,
          type: "signal",
          subject: "Signal plan activated",
          headline: `${payload.planName || payload.provider || "Your signal plan"} is active`,
          intro:
            "CoinQuestX activated your signal plan and deducted the subscription amount from your wallet.",
          bullets: [
            `Plan: ${payload.planName || "Signal Plan"}`,
            payload.provider ? `Provider: ${payload.provider}` : "Provider: In-app",
            `Amount paid: ${formatUsd(amountPaid)}`,
          ],
          metadata: {
            signalId: doc._id.toString(),
            phase: "opened",
          },
        });
      }
    } catch (error) {
      if (doc?._id) {
        await Signal.findByIdAndDelete(doc._id).catch(() => {});
      }
      if (previousActiveSignals.length) {
        await Promise.all(
          previousActiveSignals.map((signal) =>
            Signal.findByIdAndUpdate(signal._id, { status: "active" }).catch(
              () => {}
            )
          )
        );
      }
      throw error;
    }

    res.status(201).json({ success: true, data: doc });
  }),

  list: asyncHandler(async (req, res) => {
    const docs = await Signal.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  }),

  getById: asyncHandler(async (req, res) => {
    const doc = await Signal.findOne({ _id: req.params.id, user: req.user._id });
    if (!doc) {
      return res.status(404).json({ success: false, message: "Signal not found" });
    }
    res.json({ success: true, data: doc });
  }),

  update: asyncHandler(async (req, res) => {
    const doc = await Signal.findOne({ _id: req.params.id, user: req.user._id });
    if (!doc) {
      return res.status(404).json({ success: false, message: "Signal not found" });
    }

    const nextStatus = normalizeStatus(req.body.status, doc.status);

    if (nextStatus === "active") {
      await deactivateOtherSignals(req.user._id, doc._id);
    }

    Object.assign(doc, req.body, { status: nextStatus });
    await doc.save();

    res.json({ success: true, data: doc });
  }),

  remove: asyncHandler(async (req, res) => {
    const doc = await Signal.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!doc) {
      return res.status(404).json({ success: false, message: "Signal not found" });
    }
    res.json({ success: true, data: { id: doc._id } });
  }),
};
