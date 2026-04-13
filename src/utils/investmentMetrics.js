const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COPY_TRADE_CYCLE_DAYS = 30;
const DEFAULT_BOT_CYCLE_DAYS = 30;

export const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeStatus = (value) => `${value || ""}`.trim().toLowerCase();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toTimestamp = (value, fallback = Date.now()) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : fallback;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

const getTimedProgress = ({
  startAt,
  endAt,
  durationMs,
  now = Date.now(),
}) => {
  const safeStart = toTimestamp(startAt, now);
  const safeDuration =
    toNumber(durationMs, 0) > 0
      ? toNumber(durationMs, 0)
      : Math.max(1, toTimestamp(endAt, safeStart) - safeStart);
  const elapsedMs = Math.max(0, now - safeStart);

  return {
    startAt: safeStart,
    endAt: safeStart + safeDuration,
    durationMs: safeDuration,
    elapsedMs,
    progress: clamp(elapsedMs / safeDuration, 0, 1),
  };
};

export const getCopyTradeMetrics = (trade, now = Date.now()) => {
  const amount = Math.max(0, toNumber(trade?.amount));
  const performance = Math.max(0, toNumber(trade?.performance));
  const profitShare = clamp(
    Math.max(
      0,
      toNumber(
        trade?.profitShare,
        toNumber(trade?.traderData?.profitShare, 0)
      )
    ),
    0,
    100
  );
  const persistedSettledProfit = Math.max(
    0,
    toNumber(
      trade?.realizedProfit,
      toNumber(
        trade?.traderData?.settledProfit,
        toNumber(trade?.traderData?.realizedProfit, 0)
      )
    )
  );
  const cycleDays = Math.max(
    1,
    toNumber(trade?.traderData?.cycleDays, DEFAULT_COPY_TRADE_CYCLE_DAYS)
  );
  const status = normalizeStatus(trade?.status);
  const timing = getTimedProgress({
    startAt: trade?.createdAt || trade?.copiedAt,
    durationMs: cycleDays * DAY_MS,
    now,
  });
  const growthMultiplier = 1.04 + Math.expm1(clamp(amount / 700, 0, 4) * 0.3) * 0.5;
  const profitShareBoostRate = Math.min(0.04, profitShare / 700);
  const cycleReturnRate =
    performance > 0
      ? Math.min(
          0.7,
          ((performance / 100) + profitShareBoostRate) * growthMultiplier
        )
      : 0;
  const projectedValue = amount * (1 + cycleReturnRate);
  const projectedProfit = Math.max(0, projectedValue - amount);
  const compoundedValue =
    amount > 0
      ? amount *
        Math.pow(Math.max(1, projectedValue / amount), timing.progress)
      : 0;
  const computedAccruedProfit =
    status === "completed"
      ? projectedProfit
      : ["active", "paused"].includes(status)
      ? Math.max(0, compoundedValue - amount)
      : 0;
  const accruedProfit = Math.max(computedAccruedProfit, persistedSettledProfit);
  const settledProfit = Math.min(accruedProfit, persistedSettledProfit);
  const pendingProfit = Math.max(0, accruedProfit - settledProfit);

  return {
    amount,
    performance,
    cycleDays,
    progress: timing.progress,
    projectedProfit,
    accruedProfit,
    settledProfit,
    pendingProfit,
    currentValue: amount + pendingProfit,
    isActive: ["active", "paused"].includes(status),
    isCompleted: status === "completed",
  };
};

export const getStakeMetrics = (stake, now = Date.now()) => {
  const principalUsd = Math.max(
    0,
    toNumber(stake?.principalUsd, toNumber(stake?.amount))
  );
  const durationDays = Math.max(1, toNumber(stake?.durationDays, 30));
  const rewardUsdTotal = Math.max(
    0,
    toNumber(
      stake?.rewardUsdTotal,
      (principalUsd * toNumber(stake?.apy) * durationDays) / 36500
    )
  );
  const status = normalizeStatus(stake?.status);
  const timing = getTimedProgress({
    startAt: stake?.startedAt || stake?.createdAt,
    endAt: stake?.endsAt,
    durationMs: durationDays * DAY_MS,
    now,
  });
  const realizedProfit = Math.max(
    0,
    toNumber(stake?.payoutUsd) > 0
      ? toNumber(stake?.payoutUsd) - principalUsd
      : rewardUsdTotal
  );
  const accruedProfit =
    status === "completed"
      ? realizedProfit
      : status === "active"
      ? rewardUsdTotal * timing.progress
      : 0;

  return {
    principalUsd,
    rewardUsdTotal,
    progress: timing.progress,
    accruedProfit,
    payoutAtMaturity: principalUsd + rewardUsdTotal,
    isActive: status === "active",
    isCompleted: status === "completed",
  };
};

export const getRealEstateMetrics = (investment, now = Date.now()) => {
  const principalUsd = Math.max(0, toNumber(investment?.amount));
  const durationDays = Math.max(1, toNumber(investment?.durationDays, 30));
  const expectedPayoutUsd = Math.max(
    principalUsd,
    toNumber(
      investment?.expectedPayoutUsd,
      principalUsd + (principalUsd * toNumber(investment?.roi)) / 100
    )
  );
  const expectedProfitUsd = Math.max(0, expectedPayoutUsd - principalUsd);
  const status = normalizeStatus(investment?.status);
  const timing = getTimedProgress({
    startAt: investment?.startDate || investment?.createdAt,
    endAt: investment?.endDate,
    durationMs: durationDays * DAY_MS,
    now,
  });
  const accruedProfit =
    status === "completed"
      ? expectedProfitUsd
      : status === "active"
      ? expectedProfitUsd * timing.progress
      : 0;

  return {
    principalUsd,
    expectedPayoutUsd,
    expectedProfitUsd,
    progress: timing.progress,
    accruedProfit,
    isActive: status === "active",
    isCompleted: status === "completed",
  };
};

export const getBuyBotMetrics = (bot, now = Date.now()) => {
  const capital = Math.max(0, toNumber(bot?.budget));
  const monthlyRoi = Math.max(0, toNumber(bot?.settings?.monthlyRoi));
  const status = normalizeStatus(bot?.status);
  const createdAt = toTimestamp(bot?.createdAt, now);
  const stopAt =
    status === "active" ? now : toTimestamp(bot?.updatedAt, createdAt);
  const elapsedMs = Math.max(0, stopAt - createdAt);
  const accruedProfit =
    monthlyRoi > 0
      ? capital *
        (monthlyRoi / 100) *
        (elapsedMs / (DEFAULT_BOT_CYCLE_DAYS * DAY_MS))
      : 0;

  return {
    capital,
    monthlyRoi,
    accruedProfit,
    currentValue: capital + accruedProfit,
    elapsedMs,
    isActive: status === "active",
  };
};

const sumBy = (items, selector) =>
  items.reduce((total, item) => total + toNumber(selector(item), 0), 0);

export const summarizeInvestmentRevenue = ({
  trades = [],
  placeTrades = [],
  copyTrades = [],
  miningRuns = [],
  stakes = [],
  bots = [],
  realEstate = [],
  now = Date.now(),
}) => {
  const completedTrades = trades.filter(
    (trade) => normalizeStatus(trade?.status) === "completed"
  );
  const completedPlaceTrades = placeTrades.filter(
    (trade) => normalizeStatus(trade?.status) === "completed"
  );
  const activeCopyTrades = copyTrades.filter((trade) =>
    ["active", "paused"].includes(normalizeStatus(trade?.status))
  );
  const completedCopyTrades = copyTrades.filter(
    (trade) => normalizeStatus(trade?.status) === "completed"
  );
  const activeStakes = stakes.filter(
    (stake) => normalizeStatus(stake?.status) === "active"
  );
  const completedStakes = stakes.filter(
    (stake) => normalizeStatus(stake?.status) === "completed"
  );
  const activeBots = bots.filter(
    (bot) => normalizeStatus(bot?.status) === "active"
  );
  const activeRealEstate = realEstate.filter(
    (item) => normalizeStatus(item?.status) === "active"
  );
  const completedRealEstate = realEstate.filter(
    (item) => normalizeStatus(item?.status) === "completed"
  );

  const realizedTradePnl =
    sumBy(completedTrades, (trade) => trade?.profitLoss) +
    sumBy(completedPlaceTrades, (trade) => trade?.profitLoss);
  const copyTradeRealizedRevenue = sumBy(completedCopyTrades, (trade) =>
    getCopyTradeMetrics(trade, now).accruedProfit
  );
  const copyTradeAccruedRevenue = sumBy(activeCopyTrades, (trade) =>
    getCopyTradeMetrics(trade, now).accruedProfit
  );
  const stakeRealizedRevenue = sumBy(completedStakes, (stake) =>
    getStakeMetrics(stake, now).accruedProfit
  );
  const stakeAccruedRevenue = sumBy(activeStakes, (stake) =>
    getStakeMetrics(stake, now).accruedProfit
  );
  const miningRevenue = sumBy(miningRuns, (run) => run?.rewardBalance);
  const buyBotAccruedRevenue = sumBy(activeBots, (bot) =>
    getBuyBotMetrics(bot, now).accruedProfit
  );
  const realEstateRealizedRevenue = sumBy(completedRealEstate, (item) =>
    getRealEstateMetrics(item, now).accruedProfit
  );
  const realEstateAccruedRevenue = sumBy(activeRealEstate, (item) =>
    getRealEstateMetrics(item, now).accruedProfit
  );

  const copyTradeRevenue =
    copyTradeRealizedRevenue + copyTradeAccruedRevenue;
  const stakeRevenue = stakeRealizedRevenue + stakeAccruedRevenue;
  const realEstateRevenue =
    realEstateRealizedRevenue + realEstateAccruedRevenue;
  const activeInvestmentRevenue =
    copyTradeAccruedRevenue +
    stakeAccruedRevenue +
    miningRevenue +
    buyBotAccruedRevenue +
    realEstateAccruedRevenue;
  const grossRevenue =
    realizedTradePnl +
    copyTradeRevenue +
    stakeRevenue +
    miningRevenue +
    buyBotAccruedRevenue +
    realEstateRevenue;

  return {
    realizedTradePnl,
    copyTradeRevenue,
    copyTradeRealizedRevenue,
    copyTradeAccruedRevenue,
    stakeRevenue,
    stakeRealizedRevenue,
    stakeAccruedRevenue,
    miningRevenue,
    buyBotRevenue: buyBotAccruedRevenue,
    buyBotAccruedRevenue,
    realEstateRevenue,
    realEstateRealizedRevenue,
    realEstateAccruedRevenue,
    activeInvestmentRevenue,
    grossRevenue,
  };
};
