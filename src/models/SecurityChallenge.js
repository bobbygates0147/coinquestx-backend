import mongoose from "mongoose";

const securityChallengeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
      index: true,
    },
    channel: {
      type: String,
      enum: ["email"],
      default: "email",
    },
    status: {
      type: String,
      enum: ["pending", "verified", "expired", "cancelled"],
      default: "pending",
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
      max: 10,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    emailTo: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      maxlength: 180,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

securityChallengeSchema.index({ user: 1, type: 1, status: 1, createdAt: -1 });

export default mongoose.model("SecurityChallenge", securityChallengeSchema);
