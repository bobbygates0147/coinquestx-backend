import { asyncHandler } from "../utils/asyncHandler.js";
import {
  AI_BOT_REQUIRED_PLANS,
  MINING_REQUIRED_PLANS,
  getAiBotAccessDeniedMessage,
  getMiningAccessDeniedMessage,
  hasAiBotAccess,
  hasMiningAccess,
  syncUserPlanAndFeatureAccess,
} from "../utils/subscriptionAccess.js";

export const requireAiBotSubscription = asyncHandler(async (req, res, next) => {
  const currentPlan = await syncUserPlanAndFeatureAccess(req.user);

  if (hasAiBotAccess(currentPlan)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    feature: "aiBots",
    currentPlan,
    requiredPlans: AI_BOT_REQUIRED_PLANS,
    message: getAiBotAccessDeniedMessage(currentPlan),
  });
});

export const requireMiningSubscription = asyncHandler(async (req, res, next) => {
  const currentPlan = await syncUserPlanAndFeatureAccess(req.user);

  if (hasMiningAccess(currentPlan)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    feature: "mining",
    currentPlan,
    requiredPlans: MINING_REQUIRED_PLANS,
    message: getMiningAccessDeniedMessage(currentPlan),
  });
});
