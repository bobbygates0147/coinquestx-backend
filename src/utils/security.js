import crypto from "crypto";
import { env } from "../config/env.js";
import SecurityChallenge from "../models/SecurityChallenge.js";
import { sendUserNotificationEmail } from "./notificationService.js";

export const defaultSecuritySettings = {
  twoFactorEnabled: false,
  loginAlerts: true,
  withdrawalProtection: true,
  withdrawalCooldownMinutes: env.WITHDRAWAL_COOLDOWN_MINUTES,
  whitelistMode: "enforced",
  antiPhishingPhrase: "",
  sessionTimeoutMinutes: 30,
  trustedDeviceLabel: "",
  lastSecurityReviewAt: null,
  lastTwoFactorChallengeAt: null,
  lastTwoFactorVerifiedAt: null,
  lastWithdrawalRequestedAt: null,
};

export const defaultNotificationSettings = {
  depositEmails: true,
  withdrawalEmails: true,
  kycEmails: true,
  tradeEmails: true,
  referralEmails: true,
  subscriptionEmails: true,
  supportEmails: true,
};

export const normalizeSecuritySettings = (value = {}) => ({
  ...defaultSecuritySettings,
  ...(value && typeof value === "object" ? value : {}),
  withdrawalCooldownMinutes: Math.max(
    0,
    Number(value?.withdrawalCooldownMinutes) ||
      env.WITHDRAWAL_COOLDOWN_MINUTES
  ),
});

export const normalizeNotificationSettings = (value = {}) => ({
  ...defaultNotificationSettings,
  ...(value && typeof value === "object" ? value : {}),
});

export const generateOtpCode = (length = 6) => {
  const max = 10 ** length;
  const number = crypto.randomInt(0, max);
  return `${number}`.padStart(length, "0");
};

export const hashSecurityCode = (code) =>
  crypto.createHash("sha256").update(`${code || ""}`).digest("hex");

export const sanitizeOtpCode = (value) =>
  `${value || ""}`.replace(/\D/g, "").slice(0, 10);

export const buildWithdrawalDestinationProfile = (
  paymentMethod,
  destination = {}
) => {
  const method = `${paymentMethod || ""}`.trim().toLowerCase();
  let fingerprint = method;
  let maskedDestination = "";
  let destinationSummary = "";
  let network = `${destination.network || destination.cryptoAsset || ""}`.trim();

  if (method === "crypto") {
    const address = `${destination.cryptoAddress || destination.btcAddress || ""}`
      .trim()
      .toLowerCase();
    const asset = `${destination.cryptoAsset || ""}`.trim().toUpperCase();
    fingerprint = [method, asset, network.toLowerCase(), address].join("|");
    maskedDestination = address
      ? `${address.slice(0, 6)}...${address.slice(-4)}`
      : "";
    destinationSummary = [asset || "Crypto", maskedDestination].filter(Boolean).join(" ");
  } else if (method === "bank transfer") {
    const bankName = `${destination.bankName || ""}`.trim().toLowerCase();
    const accountNumber = `${destination.bankAccountNumber || ""}`.trim();
    const accountName = `${destination.bankAccountName || ""}`.trim().toLowerCase();
    fingerprint = [method, bankName, accountNumber, accountName].join("|");
    maskedDestination = accountNumber
      ? `${accountNumber.slice(0, 2)}******${accountNumber.slice(-2)}`
      : "";
    destinationSummary = [
      `${destination.bankName || "Bank"}`.trim(),
      maskedDestination,
    ]
      .filter(Boolean)
      .join(" ");
  } else if (method === "cash app") {
    const cashAppId = `${destination.cashAppId || ""}`.trim().toLowerCase();
    fingerprint = [method, cashAppId].join("|");
    maskedDestination = cashAppId ? `${cashAppId.slice(0, 4)}...` : "";
    destinationSummary = `Cash App ${maskedDestination}`.trim();
  } else if (method === "paypal") {
    const paypalEmail = `${destination.paypalEmail || ""}`.trim().toLowerCase();
    fingerprint = [method, paypalEmail].join("|");
    maskedDestination = paypalEmail
      ? `${paypalEmail.slice(0, 3)}***${paypalEmail.slice(paypalEmail.indexOf("@"))}`
      : "";
    destinationSummary = `PayPal ${maskedDestination}`.trim();
  } else if (method === "skrill") {
    const skrillEmail = `${destination.skrillEmail || ""}`.trim().toLowerCase();
    fingerprint = [method, skrillEmail].join("|");
    maskedDestination = skrillEmail
      ? `${skrillEmail.slice(0, 3)}***${skrillEmail.slice(skrillEmail.indexOf("@"))}`
      : "";
    destinationSummary = `Skrill ${maskedDestination}`.trim();
  } else {
    const serialized = JSON.stringify(destination || {});
    fingerprint = [method, serialized].join("|");
    maskedDestination = method || "destination";
    destinationSummary = maskedDestination;
  }

  const destinationHash = crypto
    .createHash("sha256")
    .update(fingerprint)
    .digest("hex");

  return {
    paymentMethod: paymentMethod || "",
    network,
    maskedDestination,
    destinationSummary,
    destinationHash,
    destination,
  };
};

export const findWhitelistEntry = (user, paymentMethod, destination = {}) => {
  const profile = buildWithdrawalDestinationProfile(paymentMethod, destination);
  const entries = Array.isArray(user?.walletWhitelist) ? user.walletWhitelist : [];
  const match = entries.find(
    (entry) =>
      `${entry?.status || "active"}`.toLowerCase() === "active" &&
      `${entry?.destinationHash || ""}` === profile.destinationHash
  );
  return { entry: match || null, profile };
};

export const getWithdrawalCooldownState = (user) => {
  const settings = normalizeSecuritySettings(user?.securitySettings || {});
  const cooldownMinutes = Math.max(
    0,
    Number(settings.withdrawalCooldownMinutes) || env.WITHDRAWAL_COOLDOWN_MINUTES
  );
  const lastAt = settings.lastWithdrawalRequestedAt
    ? new Date(settings.lastWithdrawalRequestedAt).getTime()
    : 0;
  const unlockAt = lastAt + cooldownMinutes * 60 * 1000;
  const remainingMs = Math.max(0, unlockAt - Date.now());
  return {
    cooldownMinutes,
    active: remainingMs > 0,
    remainingMs,
    remainingMinutes: Math.ceil(remainingMs / (60 * 1000)),
    unlockAt: remainingMs > 0 ? new Date(unlockAt) : null,
  };
};

export const createSecurityChallenge = async ({
  user,
  type,
  metadata = {},
  ttlMinutes = env.OTP_TTL_MINUTES,
  subject,
  headline,
  intro,
  bullets = [],
}) => {
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const challenge = await SecurityChallenge.create({
    user: user._id,
    type,
    channel: "email",
    codeHash: hashSecurityCode(code),
    expiresAt,
    emailTo: user.email || "",
    metadata,
  });

  const notification = await sendUserNotificationEmail({
    user,
    type: "security_challenge",
    subject: subject || "Your CoinQuestX security code",
    headline: headline || "Confirm your security action",
    intro:
      intro ||
      `Use this code to complete your security action on CoinQuestX: ${code}`,
    bullets: [...bullets, `Verification code: ${code}`, `Expires in ${ttlMinutes} minutes.`],
    metadata: {
      challengeId: challenge._id.toString(),
      challengeType: type,
      ...metadata,
    },
    bypassPreferences: true,
    footer:
      "If you did not request this action, ignore this email and review your account security settings.",
  });

  const deliveryStatus = `${notification?.status || "skipped"}`.toLowerCase();
  const deliveryError = `${notification?.errorMessage || ""}`.trim();
  const emailDelivered = deliveryStatus === "sent";

  if (!emailDelivered) {
    challenge.status = "cancelled";
    challenge.metadata = {
      ...(challenge.metadata || {}),
      deliveryStatus,
      deliveryError,
    };
    await challenge.save();

    const detail = deliveryError
      ? `Brevo error: ${deliveryError}`
      : "Check your Brevo configuration and verified sender.";
    const error = new Error(
      `Verification email could not be delivered. ${detail}`
    );
    error.status = 503;
    throw error;
  }

  user.securitySettings = {
    ...normalizeSecuritySettings(user.securitySettings),
    lastTwoFactorChallengeAt: new Date().toISOString(),
  };
  await user.save();

  return challenge;
};

export const verifySecurityChallenge = async ({
  challengeId,
  userId,
  type = "",
  code,
}) => {
  const sanitizedCode = sanitizeOtpCode(code);
  if (!challengeId || !sanitizedCode) {
    throw new Error("challengeId and code are required");
  }

  const challenge = await SecurityChallenge.findOne({
    _id: challengeId,
    user: userId,
  });

  if (!challenge) {
    throw new Error("Security challenge not found");
  }

  if (type && `${challenge.type || ""}` !== `${type}`) {
    throw new Error("Security challenge type mismatch");
  }

  if (challenge.status !== "pending") {
    throw new Error("Security challenge is no longer active");
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    challenge.status = "expired";
    await challenge.save();
    throw new Error("Security challenge expired");
  }

  challenge.attempts = (Number(challenge.attempts) || 0) + 1;

  if (challenge.attempts > (Number(challenge.maxAttempts) || 5)) {
    challenge.status = "cancelled";
    await challenge.save();
    throw new Error("Too many invalid verification attempts");
  }

  const isMatch = hashSecurityCode(sanitizedCode) === `${challenge.codeHash || ""}`;
  if (!isMatch) {
    await challenge.save();
    throw new Error("Invalid verification code");
  }

  challenge.status = "verified";
  challenge.verifiedAt = new Date();
  await challenge.save();

  return challenge;
};
