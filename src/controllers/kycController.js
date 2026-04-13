import Kyc from "../models/Kyc.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const ALLOWED_ID_TYPES = new Set([
  "passport",
  "drivers_license",
  "national_id",
  "residence_permit",
]);

const trimValue = (value) => `${value || ""}`.trim();

const toBase64WithPrefix = (file) => {
  if (!file) return "";
  const base64 = file.buffer.toString("base64");
  return `data:${file.mimetype};base64,${base64}`;
};

const toDateInputValue = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const serializeKycSubmission = (kyc, userOverride = null) => {
  if (!kyc) return null;

  const user =
    userOverride ||
    (kyc.user && typeof kyc.user === "object" && "_id" in kyc.user ? kyc.user : null);

  const documentFront = kyc.documents?.front || kyc.governmentId || "";
  const documentBack = kyc.documents?.back || kyc.governmentIdBack || "";
  const selfie = kyc.documents?.selfie || kyc.selfie || "";

  return {
    id: kyc._id.toString(),
    userId: user?._id?.toString() || kyc.user?.toString() || "",
    email: kyc.email || user?.email || "",
    name: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "",
    status: kyc.status || "pending",
    verified: kyc.status === "verified",
    legalFirstName: kyc.legalName?.firstName || user?.firstName || "",
    legalMiddleName: kyc.legalName?.middleName || "",
    legalLastName: kyc.legalName?.lastName || user?.lastName || "",
    dateOfBirth: toDateInputValue(kyc.dateOfBirth),
    phoneNumber: kyc.phoneNumber || user?.phoneNumber || "",
    countryOfResidence: kyc.countryOfResidence || user?.country || "",
    issuingCountry: kyc.issuingCountry || "",
    idType: kyc.idType || "",
    idNumber: kyc.idNumber || "",
    addressLine1: kyc.address?.line1 || "",
    addressLine2: kyc.address?.line2 || "",
    city: kyc.address?.city || "",
    stateProvince: kyc.address?.stateProvince || "",
    postalCode: kyc.address?.postalCode || "",
    documents: {
      front: documentFront,
      back: documentBack,
      selfie,
    },
    governmentId: documentFront,
    governmentIdBack: documentBack,
    selfie,
    reviewNotes: kyc.reviewNotes || "",
    submittedAt: kyc.submittedAt || kyc.createdAt || null,
    reviewedAt: kyc.reviewedAt || null,
    updatedAt: kyc.updatedAt || null,
  };
};

const calculateAge = (value) => {
  const birthDate = new Date(value);
  if (Number.isNaN(birthDate.getTime())) return 0;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return age;
};

const buildValidationErrors = ({
  legalFirstName,
  legalLastName,
  dateOfBirth,
  phoneNumber,
  countryOfResidence,
  issuingCountry,
  idType,
  idNumber,
  addressLine1,
  city,
  stateProvince,
  postalCode,
  governmentId,
  selfie,
}) => {
  const errors = {};

  if (!legalFirstName) errors.legalFirstName = "Legal first name is required";
  if (!legalLastName) errors.legalLastName = "Legal last name is required";
  if (!dateOfBirth) {
    errors.dateOfBirth = "Date of birth is required";
  } else {
    const date = new Date(dateOfBirth);
    if (Number.isNaN(date.getTime())) {
      errors.dateOfBirth = "Enter a valid date of birth";
    } else if (date > new Date()) {
      errors.dateOfBirth = "Date of birth cannot be in the future";
    } else if (calculateAge(dateOfBirth) < 18) {
      errors.dateOfBirth = "You must be at least 18 years old";
    }
  }

  if (!phoneNumber) errors.phoneNumber = "Phone number is required";
  if (!countryOfResidence) {
    errors.countryOfResidence = "Country of residence is required";
  }
  if (!issuingCountry) errors.issuingCountry = "Issuing country is required";
  if (!idType) {
    errors.idType = "ID type is required";
  } else if (!ALLOWED_ID_TYPES.has(idType)) {
    errors.idType = "Select a valid ID type";
  }
  if (!idNumber) errors.idNumber = "ID number is required";
  if (!addressLine1) errors.addressLine1 = "Address line 1 is required";
  if (!city) errors.city = "City is required";
  if (!stateProvince) errors.stateProvince = "State or province is required";
  if (!postalCode) errors.postalCode = "Postal code is required";
  if (!governmentId) {
    errors.governmentId = "Front image of the selected ID is required";
  }
  if (!selfie) {
    errors.selfie = "A selfie holding the same ID is required";
  }

  return errors;
};

export const getKycSubmission = asyncHandler(async (req, res) => {
  const kyc = await Kyc.findOne({ user: req.user._id });

  res.json({
    success: true,
    data: serializeKycSubmission(kyc, req.user),
    status: req.user.kycStatus || "not_verified",
    verified: Boolean(req.user.kycVerified),
  });
});

export const submitKyc = asyncHandler(async (req, res) => {
  const existingKyc = await Kyc.findOne({ user: req.user._id });

  const legalFirstName = trimValue(
    req.body.legalFirstName ||
      req.body.firstName ||
      existingKyc?.legalName?.firstName ||
      req.user.firstName
  );
  const legalMiddleName = trimValue(
    req.body.legalMiddleName || req.body.middleName || existingKyc?.legalName?.middleName
  );
  const legalLastName = trimValue(
    req.body.legalLastName ||
      req.body.lastName ||
      existingKyc?.legalName?.lastName ||
      req.user.lastName
  );
  const dateOfBirth = trimValue(
    req.body.dateOfBirth || req.body.DateOfBirth || toDateInputValue(existingKyc?.dateOfBirth)
  );
  const phoneNumber = trimValue(
    req.body.phoneNumber || req.body.PhoneNumber || existingKyc?.phoneNumber || req.user.phoneNumber
  );
  const countryOfResidence = trimValue(
    req.body.countryOfResidence ||
      req.body.Country ||
      req.body.country ||
      existingKyc?.countryOfResidence ||
      req.user.country
  );
  const issuingCountry = trimValue(
    req.body.issuingCountry || req.body.IssuingCountry || existingKyc?.issuingCountry
  );
  const idType = trimValue(
    req.body.idType || req.body.IdType || existingKyc?.idType
  ).toLowerCase();
  const idNumber = trimValue(
    req.body.idNumber || req.body.IdNumber || existingKyc?.idNumber
  );
  const addressLine1 = trimValue(
    req.body.addressLine1 || req.body.AddressLine1 || existingKyc?.address?.line1
  );
  const addressLine2 = trimValue(
    req.body.addressLine2 || req.body.AddressLine2 || existingKyc?.address?.line2
  );
  const city = trimValue(req.body.city || req.body.City || existingKyc?.address?.city);
  const stateProvince = trimValue(
    req.body.stateProvince || req.body.StateProvince || existingKyc?.address?.stateProvince
  );
  const postalCode = trimValue(
    req.body.postalCode || req.body.PostalCode || existingKyc?.address?.postalCode
  );

  let governmentId =
    toBase64WithPrefix(req.files?.GovernmentIssuedId?.[0]) ||
    trimValue(req.body.GovernmentIssuedId) ||
    existingKyc?.documents?.front ||
    existingKyc?.governmentId ||
    "";

  let governmentIdBack =
    toBase64WithPrefix(req.files?.GovernmentIssuedIdBack?.[0]) ||
    trimValue(req.body.GovernmentIssuedIdBack) ||
    existingKyc?.documents?.back ||
    existingKyc?.governmentIdBack ||
    "";

  let selfie =
    toBase64WithPrefix(req.files?.SelfieWithId?.[0]) ||
    trimValue(req.body.SelfieWithId) ||
    existingKyc?.documents?.selfie ||
    existingKyc?.selfie ||
    "";

  const validationErrors = buildValidationErrors({
    legalFirstName,
    legalLastName,
    dateOfBirth,
    phoneNumber,
    countryOfResidence,
    issuingCountry,
    idType,
    idNumber,
    addressLine1,
    city,
    stateProvince,
    postalCode,
    governmentId,
    selfie,
  });

  if (Object.keys(validationErrors).length > 0) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: validationErrors,
    });
  }

  const status = env.AUTO_VERIFY_KYC ? "verified" : "pending";

  const update = {
    user: req.user._id,
    email: trimValue(req.body.Email || req.user.email).toLowerCase(),
    status,
    legalName: {
      firstName: legalFirstName,
      middleName: legalMiddleName,
      lastName: legalLastName,
    },
    dateOfBirth: new Date(dateOfBirth),
    phoneNumber,
    countryOfResidence,
    issuingCountry,
    idType,
    idNumber,
    address: {
      line1: addressLine1,
      line2: addressLine2,
      city,
      stateProvince,
      postalCode,
    },
    documents: {
      front: governmentId,
      back: governmentIdBack,
      selfie,
    },
    governmentId,
    governmentIdBack,
    selfie,
    reviewNotes: "",
    reviewedAt: status === "verified" ? new Date() : null,
    reviewedBy: status === "verified" ? req.user._id : null,
    submittedAt: new Date(),
  };

  const kyc = await Kyc.findOneAndUpdate({ user: req.user._id }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  req.user.firstName = legalFirstName;
  req.user.lastName = legalLastName;
  req.user.phoneNumber = phoneNumber;
  req.user.country = countryOfResidence;
  req.user.kycStatus = status;
  req.user.kycVerified = status === "verified";
  await req.user.save();

  await sendUserNotificationEmail({
    user: req.user,
    type: "kyc",
    subject:
      status === "verified"
        ? "KYC approved automatically"
        : "KYC submitted for review",
    headline:
      status === "verified"
        ? "Your KYC review is complete"
        : "Your KYC submission is pending review",
    intro:
      status === "verified"
        ? "CoinQuestX approved your identity submission and protected features are now available."
        : "CoinQuestX received your identity documents. The compliance team will review them before protected features unlock.",
    bullets: [
      `Legal name: ${legalFirstName} ${legalLastName}`.trim(),
      `Document type: ${idType}`,
      `Country of residence: ${countryOfResidence}`,
      `Status: ${status}`,
    ],
    metadata: {
      kycId: kyc._id.toString(),
      status,
    },
  });

  res.json({
    success: true,
    data: {
      id: kyc._id.toString(),
      status: req.user.kycStatus,
      verified: req.user.kycVerified,
      submission: serializeKycSubmission(kyc, req.user),
    },
  });
});
