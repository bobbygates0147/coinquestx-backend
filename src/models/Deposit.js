import mongoose from "mongoose";

const depositSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    paymentMethod: { type: String, required: true },
    walletAddress: { type: String, required: true },
    network: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Failed", "Cancelled"],
      default: "Pending",
    },
    requestId: { type: String, default: "" },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
  },
  { timestamps: true }
);

export default mongoose.model("Deposit", depositSchema);
