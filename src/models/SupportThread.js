import mongoose from "mongoose";

const supportMessageSchema = new mongoose.Schema(
  {
    senderRole: {
      type: String,
      enum: ["user", "admin"],
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    readByUser: {
      type: Boolean,
      default: false,
    },
    readByAdmin: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const supportThreadSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subject: {
      type: String,
      default: "Support Request",
      trim: true,
      maxlength: 180,
    },
    category: {
      type: String,
      default: "general",
      trim: true,
      maxlength: 60,
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "pending", "resolved", "closed"],
      default: "open",
      index: true,
    },
    unreadForUser: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadForAdmin: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastReplyAt: {
      type: Date,
      default: null,
    },
    slaStatus: {
      type: String,
      enum: ["on_track", "due_soon", "breached", "met", "resolved", "paused"],
      default: "on_track",
      index: true,
    },
    slaTargetAt: {
      type: Date,
      default: null,
      index: true,
    },
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    messages: {
      type: [supportMessageSchema],
      default: [],
    },
  },
  { timestamps: true }
);

supportThreadSchema.index({ user: 1, lastMessageAt: -1 });
supportThreadSchema.index({ status: 1, lastMessageAt: -1 });
supportThreadSchema.index({ priority: 1, slaStatus: 1, lastMessageAt: -1 });

export default mongoose.model("SupportThread", supportThreadSchema);
