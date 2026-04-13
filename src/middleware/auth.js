import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const extractToken = (req) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.replace("Bearer ", "").trim();
};

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    const userId = payload.sub || payload.userId || payload.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    req.user = user;
    req.userId = userId;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
});

export const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    const userId = payload.sub || payload.userId || payload.uid;
    if (!userId) {
      return next();
    }

    const user = await User.findById(userId);
    if (!user) {
      return next();
    }

    req.user = user;
    req.userId = userId;
  } catch (error) {
    // Ignore invalid/expired tokens for optional auth routes.
  }

  return next();
});

export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  if (!env.REQUIRE_ADMIN) {
    return next();
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  return next();
};
