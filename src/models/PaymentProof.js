import mongoose from "mongoose";

const paymentProofSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    reviewNotes: { type: String, default: "", trim: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    proofImage: { type: String, required: true },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("PaymentProof", paymentProofSchema);
