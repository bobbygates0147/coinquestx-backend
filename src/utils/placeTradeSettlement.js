const DEFAULT_PLACE_TRADE_DURATION_MS = 5 * 60 * 1000;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const roundPlaceTradeCurrency = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;

export const normalizeTradeResultInput = (value) => {
  const normalized = `${value || ""}`.trim().toLowerCase();
  if (normalized === "win" || normalized === "won") return "Win";
  if (normalized === "loss" || normalized === "lost") return "Loss";
  return null;
};

export const buildPlaceTradeSettlementSeed = (trade) =>
  `${trade?._id || ""}:${trade?.asset || ""}:${trade?.startTime || 0}:${trade?.amount || 0}:${trade?.direction || ""}`;

export const hashPlaceTradeSettlementSeed = (seed) =>
  [...`${seed || ""}`].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % 1000003,
    17
  );

const getBotSnapshot = (trade = {}, payload = {}) => {
  const tradeSnapshot =
    trade?.botSnapshot && typeof trade.botSnapshot === "object"
      ? trade.botSnapshot
      : {};
  const payloadSnapshot =
    payload?.botSnapshot && typeof payload.botSnapshot === "object"
      ? payload.botSnapshot
      : {};

  return {
    ...tradeSnapshot,
    ...payloadSnapshot,
  };
};

const hasBotAssistEnabled = (trade = {}, payload = {}) => {
  const executionMode = `${payload?.executionMode || trade?.executionMode || ""}`
    .trim()
    .toLowerCase();

  return Boolean(
    payload?.buyBotId ||
      trade?.buyBot ||
      trade?.buyBotId ||
      trade?.buyBotName ||
      executionMode === "bot assisted" ||
      getBotSnapshot(trade, payload)?.strategyName
  );
};

export const resolvePlaceTradeSettlement = (trade, payload = {}) => {
  const explicitResult = normalizeTradeResultInput(payload.result);
  const storedResult = normalizeTradeResultInput(trade?.result);
  const amount = roundPlaceTradeCurrency(trade?.amount);
  const seedValue = hashPlaceTradeSettlementSeed(
    buildPlaceTradeSettlementSeed(trade)
  );
  const botSnapshot = getBotSnapshot(trade, payload);
  const hasBotAssist = hasBotAssistEnabled(trade, payload);
  const assistedWinRate = clamp(
    hasBotAssist ? toNumber(botSnapshot?.winRate, 56) : 56,
    56,
    90
  );
  const outcome =
    explicitResult ||
    storedResult ||
    (seedValue % 100 < assistedWinRate ? "Win" : "Loss");

  let profitLoss = Number(payload.profitLoss);
  if (!Number.isFinite(profitLoss)) {
    const baseSwing = 0.045 + (seedValue % 7) * 0.0075;
    const levelBoost = hasBotAssist
      ? clamp(toNumber(botSnapshot?.level, 0) / 2500, 0, 0.02)
      : 0;
    const roiBoost = hasBotAssist
      ? clamp(toNumber(botSnapshot?.monthlyRoi, 0) / 5000, 0, 0.01)
      : 0;
    const swing = baseSwing + levelBoost + roiBoost;

    profitLoss = roundPlaceTradeCurrency(amount * swing);
    if (outcome === "Loss") {
      profitLoss = roundPlaceTradeCurrency(
        -profitLoss * (hasBotAssist ? 0.9 : 1)
      );
    } else if (hasBotAssist) {
      profitLoss = roundPlaceTradeCurrency(profitLoss * 1.05);
    }
  }

  if (outcome === "Win" && profitLoss < 0) {
    profitLoss = Math.abs(profitLoss);
  }
  if (outcome === "Loss" && profitLoss > 0) {
    profitLoss = -profitLoss;
  }

  const settlementAmount = trade?.stakeReserved
    ? Math.max(0, roundPlaceTradeCurrency(amount + profitLoss))
    : roundPlaceTradeCurrency(profitLoss);

  return {
    outcome,
    profitLoss: roundPlaceTradeCurrency(profitLoss),
    settlementAmount: roundPlaceTradeCurrency(settlementAmount),
    executionMode: hasBotAssist ? "Bot Assisted" : "Manual",
    botSnapshot,
  };
};

export const getPlaceTradeDurationInMs = (duration) => {
  if (!duration) return DEFAULT_PLACE_TRADE_DURATION_MS;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return duration > 1000 ? duration : duration * 60 * 1000;
  }

  const [value, unit] = `${duration}`.split(" ");
  const numericValue = Number.parseInt(value, 10);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return DEFAULT_PLACE_TRADE_DURATION_MS;
  }

  switch ((unit || "minutes").toLowerCase()) {
    case "minutes":
    case "minute":
    case "mins":
    case "min":
      return numericValue * 60 * 1000;
    case "hours":
    case "hour":
    case "hr":
    case "hrs":
      return numericValue * 60 * 60 * 1000;
    case "days":
    case "day":
      return numericValue * 24 * 60 * 60 * 1000;
    default:
      return DEFAULT_PLACE_TRADE_DURATION_MS;
  }
};

export const getPlaceTradeSettleAt = (trade) => {
  const startAt =
    Math.max(0, toNumber(trade?.startTime, 0)) ||
    new Date(trade?.createdAt || Date.now()).getTime() ||
    Date.now();
  const durationMs =
    Math.max(0, toNumber(trade?.durationMs, 0)) ||
    getPlaceTradeDurationInMs(trade?.duration);

  return startAt + Math.max(1, durationMs);
};
