import mongoose from "mongoose";

const referralSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referred: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    referredEmail: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Active"],
      default: "Pending",
    },
    rewardAmount: { type: Number, default: 0 },
    rewardStatus: {
      type: String,
      enum: ["Pending", "Paid"],
      default: "Pending",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Referral", referralSchema);
