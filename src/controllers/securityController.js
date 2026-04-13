import { asyncHandler } from "../utils/asyncHandler.js";
import {
  buildWithdrawalDestinationProfile,
  createSecurityChallenge,
  findWhitelistEntry,
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

const getWhitelistEntryById = (user, entryId) =>
  (Array.isArray(user?.walletWhitelist) ? user.walletWhitelist : []).find(
    (entry) => entry?._id?.toString() === `${entryId || ""}`
  );

export const listWalletWhitelist = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: mapWalletWhitelist(req.user?.walletWhitelist || []),
  });
});

export const requestEnableTwoFactor = asyncHandler(async (req, res) => {
  const securitySettings = normalizeSecuritySettings(req.user.securitySettings);
  if (securitySettings.twoFactorEnabled) {
    return res.json({
      success: true,
      message: "Two-factor security is already enabled.",
    });
  }

  const challenge = await createSecurityChallenge({
    user: req.user,
    type: "enable_two_factor",
    subject: "Enable CoinQuestX two-factor security",
    headline: "Verify two-factor setup",
    intro:
      "Use this code to enable email OTP confirmation on sensitive CoinQuestX account actions.",
  });

  res.status(201).json({
    success: true,
    message: "Verification code sent to your email address.",
    data: {
      challengeId: challenge._id.toString(),
      expiresAt: challenge.expiresAt,
    },
  });
});

export const confirmEnableTwoFactor = asyncHandler(async (req, res) => {
  const { challengeId, code } = req.body;
  await verifySecurityChallenge({
    challengeId,
    userId: req.user._id,
    type: "enable_two_factor",
    code,
  });

  req.user.securitySettings = {
    ...normalizeSecuritySettings(req.user.securitySettings),
    twoFactorEnabled: true,
    lastTwoFactorVerifiedAt: new Date().toISOString(),
    lastSecurityReviewAt: new Date().toISOString(),
  };
  await req.user.save();

  await sendUserNotificationEmail({
    user: req.user,
    type: "security_change",
    subject: "Two-factor security enabled",
    headline: "Two-factor verification is now active",
    intro:
      "CoinQuestX will now require an email OTP for protected sign-ins and wallet actions.",
    bypassPreferences: true,
  });

  res.json({
    success: true,
    data: {
      twoFactorEnabled: true,
      securitySettings: req.user.securitySettings,
    },
  });
});

export const disableTwoFactor = asyncHandler(async (req, res) => {
  const { challengeId, code } = req.body;
  const settings = normalizeSecuritySettings(req.user.securitySettings);

  if (!settings.twoFactorEnabled) {
    return res.json({
      success: true,
      message: "Two-factor security is already disabled.",
      data: {
        twoFactorEnabled: false,
        securitySettings: settings,
      },
    });
  }

  if (!challengeId || !code) {
    const challenge = await createSecurityChallenge({
      user: req.user,
      type: "disable_two_factor",
      subject: "Confirm two-factor deactivation",
      headline: "Approve two-factor removal",
      intro:
        "Use this code to disable email OTP protection on your CoinQuestX account.",
    });

    return res.status(202).json({
      success: false,
      requiresVerification: true,
      message: "Verification code sent to your email address.",
      data: {
        challengeId: challenge._id.toString(),
        expiresAt: challenge.expiresAt,
      },
    });
  }

  await verifySecurityChallenge({
    challengeId,
    userId: req.user._id,
    type: "disable_two_factor",
    code,
  });

  req.user.securitySettings = {
    ...settings,
    twoFactorEnabled: false,
    lastSecurityReviewAt: new Date().toISOString(),
  };
  await req.user.save();

  await sendUserNotificationEmail({
    user: req.user,
    type: "security_change",
    subject: "Two-factor security disabled",
    headline: "Two-factor verification was disabled",
    intro:
      "If you did not make this change, secure your account immediately and contact support.",
    bypassPreferences: true,
  });

  res.json({
    success: true,
    data: {
      twoFactorEnabled: false,
      securitySettings: req.user.securitySettings,
    },
  });
});

export const requestWhitelistAdd = asyncHandler(async (req, res) => {
  const { label = "", paymentMethod, destination = {} } = req.body;
  if (!paymentMethod) {
    return res.status(400).json({
      success: false,
      message: "paymentMethod is required",
    });
  }

  const { entry, profile } = findWhitelistEntry(
    req.user,
    paymentMethod,
    destination
  );

  if (entry) {
    return res.json({
      success: true,
      message: "Destination already exists in whitelist.",
      data: {
        entry: mapWalletWhitelist([entry])[0],
      },
    });
  }

  const challenge = await createSecurityChallenge({
    user: req.user,
    type: "add_wallet_whitelist",
    metadata: {
      label: `${label || ""}`.trim(),
      paymentMethod: profile.paymentMethod,
      network: profile.network,
      destination: profile.destination,
      destinationHash: profile.destinationHash,
      maskedDestination: profile.maskedDestination,
      destinationSummary: profile.destinationSummary,
    },
    subject: "Confirm new withdrawal destination",
    headline: "Approve wallet whitelist update",
    intro:
      "Use this code to approve a new withdrawal destination on your CoinQuestX account.",
    bullets: [
      `Method: ${profile.paymentMethod}`,
      `Destination: ${profile.destinationSummary || profile.maskedDestination}`,
    ],
  });

  res.status(201).json({
    success: true,
    message: "Verification code sent to your email address.",
    data: {
      challengeId: challenge._id.toString(),
      expiresAt: challenge.expiresAt,
      destinationSummary: profile.destinationSummary,
    },
  });
});

export const confirmWhitelistAdd = asyncHandler(async (req, res) => {
  const { challengeId, code } = req.body;
  const challenge = await verifySecurityChallenge({
    challengeId,
    userId: req.user._id,
    type: "add_wallet_whitelist",
    code,
  });

  const metadata = challenge.metadata || {};
  const existing = (Array.isArray(req.user.walletWhitelist)
    ? req.user.walletWhitelist
    : []
  ).find((entry) => entry?.destinationHash === metadata.destinationHash);

  if (!existing) {
    req.user.walletWhitelist.push({
      label: `${metadata.label || ""}`.trim(),
      paymentMethod: metadata.paymentMethod || "",
      network: metadata.network || "",
      destinationHash: metadata.destinationHash || "",
      maskedDestination: metadata.maskedDestination || "",
      destinationSummary: metadata.destinationSummary || "",
      destination: metadata.destination || {},
      status: "active",
      addedAt: new Date(),
      createdByChallenge: challenge._id,
    });
  } else {
    existing.label = `${metadata.label || existing.label || ""}`.trim();
    existing.paymentMethod = metadata.paymentMethod || existing.paymentMethod || "";
    existing.network = metadata.network || existing.network || "";
    existing.maskedDestination =
      metadata.maskedDestination || existing.maskedDestination || "";
    existing.destinationSummary =
      metadata.destinationSummary || existing.destinationSummary || "";
    existing.destination = metadata.destination || existing.destination || {};
    existing.status = "active";
    if (!existing.addedAt) {
      existing.addedAt = new Date();
    }
    existing.createdByChallenge = challenge._id;
  }

  await req.user.save();

  await sendUserNotificationEmail({
    user: req.user,
    type: "security_change",
    subject: "Withdrawal destination approved",
    headline: "A wallet whitelist entry was added",
    intro:
      "Your withdrawal whitelist has been updated with a newly approved destination.",
    bullets: [
      `Method: ${metadata.paymentMethod || "Unknown"}`,
      `Destination: ${metadata.destinationSummary || metadata.maskedDestination || "Approved destination"}`,
    ],
    bypassPreferences: true,
  });

  res.json({
    success: true,
    data: mapWalletWhitelist(req.user.walletWhitelist || []),
  });
});

export const removeWhitelistEntry = asyncHandler(async (req, res) => {
  const entry = getWhitelistEntryById(req.user, req.params.entryId);
  if (!entry) {
    return res.status(404).json({
      success: false,
      message: "Whitelist entry not found",
    });
  }

  entry.status = "disabled";
  await req.user.save();

  await sendUserNotificationEmail({
    user: req.user,
    type: "security_change",
    subject: "Withdrawal destination removed",
    headline: "A wallet whitelist entry was disabled",
    intro:
      "One of your approved withdrawal destinations was removed from active use.",
    bullets: [
      `Method: ${entry.paymentMethod || "Unknown"}`,
      `Destination: ${entry.destinationSummary || entry.maskedDestination || "Removed destination"}`,
    ],
    bypassPreferences: true,
  });

  res.json({
    success: true,
    data: mapWalletWhitelist(req.user.walletWhitelist || []),
  });
});
