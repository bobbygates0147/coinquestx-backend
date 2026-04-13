import mongoose from "mongoose";

const adminEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

adminEventSchema.index({ createdAt: -1 });

export default mongoose.model("AdminEvent", adminEventSchema);
