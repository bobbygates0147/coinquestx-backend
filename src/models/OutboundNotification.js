import mongoose from "mongoose";

const outboundNotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    channel: {
      type: String,
      enum: ["email"],
      default: "email",
    },
    provider: {
      type: String,
      default: "brevo",
      trim: true,
      maxlength: 40,
    },
    recipient: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 180,
    },
    subject: {
      type: String,
      default: "",
      trim: true,
      maxlength: 220,
    },
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "skipped"],
      default: "pending",
      index: true,
    },
    providerMessageId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 180,
    },
    errorMessage: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sentAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

outboundNotificationSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("OutboundNotification", outboundNotificationSchema);
