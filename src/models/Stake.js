import mongoose from "mongoose";

const stakeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reference: { type: String, default: "" },
    asset: { type: String, default: "" },
    coingeckoId: { type: String, default: "" },
    amount: { type: Number, required: true },
    principalUsd: { type: Number, default: 0 },
    apy: { type: Number, default: 0 },
    durationDays: { type: Number, default: 30 },
    rewardUsdTotal: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled"],
      default: "Active",
    },
    startedAt: { type: Date, default: Date.now },
    endsAt: { type: Date },
    settledAt: { type: Date },
    payoutUsd: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Stake", stakeSchema);
