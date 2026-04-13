import bcrypt from "bcryptjs";
import Deposit from "../models/Deposit.js";
import Withdrawal from "../models/Withdrawal.js";
import Trade from "../models/Trade.js";
import CopyTrade from "../models/CopyTrade.js";
import PlaceTrade from "../models/PlaceTrade.js";
import Subscription from "../models/Subscription.js";
import Mining from "../models/Mining.js";
import Stake from "../models/Stake.js";
import BuyBot from "../models/BuyBot.js";
import RealEstate from "../models/RealEstate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { summarizeInvestmentRevenue } from "../utils/investmentMetrics.js";
import { syncUserPlanAndFeatureAccess } from "../utils/subscriptionAccess.js";
import {
  normalizeNotificationSettings,
  normalizeSecuritySettings,
} from "../utils/security.js";

const sumAmounts = (items) =>
  items.reduce((total, item) => total + (Number(item.amount) || 0), 0);

const sanitizeBoolean = (value, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const sanitizeText = (value, fallback = "", maxLength = 160) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;

const mergeSecuritySettings = (value = {}, current = {}) => ({
  ...normalizeSecuritySettings(current),
  ...normalizeSecuritySettings(value),
  twoFactorEnabled: sanitizeBoolean(
    value.twoFactorEnabled,
    sanitizeBoolean(current.twoFactorEnabled, false)
  ),
  loginAlerts: sanitizeBoolean(
    value.loginAlerts,
    sanitizeBoolean(current.loginAlerts, true)
  ),
  withdrawalProtection: sanitizeBoolean(
    value.withdrawalProtection,
    sanitizeBoolean(current.withdrawalProtection, true)
  ),
  antiPhishingPhrase: sanitizeText(
    value.antiPhishingPhrase,
    sanitizeText(current.antiPhishingPhrase, ""),
    48
  ),
  sessionTimeoutMinutes: Math.min(
    240,
    Math.max(
      5,
      Number.isFinite(Number(value.sessionTimeoutMinutes))
        ? Number(value.sessionTimeoutMinutes)
        : Number(current.sessionTimeoutMinutes) || 30
    )
  ),
  trustedDeviceLabel: sanitizeText(
    value.trustedDeviceLabel,
    sanitizeText(current.trustedDeviceLabel, ""),
    48
  ),
  whitelistMode: sanitizeText(
    value.whitelistMode,
    sanitizeText(current.whitelistMode, "enforced"),
    24
  ),
  withdrawalCooldownMinutes: Math.max(
    0,
    Number.isFinite(Number(value.withdrawalCooldownMinutes))
      ? Number(value.withdrawalCooldownMinutes)
      : Number(current.withdrawalCooldownMinutes) || 30
  ),
  lastSecurityReviewAt:
    typeof value.lastSecurityReviewAt === "string" && value.lastSecurityReviewAt
      ? value.lastSecurityReviewAt
      : current.lastSecurityReviewAt || null,
  lastTwoFactorChallengeAt:
    typeof value.lastTwoFactorChallengeAt === "string" &&
    value.lastTwoFactorChallengeAt
      ? value.lastTwoFactorChallengeAt
      : current.lastTwoFactorChallengeAt || null,
  lastTwoFactorVerifiedAt:
    typeof value.lastTwoFactorVerifiedAt === "string" &&
    value.lastTwoFactorVerifiedAt
      ? value.lastTwoFactorVerifiedAt
      : current.lastTwoFactorVerifiedAt || null,
  lastWithdrawalRequestedAt:
    typeof value.lastWithdrawalRequestedAt === "string" &&
    value.lastWithdrawalRequestedAt
      ? value.lastWithdrawalRequestedAt
      : current.lastWithdrawalRequestedAt || null,
});

const mapWalletWhitelist = (entries = []) =>
  (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: entry?._id?.toString() || "",
    label: entry?.label || "",
    paymentMethod: entry?.paymentMethod || "",
    network: entry?.network || "",
    maskedDestination: entry?.maskedDestination || "",
    destinationSummary: entry?.destinationSummary || "",
    status: entry?.status || "active",
    addedAt: entry?.addedAt || null,
    lastUsedAt: entry?.lastUsedAt || null,
  }));

const normalizeOnboarding = (value = {}, current = {}) => {
  const completedSteps = Array.isArray(value.completedSteps)
    ? value.completedSteps
    : Array.isArray(current.completedSteps)
    ? current.completedSteps
    : [];

  return {
    dismissed: sanitizeBoolean(
      value.dismissed,
      sanitizeBoolean(current.dismissed, false)
    ),
    completedSteps: [...new Set(completedSteps.filter(Boolean).map(String))],
    lastDismissedAt:
      typeof value.lastDismissedAt === "string" && value.lastDismissedAt
        ? value.lastDismissedAt
        : current.lastDismissedAt || null,
  };
};

export const getDashboard = asyncHandler(async (req, res) => {
  await syncUserPlanAndFeatureAccess(req.user);
  const user = req.user;

  const [
    deposits,
    withdrawals,
    trades,
    copyTrades,
    placeTrades,
    subscriptions,
    miningRuns,
    stakes,
    bots,
    realEstate,
  ] = await Promise.all([
    Deposit.find({ user: user._id }),
    Withdrawal.find({ user: user._id }),
    Trade.find({ user: user._id }),
    CopyTrade.find({ user: user._id }),
    PlaceTrade.find({ user: user._id }),
    Subscription.find({ user: user._id }),
    Mining.find({ user: user._id }),
    Stake.find({ user: user._id }),
    BuyBot.find({ user: user._id }),
    RealEstate.find({ user: user._id }),
  ]);

  const completedDeposits = deposits.filter(
    (deposit) => deposit.status === "Completed"
  );
  const completedWithdrawals = withdrawals.filter(
    (withdrawal) => withdrawal.status === "Completed"
  );
  const activeTrades = trades.filter((trade) => trade.status === "Active");
  const activePlaceTrades = placeTrades.filter(
    (trade) => trade.status === "Active"
  );
  const activeCopyTrades = copyTrades.filter((trade) =>
    ["Active", "Paused"].includes(trade.status)
  );
  const completedTrades = trades.filter((trade) => trade.status === "Completed");
  const completedPlaceTrades = placeTrades.filter(
    (trade) => trade.status === "Completed"
  );
  const revenueSummary = summarizeInvestmentRevenue({
    trades,
    placeTrades,
    copyTrades,
    miningRuns,
    stakes,
    bots,
    realEstate,
  });

  const completedTradingPool = [...completedTrades, ...completedPlaceTrades];
  const totalCompletedTrades = completedTradingPool.length;
  const totalWinningTrades = completedTradingPool.filter((trade) => {
    if (`${trade.result || ""}`.toLowerCase() === "win") return true;
    return (Number(trade.profitLoss) || 0) > 0;
  }).length;
  const winRate =
    totalCompletedTrades > 0 ? (totalWinningTrades / totalCompletedTrades) * 100 : 0;

  const totalDeposits = sumAmounts(completedDeposits);
  const totalWithdrawals = sumAmounts(completedWithdrawals);
  const netCashflow = totalDeposits - totalWithdrawals;
  const roiPercent =
    totalDeposits > 0
      ? (revenueSummary.grossRevenue / totalDeposits) * 100
      : 0;

  const data = {
    balance: user.balance,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    country: user.country,
    currencyCode: user.currencyCode,
    currencySymbol: user.currencySymbol,
    photoURL: user.photoURL,
    coverImageURL: user.coverImageURL,
    subscriptionPlan: user.subscriptionPlan,
    kycVerified: user.kycVerified,
    kycStatus: user.kycStatus,
    role: user.role,
    status: user.status,
    securitySettings: mergeSecuritySettings(user.securitySettings),
    notificationSettings: normalizeNotificationSettings(
      user.notificationSettings || {}
    ),
    walletWhitelist: mapWalletWhitelist(user.walletWhitelist || []),
    onboarding: normalizeOnboarding(user.onboarding),
    lastLoginAt: user.lastLoginAt,
    lastLoginDevice: user.lastLoginDevice || "",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    stats: {
      totalDeposits,
      totalWithdrawals,
      depositCount: deposits.length,
      withdrawalCount: withdrawals.length,
      tradeCount: trades.length,
      copyTradeCount: copyTrades.length,
      placeTradeCount: placeTrades.length,
      subscriptionCount: subscriptions.length,
      miningCount: miningRuns.length,
      stakeCount: stakes.length,
      botCount: bots.length,
      realEstateCount: realEstate.length,
    },
    revenue: {
      ...revenueSummary,
      activeTrades:
        activeTrades.length + activePlaceTrades.length + activeCopyTrades.length,
      activeSpotTrades: activeTrades.length,
      activePlaceTrades: activePlaceTrades.length,
      activeCopyTrades: activeCopyTrades.length,
      totalWinningTrades,
      totalCompletedTrades,
      winRate,
      netCashflow,
      roiPercent,
    },
  };

  res.json({ success: true, data });
});

export const getProfile = asyncHandler(async (req, res) => {
  await syncUserPlanAndFeatureAccess(req.user);
  const user = req.user;
  res.json({
    success: true,
    data: {
      id: user._id.toString(),
      userId: user._id.toString(),
      uid: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      country: user.country,
      sex: user.sex,
      currencyCode: user.currencyCode,
      currencySymbol: user.currencySymbol,
      photoURL: user.photoURL,
      coverImageURL: user.coverImageURL,
      balance: user.balance,
      subscriptionPlan: user.subscriptionPlan,
      kycVerified: user.kycVerified,
      kycStatus: user.kycStatus,
      role: user.role,
      status: user.status,
      securitySettings: mergeSecuritySettings(user.securitySettings),
      notificationSettings: normalizeNotificationSettings(
        user.notificationSettings || {}
      ),
      walletWhitelist: mapWalletWhitelist(user.walletWhitelist || []),
      onboarding: normalizeOnboarding(user.onboarding),
      lastLoginAt: user.lastLoginAt,
      lastLoginDevice: user.lastLoginDevice || "",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = req.user;
  const allowedFields = [
    "firstName",
    "lastName",
    "phoneNumber",
    "country",
    "sex",
    "currencyCode",
    "currencySymbol",
    "photoURL",
    "coverImageURL",
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      user[field] = req.body[field];
    }
  });

  if (req.body.transactionCode !== undefined) {
    user.transactionCode = sanitizeText(req.body.transactionCode, "", 24);
  }

  if (req.body.securitySettings && typeof req.body.securitySettings === "object") {
    const {
      twoFactorEnabled,
      lastTwoFactorChallengeAt,
      lastTwoFactorVerifiedAt,
      lastWithdrawalRequestedAt,
      ...safeSecurityUpdates
    } = req.body.securitySettings || {};
    void twoFactorEnabled;
    void lastTwoFactorChallengeAt;
    void lastTwoFactorVerifiedAt;
    void lastWithdrawalRequestedAt;

    user.securitySettings = mergeSecuritySettings(
      safeSecurityUpdates,
      user.securitySettings
    );
  }

  if (
    req.body.notificationSettings &&
    typeof req.body.notificationSettings === "object"
  ) {
    user.notificationSettings = normalizeNotificationSettings(
      req.body.notificationSettings
    );
  }

  if (req.body.onboarding && typeof req.body.onboarding === "object") {
    user.onboarding = normalizeOnboarding(req.body.onboarding, user.onboarding);
  }

  await user.save();

  res.json({
    success: true,
    data: {
      id: user._id.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      country: user.country,
      sex: user.sex,
      currencyCode: user.currencyCode,
      currencySymbol: user.currencySymbol,
      photoURL: user.photoURL,
      coverImageURL: user.coverImageURL,
      transactionCode: user.transactionCode,
      securitySettings: mergeSecuritySettings(user.securitySettings),
      notificationSettings: normalizeNotificationSettings(
        user.notificationSettings || {}
      ),
      walletWhitelist: mapWalletWhitelist(user.walletWhitelist || []),
      onboarding: normalizeOnboarding(user.onboarding),
      lastLoginAt: user.lastLoginAt,
      lastLoginDevice: user.lastLoginDevice || "",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

export const getKycStatus = asyncHandler(async (req, res) => {
  const user = req.user;
  res.json({
    success: true,
    status: user.kycStatus || "not_verified",
    verified: user.kycVerified || false,
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Current password and new password are required",
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters",
    });
  }

  const isMatch = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!isMatch) {
    return res.status(400).json({
      success: false,
      message: "Current password is incorrect",
    });
  }

  req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  await req.user.save();

  res.json({ success: true, message: "Password updated successfully" });
});

export const adjustBalance = asyncHandler(async (req, res) => {
  res.status(403).json({
    success: false,
    message:
      "Direct client wallet mutations are disabled. Use the secured feature endpoints instead.",
  });
});
