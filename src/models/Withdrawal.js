import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    paymentMethod: { type: String, required: true },
    details: { type: String, default: "" },
    destination: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Failed", "Cancelled"],
      default: "Pending",
    },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
  },
  { timestamps: true }
);

export default mongoose.model("Withdrawal", withdrawalSchema);
