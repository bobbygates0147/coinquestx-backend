import crypto from "crypto";
import BalanceLedger from "../models/BalanceLedger.js";

const roundCurrency = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;

const safeValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? roundCurrency(numeric) : fallback;
};

const buildReason = (transaction) => {
  const metadata = transaction?.metadata || {};
  return {
    reasonKey:
      metadata.reasonKey ||
      `${transaction?.type || "transaction"}:${transaction?.status || "pending"}`
        .toLowerCase()
        .replace(/\s+/g, "_"),
    reasonLabel:
      metadata.reasonLabel ||
      transaction?.paymentMethod ||
      transaction?.type ||
      "Transaction",
  };
};

const computeEntryHash = (payload) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

export const recordTransactionLedgerSnapshot = async (
  transaction,
  previousTransaction = null
) => {
  if (!transaction?.user) return null;

  const balanceBefore = safeValue(transaction.balanceBefore, NaN);
  const balanceAfter = safeValue(transaction.balanceAfter, NaN);

  if (!Number.isFinite(balanceBefore) || !Number.isFinite(balanceAfter)) {
    return null;
  }

  if (
    previousTransaction &&
    safeValue(previousTransaction.balanceBefore, NaN) === balanceBefore &&
    safeValue(previousTransaction.balanceAfter, NaN) === balanceAfter &&
    `${previousTransaction.status || ""}` === `${transaction.status || ""}`
  ) {
    return null;
  }

  const delta = roundCurrency(balanceAfter - balanceBefore);
  if (delta === 0) {
    return null;
  }

  const eventKey = [
    transaction._id?.toString() || "",
    transaction.updatedAt
      ? new Date(transaction.updatedAt).getTime()
      : Date.now(),
    transaction.status || "",
    balanceBefore.toFixed(2),
    balanceAfter.toFixed(2),
  ].join(":");

  const existing = await BalanceLedger.findOne({ eventKey }).lean();
  if (existing) {
    return existing;
  }

  const lastEntry = await BalanceLedger.findOne({ user: transaction.user })
    .sort({ sequence: -1, createdAt: -1 })
    .select("sequence entryHash")
    .lean();

  const sequence = (Number(lastEntry?.sequence) || 0) + 1;
  const previousHash = `${lastEntry?.entryHash || ""}`;
  const { reasonKey, reasonLabel } = buildReason(transaction);

  const basePayload = {
    eventKey,
    user: transaction.user.toString(),
    transaction: transaction._id.toString(),
    sequence,
    previousHash,
    type: transaction.type || "",
    status: transaction.status || "",
    currency: transaction.currency || "USD",
    delta,
    amount: safeValue(transaction.amount, Math.abs(delta)),
    balanceBefore,
    balanceAfter,
    reasonKey,
    reasonLabel,
    sourceFeature: transaction.sourceFeature || "",
    actorRole: transaction.actorRole || "system",
    actor: transaction.actor ? transaction.actor.toString() : "",
    actorLabel: transaction.actorLabel || "",
    details: transaction.details || "",
    metadata: transaction.metadata || {},
  };

  const entryHash = computeEntryHash(basePayload);

  return BalanceLedger.create({
    ...basePayload,
    transaction: transaction._id,
    actor: transaction.actor || null,
    entryHash,
  });
};
