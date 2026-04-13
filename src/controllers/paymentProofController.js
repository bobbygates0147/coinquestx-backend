import PaymentProof from "../models/PaymentProof.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const formatUsd = (value) => `$${Number(value || 0).toFixed(2)}`;

const normalizePaymentProofStatus = (value) => {
  const normalized = `${value || ""}`.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "pending") return "Pending";
  return "";
};

const mapPaymentProof = (proof, { includeUser = false, includeImage = false } = {}) => {
  const reviewer =
    proof?.reviewedBy && typeof proof.reviewedBy === "object" ? proof.reviewedBy : null;
  const user = proof?.user && typeof proof.user === "object" ? proof.user : null;

  return {
    id: proof._id.toString(),
    amount: proof.amount,
    reason: proof.reason,
    status: proof.status,
    reviewNotes: proof.reviewNotes || "",
    reviewedAt: proof.reviewedAt || null,
    reviewedByEmail: reviewer?.email || "",
    fileName: proof.fileName || "",
    mimeType: proof.mimeType || "",
    fileSize: Number(proof.fileSize) || 0,
    createdAt: proof.createdAt,
    updatedAt: proof.updatedAt,
    ...(includeUser
      ? {
          userId: user?._id?.toString() || proof.user?.toString?.() || "",
          userName:
            [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
            user?.email ||
            "Unknown user",
          userEmail: user?.email || "",
        }
      : {}),
    ...(includeImage ? { proofImage: proof.proofImage || "" } : {}),
  };
};

const toBase64WithPrefix = (file) => {
  if (!file) return "";
  const base64 = file.buffer.toString("base64");
  return `data:${file.mimetype};base64,${base64}`;
};

export const submitPaymentProof = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  const reason = `${req.body.reason || ""}`.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid amount is required",
    });
  }

  if (!reason) {
    return res.status(400).json({
      success: false,
      message: "Reason is required",
    });
  }

  let proofImage = "";
  if (req.file) {
    proofImage = toBase64WithPrefix(req.file);
  }

  if (!proofImage && req.body.proofImage) {
    proofImage = req.body.proofImage;
  }

  if (!proofImage) {
    return res.status(400).json({
      success: false,
      message: "Payment proof image is required",
    });
  }

  const proof = await PaymentProof.create({
    user: req.user._id,
    amount,
    reason,
    status: "Pending",
    proofImage,
    fileName: req.file?.originalname || "",
    mimeType: req.file?.mimetype || "",
    fileSize: req.file?.size || 0,
  });

  await sendUserNotificationEmail({
    user: req.user,
    type: "payment_proof",
    subject: "Payment proof submitted",
    headline: "Your payment proof is pending review",
    intro:
      "CoinQuestX received your payment proof. The admin team can now review it alongside your deposit request.",
    bullets: [
      `Amount: ${formatUsd(amount)}`,
      `Reason: ${reason}`,
      "Status: Pending",
    ],
    metadata: {
      paymentProofId: proof._id.toString(),
      status: proof.status,
    },
  });

  res.status(201).json({
    success: true,
    data: mapPaymentProof(proof),
  });
});

export const listPaymentProofs = asyncHandler(async (req, res) => {
  const proofs = await PaymentProof.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

  const data = proofs.map((proof) => mapPaymentProof(proof));

  res.json({ success: true, data });
});

export const listAdminPaymentProofs = asyncHandler(async (req, res) => {
  const statusFilter = normalizePaymentProofStatus(req.query.status);
  const filter = statusFilter ? { status: statusFilter } : {};

  const proofs = await PaymentProof.find(filter)
    .populate("user", "firstName lastName email")
    .populate("reviewedBy", "email firstName lastName")
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    data: proofs.map((proof) =>
      mapPaymentProof(proof, { includeUser: true, includeImage: true })
    ),
  });
});

export const updatePaymentProofStatus = asyncHandler(async (req, res) => {
  const nextStatus = normalizePaymentProofStatus(req.body.status);
  if (!nextStatus) {
    return res.status(400).json({
      success: false,
      message: "A valid status is required",
    });
  }

  const proof = await PaymentProof.findById(req.params.proofId).populate(
    "user",
    "firstName lastName email notificationSettings"
  );
  if (!proof) {
    return res.status(404).json({
      success: false,
      message: "Payment proof not found",
    });
  }

  const previousStatus = proof.status;
  const reviewNotes = `${req.body.reviewNotes || ""}`.trim().slice(0, 500);

  proof.status = nextStatus;
  proof.reviewNotes = reviewNotes;
  if (nextStatus === "Pending") {
    proof.reviewedAt = null;
    proof.reviewedBy = null;
  } else {
    proof.reviewedAt = new Date();
    proof.reviewedBy = req.user?._id || null;
  }
  await proof.save();
  await proof.populate("reviewedBy", "email firstName lastName");

  if (proof.user && (previousStatus !== nextStatus || reviewNotes)) {
    await sendUserNotificationEmail({
      user: proof.user,
      type: "payment_proof",
      subject: `Payment proof ${nextStatus.toLowerCase()}`,
      headline: `Your payment proof is now ${nextStatus.toLowerCase()}`,
      intro:
        nextStatus === "Approved"
          ? "CoinQuestX reviewed your uploaded payment proof and marked it approved."
          : nextStatus === "Rejected"
          ? "CoinQuestX reviewed your uploaded payment proof and marked it rejected."
          : "CoinQuestX moved your payment proof back into the pending review queue.",
      bullets: [
        `Amount: ${formatUsd(proof.amount)}`,
        `Reason: ${proof.reason}`,
        `Status: ${nextStatus}`,
        reviewNotes ? `Review note: ${reviewNotes}` : "Review note: None",
      ],
      metadata: {
        paymentProofId: proof._id.toString(),
        previousStatus,
        status: nextStatus,
      },
    });
  }

  res.json({
    success: true,
    data: mapPaymentProof(proof, {
      includeUser: true,
      includeImage: true,
    }),
  });
});
