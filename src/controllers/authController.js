import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Referral from "../models/Referral.js";
import SecurityChallenge from "../models/SecurityChallenge.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { buildReferralCode } from "../utils/referralCode.js";
import { applyBalanceChange } from "../utils/walletLedger.js";
import {
  createSecurityChallenge,
  normalizeNotificationSettings,
  normalizeSecuritySettings,
  verifySecurityChallenge,
} from "../utils/security.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

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

const buildUserPayload = (user) => ({
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
    transactionCode: user.transactionCode,
    referralCode: user.referralCode,
    referredBy: user.referredBy,
    securitySettings: normalizeSecuritySettings(user.securitySettings || {}),
    notificationSettings: normalizeNotificationSettings(
      user.notificationSettings || {}
    ),
    walletWhitelist: mapWalletWhitelist(user.walletWhitelist || []),
    onboarding: user.onboarding || {},
    lastLoginAt: user.lastLoginAt,
    lastLoginDevice: user.lastLoginDevice || "",
  });

const createToken = (user) =>
  jwt.sign(
    {
      sub: user._id.toString(),
      userId: user._id.toString(),
      uid: user._id.toString(),
      email: user.email,
      role: user.role,
    },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );

const buildRegistrationChallenge = (user) =>
  createSecurityChallenge({
    user,
    type: "register",
    subject: "Verify your CoinQuestX account email",
    headline: "Confirm your email to finish registration",
    intro:
      "Use the code below to verify your email address and finish creating your CoinQuestX account.",
    bullets: [
      `Email: ${user.email}`,
      `Name: ${[user.firstName, user.lastName].filter(Boolean).join(" ") || "New account"}`,
    ],
  });

const applyPendingRegistrationFields = async ({
  user,
  firstName,
  lastName,
  phoneNumber,
  country,
  sex,
  currencyCode,
  currencySymbol,
  passwordHash,
  referredBy = null,
}) => {
  user.firstName = firstName.trim();
  user.lastName = lastName.trim();
  user.passwordHash = passwordHash;
  user.phoneNumber = phoneNumber?.trim() || "";
  user.country = country?.trim() || "";
  user.sex = sex || "";
  user.currencyCode = currencyCode || "USD";
  user.currencySymbol = currencySymbol || "$";
  user.subscriptionPlan = user.subscriptionPlan || "Basic";
  user.status = "pending_verification";
  user.referredBy = referredBy || null;

  if (!user.referralCode) {
    user.referralCode = buildReferralCode(user._id);
  }

  await user.save();
};

const activateReferredUserReward = async (user) => {
  if (!user?.referredBy) return;

  const existingReferral = await Referral.findOne({ referred: user._id });
  if (existingReferral) return;

  const referrer = await User.findById(user.referredBy);
  if (!referrer) return;

  await Referral.create({
    referrer: referrer._id,
    referred: user._id,
    referredEmail: user.email,
    status: "Active",
    rewardAmount: env.REFERRAL_BONUS,
    rewardStatus: "Paid",
  });

  await applyBalanceChange({
    user: referrer,
    delta: Number(env.REFERRAL_BONUS) || 0,
    type: "Adjustment",
    paymentMethod: "Referral Reward",
    details: `Referral reward credited for ${user.email}`,
    sourceFeature: "referrals",
    actorRole: "system",
    actor: user._id,
    actorLabel: "Referral Engine",
    metadata: {
      reasonKey: "referral_reward",
      reasonLabel: "Referral Reward",
      referredUserId: user._id.toString(),
      referredEmail: user.email,
    },
  });

  await sendUserNotificationEmail({
    user: referrer,
    type: "referral_reward",
    subject: "Referral reward credited",
    headline: "A referral reward just hit your wallet",
    intro: `Your account earned $${Number(env.REFERRAL_BONUS || 0).toFixed(
      2
    )} after ${user.email} completed registration with your referral code.`,
    bullets: [
      `Referred user: ${user.email}`,
      `Reward amount: $${Number(env.REFERRAL_BONUS || 0).toFixed(2)}`,
    ],
    metadata: {
      referredUserId: user._id.toString(),
      referredEmail: user.email,
    },
  });
};

export const register = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    confirmPassword,
    phoneNumber,
    country,
    sex,
    currencyCode,
    currencySymbol,
    referralCode,
  } = req.body;

  if (!firstName || !lastName || !email || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Missing required registration fields",
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Passwords do not match",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing && existing.status !== "pending_verification") {
    return res.status(409).json({
      success: false,
      message: "Email already registered",
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const normalizedReferral = `${referralCode || ""}`.trim().toUpperCase();
  let referrer = null;
  if (normalizedReferral) {
    referrer = await User.findOne({ referralCode: normalizedReferral });
    if (referrer && existing && referrer._id.toString() === existing._id.toString()) {
      referrer = null;
    }
  }

  const user =
    existing ||
    (await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      passwordHash,
      phoneNumber: phoneNumber?.trim() || "",
      country: country?.trim() || "",
      sex: sex || "",
      currencyCode: currencyCode || "USD",
      currencySymbol: currencySymbol || "$",
      subscriptionPlan: "Basic",
      status: "pending_verification",
      lastLoginAt: null,
      lastLoginDevice: `${req.headers["user-agent"] || ""}`.slice(0, 180),
    }));

  await applyPendingRegistrationFields({
    user,
    firstName,
    lastName,
    phoneNumber,
    country,
    sex,
    currencyCode,
    currencySymbol,
    passwordHash,
    referredBy:
      referrer && referrer._id.toString() !== user._id.toString()
        ? referrer._id
        : null,
  });

  const challenge = await buildRegistrationChallenge(user);

  res.status(202).json({
    success: false,
    requiresVerification: true,
    message: "Verification code sent to your email address.",
    data: {
      challengeId: challenge._id.toString(),
      expiresAt: challenge.expiresAt,
      email: user.email,
    },
  });
});

export const confirmRegistration = asyncHandler(async (req, res) => {
  const { challengeId, code } = req.body;
  if (!challengeId || !code) {
    return res.status(400).json({
      success: false,
      message: "challengeId and code are required",
    });
  }

  const pendingChallenge = await SecurityChallenge.findById(challengeId);
  if (!pendingChallenge || pendingChallenge.type !== "register") {
    return res.status(404).json({
      success: false,
      message: "Registration verification not found",
    });
  }

  try {
    await verifySecurityChallenge({
      challengeId,
      type: "register",
      userId: pendingChallenge.user,
      code,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Invalid verification code",
    });
  }

  const user = await User.findById(pendingChallenge.user);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Registration record not found",
    });
  }

  user.status = "active";
  user.lastLoginAt = new Date();
  user.lastLoginDevice = `${req.headers["user-agent"] || ""}`.slice(0, 180);
  await user.save();

  await activateReferredUserReward(user);

  const token = createToken(user);
  const payload = buildUserPayload(user);

  res.status(201).json({
    success: true,
    token,
    data: {
      token,
      ...payload,
      user: payload,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    authCode,
    requireAdmin,
    challengeId,
    twoFactorCode,
  } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  }

  if (user.status === "pending_verification") {
    return res.status(403).json({
      success: false,
      message: "Verify your email address before signing in.",
      requiresVerification: true,
    });
  }

  if (user.status === "suspended") {
    return res.status(403).json({
      success: false,
      message: "This account is suspended. Contact support for help.",
    });
  }

  if (requireAdmin) {
    if (user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have admin access.",
      });
    }

    if (!authCode) {
      return res.status(400).json({
        success: false,
        message: "Admin authorization code is required",
      });
    }

    if (env.ADMIN_AUTH_CODE && authCode !== env.ADMIN_AUTH_CODE) {
      return res.status(403).json({
        success: false,
        message: "Invalid admin authorization code",
      });
    }
  }

  const securitySettings = normalizeSecuritySettings(user.securitySettings || {});
  if (securitySettings.twoFactorEnabled) {
    const signInDevice = `${req.headers["user-agent"] || ""}`.slice(0, 180);

    if (!challengeId || !twoFactorCode) {
      const challenge = await createSecurityChallenge({
        user,
        type: "login",
        subject: "Your CoinQuestX login verification code",
        headline: "Approve this sign-in",
        intro:
          "A sign-in attempt reached your CoinQuestX account. Use the code below to finish logging in.",
        bullets: [
          `Device: ${signInDevice || "Unknown device"}`,
          `Time: ${new Date().toLocaleString()}`,
        ],
      });

      return res.status(202).json({
        success: false,
        requiresTwoFactor: true,
        message: "Verification code sent to your email address.",
        data: {
          challengeId: challenge._id.toString(),
          expiresAt: challenge.expiresAt,
        },
      });
    }

    try {
      await verifySecurityChallenge({
        challengeId,
        userId: user._id,
        type: "login",
        code: twoFactorCode,
      });
      user.securitySettings = {
        ...securitySettings,
        lastTwoFactorVerifiedAt: new Date().toISOString(),
      };
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "Invalid two-factor code",
      });
    }
  }

  user.lastLoginAt = new Date();
  user.lastLoginDevice = `${req.headers["user-agent"] || ""}`.slice(0, 180);
  await user.save();

  if (securitySettings.loginAlerts) {
    await sendUserNotificationEmail({
      user,
      type: "security_login",
      subject: "New CoinQuestX sign-in detected",
      headline: "Your account signed in successfully",
      intro:
        "A new session was opened on your CoinQuestX account. If this was not you, update your password and review your security settings immediately.",
      bullets: [
        `Device: ${user.lastLoginDevice || "Unknown device"}`,
        `Time: ${user.lastLoginAt?.toLocaleString?.() || new Date().toLocaleString()}`,
      ],
      bypassPreferences: true,
      metadata: {
        userId: user._id.toString(),
      },
    });
  }

  const token = createToken(user);
  const payload = buildUserPayload(user);

  res.json({
    success: true,
    token,
    data: {
      token,
      ...payload,
      user: payload,
    },
  });
});

export const logout = asyncHandler(async (req, res) => {
  res.json({ success: true, message: "Logged out" });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return res.json({
      success: true,
      message: "If the email exists, a reset link will be sent",
    });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetTokenHash = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  const expiresAt = new Date(
    Date.now() + env.RESET_TOKEN_TTL_MINUTES * 60 * 1000
  );

  user.resetTokenHash = resetTokenHash;
  user.resetTokenExpires = expiresAt;
  await user.save();

  await sendUserNotificationEmail({
    user,
    type: "security_password_reset",
    subject: "Reset your CoinQuestX password",
    headline: "Password reset requested",
    intro:
      "Use the reset token below to complete your password change. If you did not request this, ignore this email and review your security settings.",
    bullets: [
      `Reset token: ${resetToken}`,
      `Expires at: ${expiresAt.toLocaleString()}`,
    ],
    bypassPreferences: true,
    metadata: {
      resetToken,
      expiresAt,
    },
  });

  res.json({
    success: true,
    message: "If the email exists, a reset link will be sent",
    data: {
      resetToken,
      expiresAt,
    },
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({
      success: false,
      message: "Token and new password are required",
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters",
    });
  }

  const resetTokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const user = await User.findOne({
    resetTokenHash,
    resetTokenExpires: { $gt: new Date() },
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired reset token",
    });
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  user.resetTokenHash = "";
  user.resetTokenExpires = undefined;
  await user.save();

  res.json({ success: true, message: "Password reset successful" });
});
