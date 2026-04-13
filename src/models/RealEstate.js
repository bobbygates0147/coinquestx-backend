import mongoose from "mongoose";

const realEstateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Number },
    reference: { type: String, default: "" },
    propertyName: { type: String, default: "" },
    location: { type: String, default: "" },
    amount: { type: Number, required: true },
    roi: { type: Number, default: 0 },
    durationDays: { type: Number, default: 30 },
    startDate: { type: Date },
    endDate: { type: Date },
    expectedPayoutUsd: { type: Number, default: 0 },
    payoutUsd: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled"],
      default: "Active",
    },
  },
  { timestamps: true }
);

export default mongoose.model("RealEstate", realEstateSchema);
