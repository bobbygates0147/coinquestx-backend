import mongoose from "mongoose";

const walletWhitelistEntrySchema = new mongoose.Schema(
  {
    label: { type: String, default: "", trim: true, maxlength: 80 },
    paymentMethod: { type: String, default: "", trim: true, maxlength: 80 },
    network: { type: String, default: "", trim: true, maxlength: 80 },
    destinationHash: {
      type: String,
      default: "",
      trim: true,
      maxlength: 128,
      index: true,
    },
    maskedDestination: { type: String, default: "", trim: true, maxlength: 180 },
    destinationSummary: { type: String, default: "", trim: true, maxlength: 220 },
    destination: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },
    addedAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
    createdByChallenge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SecurityChallenge",
      default: null,
    },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    phoneNumber: { type: String, default: "" },
    country: { type: String, default: "" },
    sex: { type: String, default: "" },
    currencyCode: { type: String, default: "USD" },
    currencySymbol: { type: String, default: "$" },
    photoURL: { type: String, default: "" },
    coverImageURL: { type: String, default: "" },
    balance: { type: Number, default: 0 },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    status: {
      type: String,
      enum: ["active", "suspended", "pending_verification"],
      default: "active",
    },
    transactionCode: { type: String, default: "" },
    kycStatus: {
      type: String,
      enum: ["not_verified", "pending", "verified", "rejected"],
      default: "not_verified",
    },
    kycVerified: { type: Boolean, default: false },
    subscriptionPlan: { type: String, default: "Basic" },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    securitySettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        twoFactorEnabled: false,
        loginAlerts: true,
        withdrawalProtection: true,
        withdrawalCooldownMinutes: 30,
        whitelistMode: "enforced",
        antiPhishingPhrase: "",
        sessionTimeoutMinutes: 30,
        trustedDeviceLabel: "",
        lastSecurityReviewAt: null,
        lastTwoFactorChallengeAt: null,
        lastTwoFactorVerifiedAt: null,
        lastWithdrawalRequestedAt: null,
      }),
    },
    notificationSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        depositEmails: true,
        withdrawalEmails: true,
        kycEmails: true,
        tradeEmails: true,
        referralEmails: true,
        subscriptionEmails: true,
        supportEmails: true,
      }),
    },
    walletWhitelist: {
      type: [walletWhitelistEntrySchema],
      default: [],
    },
    onboarding: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        dismissed: false,
        completedSteps: [],
        lastDismissedAt: null,
      }),
    },
    lastLoginAt: { type: Date, default: null },
    lastLoginDevice: { type: String, default: "" },
    resetTokenHash: { type: String, default: "" },
    resetTokenExpires: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
