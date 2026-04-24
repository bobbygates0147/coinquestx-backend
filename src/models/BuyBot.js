import mongoose from "mongoose";

const buyBotSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    strategyName: { type: String, default: "" },
    asset: { type: String, default: "" },
    budget: { type: Number, required: true },
    generatedProfit: { type: Number, default: 0 },
    settledProfit: { type: Number, default: 0 },
    lastProfitSettledAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["Active", "Paused", "Completed"],
      default: "Active",
    },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("BuyBot", buyBotSchema);
