import mongoose from "mongoose";

const signalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    provider: { type: String, default: "" },
    title: { type: String, default: "" },
    message: { type: String, default: "" },
    asset: { type: String, default: "" },
    action: { type: String, default: "" },
    accuracy: { type: Number, default: 0 },
    status: { type: String, default: "active" },
    planId: { type: Number },
    planName: { type: String, default: "" },
    amountPaid: { type: Number, default: 0 },
    payoutUsd: { type: Number, default: 0 },
    purchaseDate: { type: Date },
    winRate: { type: String, default: "" },
    dailySignals: { type: Number, default: 0 },
    description: { type: String, default: "" },
    features: { type: [String], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("Signal", signalSchema);
