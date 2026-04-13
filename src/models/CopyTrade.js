import mongoose from "mongoose";

const copyTradeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sourceTraderId: { type: String, default: "" },
    traderName: { type: String, default: "" },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["Active", "Paused", "Completed", "Cancelled"],
      default: "Active",
    },
    performance: { type: Number, default: 0 },
    profitShare: { type: Number, default: 0 },
    realizedProfit: { type: Number, default: 0 },
    lastProfitSettledAt: { type: Date, default: null },
    traderData: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("CopyTrade", copyTradeSchema);
