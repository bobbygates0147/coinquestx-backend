import mongoose from "mongoose";
import { recordTransactionLedgerSnapshot } from "../utils/ledgerService.js";

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: [
        "Deposit",
        "Withdrawal",
        "Trade",
        "CopyTrade",
        "PlaceTrade",
        "RealEstate",
        "Signal",
        "Subscription",
        "Mining",
        "Stake",
        "BuyBot",
        "Adjustment",
      ],
      required: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    paymentMethod: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Failed", "Cancelled"],
      default: "Pending",
    },
    walletAddress: { type: String, default: "" },
    network: { type: String, default: "" },
    details: { type: String, default: "" },
    sourceFeature: { type: String, default: "" },
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    actorRole: {
      type: String,
      enum: ["user", "admin", "system"],
      default: "user",
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorLabel: { type: String, default: "" },
    workflow: { type: mongoose.Schema.Types.Mixed, default: {} },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

transactionSchema.pre("save", async function preSave(next) {
  if (this.isNew) {
    this.$locals.previousLedgerSnapshot = null;
    return next();
  }

  try {
    const previous = await this.constructor
      .findById(this._id)
      .select("balanceBefore balanceAfter status updatedAt")
      .lean();
    this.$locals.previousLedgerSnapshot = previous || null;
    return next();
  } catch (error) {
    return next(error);
  }
});

transactionSchema.post("save", async function postSave(doc, next) {
  try {
    await recordTransactionLedgerSnapshot(
      doc,
      doc?.$locals?.previousLedgerSnapshot || null
    );
    return next();
  } catch (error) {
    console.error("Failed to record balance ledger snapshot:", error);
    return next();
  }
});

export default mongoose.model("Transaction", transactionSchema);
