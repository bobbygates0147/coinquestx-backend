import mongoose from "mongoose";

const placeTradeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    asset: { type: String, default: "" },
    tradeType: { type: String, default: "" },
    amount: { type: Number, required: true },
    direction: { type: String, default: "" },
    duration: { type: String, default: "" },
    lotSize: { type: Number, default: 0 },
    takeProfit: { type: String, default: "" },
    stopLoss: { type: String, default: "" },
    entryPrice: { type: String, default: "" },
    durationMs: { type: Number },
    startTime: { type: Number },
    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled"],
      default: "Active",
    },
    result: { type: String, enum: ["Win", "Loss", "Pending"], default: "Pending" },
    profitLoss: { type: Number, default: 0 },
    stakeReserved: { type: Boolean, default: false },
    settledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("PlaceTrade", placeTradeSchema);
