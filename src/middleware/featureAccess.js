import { asyncHandler } from "../utils/asyncHandler.js";
import {
  AI_BOT_REQUIRED_PLANS,
  getAiBotAccessDeniedMessage,
  hasAiBotAccess,
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
