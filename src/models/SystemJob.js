import mongoose from "mongoose";

const systemJobSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 120,
    },
    leaseOwner: {
      type: String,
      default: "",
      trim: true,
      maxlength: 180,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastStartedAt: {
      type: Date,
      default: null,
    },
    lastFinishedAt: {
      type: Date,
      default: null,
    },
    lastSuccessAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    lastSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model("SystemJob", systemJobSchema);
