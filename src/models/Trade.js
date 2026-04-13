import mongoose from "mongoose";

const tradeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    asset: { type: String, default: "" },
    amount: { type: Number, required: true },
    direction: { type: String, default: "" },
    leverage: { type: Number, default: 1 },
    duration: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled"],
      default: "Active",
    },
    result: { type: String, enum: ["Win", "Loss", "Pending"], default: "Pending" },
    profitLoss: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("Trade", tradeSchema);
