import Transaction from "../models/Transaction.js";

export const roundCurrency = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;

export const normalizeMoney = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundCurrency(parsed) : fallback;
};

export const buildCompletedWorkflow = (submittedAt = new Date()) => ({
  submittedAt,
  completedAt: new Date(),
});

export const applyBalanceChange = async ({
  user,
  delta,
  type,
  paymentMethod = "",
  details = "",
  sourceFeature = "account",
  actorRole = "system",
  actor = null,
  actorLabel = "",
  metadata = {},
  workflow = null,
}) => {
  const signedDelta = normalizeMoney(delta, NaN);
  if (!Number.isFinite(signedDelta) || signedDelta === 0) {
    throw new Error("Balance delta must be a non-zero number");
  }

  const currentBalance = normalizeMoney(user?.balance);
  const nextBalance = normalizeMoney(currentBalance + signedDelta);

  if (nextBalance < 0) {
    throw new Error("Insufficient balance");
  }

  user.balance = nextBalance;
  await user.save();

  const transaction = await Transaction.create({
    user: user._id,
    type,
    amount: Math.abs(signedDelta),
    currency: user?.currencyCode || "USD",
    paymentMethod,
    status: "Completed",
    details,
    sourceFeature,
    balanceBefore: currentBalance,
    balanceAfter: nextBalance,
    actorRole,
    actor: actor || user?._id || null,
    actorLabel: actorLabel || user?.email || "",
    workflow: workflow || buildCompletedWorkflow(),
    metadata: {
      entryDirection: signedDelta > 0 ? "credit" : "debit",
      delta: signedDelta,
      ...metadata,
    },
  });

  return {
    previousBalance: currentBalance,
    balance: nextBalance,
    delta: signedDelta,
    transaction,
  };
};
