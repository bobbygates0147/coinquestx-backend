import { env } from "../config/env.js";

export const requireKyc = (req, res, next) => {
  if (!env.REQUIRE_KYC) {
    return next();
  }

  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  if (!req.user.kycVerified || req.user.kycStatus !== "verified") {
    return res.status(403).json({
      success: false,
      message: "KYC verification required",
    });
  }

  return next();
};
