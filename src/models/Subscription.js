import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    planName: { type: String, default: "Basic" },
    price: { type: Number, default: 0 },
    payoutUsd: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Active", "Cancelled", "Expired"],
      default: "Active",
    },
    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date },
    expiryNotificationSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Subscription", subscriptionSchema);
