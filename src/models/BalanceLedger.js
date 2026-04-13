import mongoose from "mongoose";

const balanceLedgerSchema = new mongoose.Schema(
  {
    eventKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 220,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
      index: true,
    },
    sequence: {
      type: Number,
      default: 0,
      min: 0,
    },
    previousHash: {
      type: String,
      default: "",
      trim: true,
      maxlength: 128,
    },
    entryHash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    type: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },
    status: {
      type: String,
      default: "",
      trim: true,
      maxlength: 40,
    },
    currency: {
      type: String,
      default: "USD",
      trim: true,
      maxlength: 12,
    },
    delta: {
      type: Number,
      required: true,
    },
    amount: {
      type: Number,
      default: 0,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    reasonKey: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    reasonLabel: {
      type: String,
      default: "",
      trim: true,
      maxlength: 180,
    },
    sourceFeature: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    actorRole: {
      type: String,
      default: "system",
      trim: true,
      maxlength: 40,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorLabel: {
      type: String,
      default: "",
      trim: true,
      maxlength: 180,
    },
    details: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

balanceLedgerSchema.index({ user: 1, createdAt: -1 });
balanceLedgerSchema.index({ user: 1, sequence: -1 });

export default mongoose.model("BalanceLedger", balanceLedgerSchema);
