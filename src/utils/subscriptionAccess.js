import BuyBot from "../models/BuyBot.js";
import Mining from "../models/Mining.js";
import Subscription from "../models/Subscription.js";
import { sendUserNotificationEmail } from "./notificationService.js";

export const PLAN_MAP = {
  basic: "Basic",
  standard: "Standard",
  premium: "Premium",
  platinum: "Platinum",
  elite: "Elite",
};

export const AI_BOT_REQUIRED_PLANS = ["Premium", "Platinum", "Elite"];
export const MINING_REQUIRED_PLANS = ["Premium", "Platinum", "Elite"];
export const DIRECT_MESSAGE_REQUIRED_PLANS = ["Platinum", "Elite"];

const formatRequiredPlans = (plans = []) => {
  if (plans.length <= 1) {
    return plans[0] || "";
  }

  if (plans.length === 2) {
    return `${plans[0]} or ${plans[1]}`;
  }

  return `${plans.slice(0, -1).join(", ")}, or ${plans[plans.length - 1]}`;
};

export const normalizePlanName = (value, fallback = "Basic") => {
  const key = `${value || ""}`.trim().toLowerCase();
  return PLAN_MAP[key] || fallback;
};

export const hasAiBotAccess = (planName) =>
  AI_BOT_REQUIRED_PLANS.includes(normalizePlanName(planName));

export const hasMiningAccess = (planName) =>
  MINING_REQUIRED_PLANS.includes(normalizePlanName(planName));

export const hasDirectMessageAccess = (planName) =>
  DIRECT_MESSAGE_REQUIRED_PLANS.includes(normalizePlanName(planName));

export const markExpiredSubscriptions = async (userId) => {
  const now = new Date();
  const expiredSubscriptions = await Subscription.find({
    user: userId,
    status: "Active",
    endsAt: { $ne: null, $lte: now },
  }).populate("user", "email firstName lastName notificationSettings");

  for (const subscription of expiredSubscriptions) {
    subscription.status = "Expired";
    if (!subscription.expiryNotificationSentAt && subscription.user) {
      await sendUserNotificationEmail({
        user: subscription.user,
        type: "subscription_expiry",
        subject: "Subscription expired",
        headline: `${subscription.planName || "Your"} plan has expired`,
        intro:
          "CoinQuestX marked one of your paid subscriptions as expired. Review your plan access if you want to keep premium features active.",
        bullets: [
          `Plan: ${subscription.planName || "Subscription"}`,
          `Expired at: ${subscription.endsAt?.toLocaleString?.() || "now"}`,
        ],
        metadata: {
          subscriptionId: subscription._id.toString(),
          planName: subscription.planName || "",
        },
      });
      subscription.expiryNotificationSentAt = now;
    }
    await subscription.save();
  }
};

export const resolveCurrentPlan = async (userId) => {
  await markExpiredSubscriptions(userId);

  const activeSubscription = await Subscription.findOne({
    user: userId,
    status: "Active",
  }).sort({ createdAt: -1 });

  return normalizePlanName(activeSubscription?.planName || "Basic");
};

export const pauseActiveBotsForUser = async (userId) => {
  await BuyBot.updateMany(
    {
      user: userId,
      status: "Active",
    },
    {
      status: "Paused",
      updatedAt: new Date(),
    }
  );
};

export const pauseActiveMinersForUser = async (userId) => {
  await Mining.updateMany(
    {
      user: userId,
      status: "Active",
    },
    {
      status: "Paused",
      updatedAt: new Date(),
    }
  );
};

export const syncUserPlanAndFeatureAccess = async (user) => {
  const currentPlan = await resolveCurrentPlan(user._id);

  if (user.subscriptionPlan !== currentPlan) {
    user.subscriptionPlan = currentPlan;
    await user.save();
  }

  if (!hasAiBotAccess(currentPlan)) {
    await pauseActiveBotsForUser(user._id);
  }

  if (!hasMiningAccess(currentPlan)) {
    await pauseActiveMinersForUser(user._id);
  }

  return currentPlan;
};

export const getAiBotAccessDeniedMessage = (planName) => {
  const currentPlan = normalizePlanName(planName);
  return `AI trading bots require ${formatRequiredPlans(
    AI_BOT_REQUIRED_PLANS
  )} plans. Your current plan is ${currentPlan}.`;
};

export const getMiningAccessDeniedMessage = (planName) => {
  const currentPlan = normalizePlanName(planName);
  return `Mining requires ${formatRequiredPlans(
    MINING_REQUIRED_PLANS
  )} plans. Your current plan is ${currentPlan}.`;
};

export const getDirectMessageAccessDeniedMessage = (planName) => {
  const currentPlan = normalizePlanName(planName);
  return `Direct admin messaging requires ${formatRequiredPlans(
    DIRECT_MESSAGE_REQUIRED_PLANS
  )} plans. Your current plan is ${currentPlan}.`;
};
