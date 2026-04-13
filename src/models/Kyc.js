import mongoose from "mongoose";

const legalNameSchema = new mongoose.Schema(
  {
    firstName: { type: String, default: "", trim: true },
    middleName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, default: "", trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    stateProvince: { type: String, default: "", trim: true },
    postalCode: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    front: { type: String, default: "" },
    back: { type: String, default: "" },
    selfie: { type: String, default: "" },
  },
  { _id: false }
);

const kycSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    email: { type: String, default: "", trim: true, lowercase: true },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    legalName: { type: legalNameSchema, default: () => ({}) },
    dateOfBirth: { type: Date },
    phoneNumber: { type: String, default: "", trim: true },
    countryOfResidence: { type: String, default: "", trim: true },
    issuingCountry: { type: String, default: "", trim: true },
    idType: {
      type: String,
      enum: ["passport", "drivers_license", "national_id", "residence_permit", ""],
      default: "",
    },
    idNumber: { type: String, default: "", trim: true },
    address: { type: addressSchema, default: () => ({}) },
    documents: { type: documentSchema, default: () => ({}) },
    governmentId: { type: String, default: "" },
    governmentIdBack: { type: String, default: "" },
    selfie: { type: String, default: "" },
    reviewNotes: { type: String, default: "", trim: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("Kyc", kycSchema);
