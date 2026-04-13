import mongoose from "mongoose";

const miningSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    asset: { type: String, default: "" },
    hashRate: { type: Number, default: 0 },
    boostBotId: { type: Number, default: null },
    rewardBalance: { type: Number, default: 0 },
    totalPaidUsd: { type: Number, default: 0 },
    lastClaimedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["Active", "Paused", "Completed"],
      default: "Active",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Mining", miningSchema);
