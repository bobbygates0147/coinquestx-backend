import os from "node:os";
import BuyBot from "../models/BuyBot.js";
import CopyTrade from "../models/CopyTrade.js";
import Mining from "../models/Mining.js";
import PlaceTrade from "../models/PlaceTrade.js";
import RealEstate from "../models/RealEstate.js";
import Stake from "../models/Stake.js";
import SystemJob from "../models/SystemJob.js";
import User from "../models/User.js";
import { env } from "../config/env.js";
import {
  getPlaceTradeSettleAt,
  resolvePlaceTradeSettlement,
} from "../utils/placeTradeSettlement.js";
import {
  getBuyBotMetrics,
  getCopyTradeMetrics,
} from "../utils/investmentMetrics.js";
import { applyBalanceChange, roundCurrency } from "../utils/walletLedger.js";

const JOB_NAME = "passive-income-worker";
const WORKER_OWNER = `${os.hostname()}:${process.pid}`;
const BUY_BOT_SETTLEMENT_COOLDOWN_MS = 15 * 60 * 1000;
const COPY_TRADE_SETTLEMENT_COOLDOWN_MS = 15 * 60 * 1000;
const MINING_CYCLE_MS = 5 * 60 * 1000;
const NETWORK_BOOST_PER_ACTIVE_MINER = 0.02;
const FLEET_BOOST_PER_PURCHASED_BOT = 0.04;
const SELECTED_BOT_LEVEL_BOOST_DIVISOR = 140;
const COIN_CONFIG = {
  BTC: { price: 30000, rate: 0.00000000000002 },
  ETH: { price: 2000, rate: 0.0000000000005 },
  LTC: { price: 90, rate: 0.000000000005 },
  DOGE: { price: 0.12, rate: 0.0000000001 },
  SOL: { price: 160, rate: 0.000000000001 },
};

let intervalId = null;
let runInProgress = false;

const toCleanId = (value) => `${value || ""}`.trim();

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const toDate = (value, fallback = null) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const groupByUser = (docs = []) =>
  docs.reduce((accumulator, doc) => {
    const userId = toCleanId(doc?.user?._id || doc?.user);
    if (!userId) return accumulator;
    if (!accumulator.has(userId)) {
      accumulator.set(userId, []);
    }
    accumulator.get(userId).push(doc);
    return accumulator;
  }, new Map());

const getCopyTradeBreakdown = (trade, now) => {
  const metrics = getCopyTradeMetrics(trade, now.getTime());
  const accruedProfit = roundCurrency(metrics.accruedProfit);
  const alreadySettled = roundCurrency(trade?.realizedProfit);
  const claimableProfit = Math.max(
    0,
    roundCurrency(accruedProfit - alreadySettled)
  );
  const lastSettledAt = toDate(trade?.lastProfitSettledAt);
  const cooldownElapsed =
    !lastSettledAt ||
    now.getTime() - lastSettledAt.getTime() >= COPY_TRADE_SETTLEMENT_COOLDOWN_MS;

  return {
    metrics,
    accruedProfit,
    claimableProfit,
    shouldSettle: claimableProfit > 0 && (cooldownElapsed || metrics.progress >= 1),
  };
};

const getSelectedBoostLevel = (activeBuyBots, selectedBoostBotId) => {
  const selectedId = Number(selectedBoostBotId);
  if (!Number.isFinite(selectedId) || selectedId <= 0) return 0;

  const selectedBot = activeBuyBots.find(
    (bot) => Number(bot?.settings?.botId) === selectedId
  );

  return toPositiveNumber(selectedBot?.settings?.level);
};

const getMiningMultiplier = ({
  activeMiningBotCount,
  activeBuyBotCount,
  selectedBoostLevel,
}) => {
  const networkBoostMultiplier =
    1 + Math.max(0, activeMiningBotCount - 1) * NETWORK_BOOST_PER_ACTIVE_MINER;
  const fleetBoostMultiplier =
    1 + Math.max(0, activeBuyBotCount) * FLEET_BOOST_PER_PURCHASED_BOT;
  const selectedBoostMultiplier =
    selectedBoostLevel > 0
      ? 1 + selectedBoostLevel / SELECTED_BOT_LEVEL_BOOST_DIVISOR
      : 1;

  return (
    networkBoostMultiplier *
    fleetBoostMultiplier *
    selectedBoostMultiplier
  );
};

const accrueMiningUsd = (doc, multiplier, now = new Date()) => {
  if (doc.status !== "Active") return 0;

  const config = COIN_CONFIG[doc.asset];
  if (!config) return 0;

  const lastCheckpoint =
    toDate(doc.lastClaimedAt, toDate(doc.createdAt, now)) || now;
  const elapsedMs = Math.max(0, now.getTime() - lastCheckpoint.getTime());
  if (!elapsedMs) return 0;

  const coinPerSecond = toPositiveNumber(doc.hashRate) * config.rate * multiplier;
  const usdPerSecond = coinPerSecond * config.price;
  return roundCurrency(usdPerSecond * (elapsedMs / 1000));
};

const buildInitialSummary = () => ({
  buyBots: { users: 0, bots: 0, amount: 0 },
  copyTrades: { users: 0, trades: 0, amount: 0 },
  mining: { users: 0, rigs: 0, amount: 0 },
  stakes: { users: 0, positions: 0, amount: 0 },
  realEstate: { users: 0, positions: 0, amount: 0 },
  placeTrades: { users: 0, trades: 0, amount: 0 },
});

const acquireLease = async (now) => {
  const leaseMs = Math.max(
    env.PASSIVE_INCOME_WORKER_LEASE_MS,
    env.PASSIVE_INCOME_WORKER_INTERVAL_MS * 2
  );
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  try {
    const job = await SystemJob.findOneAndUpdate(
      {
        name: JOB_NAME,
        $or: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $lte: now } },
          { leaseOwner: WORKER_OWNER },
        ],
      },
      {
        $setOnInsert: { name: JOB_NAME },
        $set: {
          leaseOwner: WORKER_OWNER,
          leaseExpiresAt,
          lastStartedAt: now,
          lastError: "",
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return job?.leaseOwner === WORKER_OWNER;
  } catch (error) {
    if (error?.code === 11000) {
      return false;
    }
    throw error;
  }
};

const finalizeLease = async ({ now, summary, error = null }) => {
  const update = {
    leaseExpiresAt: now,
    lastFinishedAt: now,
    lastSummary: summary,
    lastError: error ? `${error.message || error}`.slice(0, 500) : "",
  };

  if (!error) {
    update.lastSuccessAt = now;
  }

  await SystemJob.updateOne(
    { name: JOB_NAME, leaseOwner: WORKER_OWNER },
    { $set: update }
  ).catch((leaseError) => {
    console.error("Passive income worker failed to finalize lease:", leaseError);
  });
};

const settleCopyTrades = async (now, summary) => {
  const docs = await CopyTrade.find({
    status: { $in: ["Active", "Paused"] },
  }).sort({ createdAt: 1 });

  const eligibleDocs = docs
    .map((doc) => {
      const breakdown = getCopyTradeBreakdown(doc, now);
      return breakdown.shouldSettle
        ? { doc, breakdown }
        : null;
    })
    .filter(Boolean);

  const byUser = groupByUser(eligibleDocs.map((entry) => entry.doc));
  const breakdownById = new Map(
    eligibleDocs.map((entry) => [entry.doc._id.toString(), entry.breakdown])
  );

  for (const [userId, userDocs] of byUser.entries()) {
    const user = await User.findById(userId);
    if (!user) continue;

    const payoutRows = userDocs
      .map((doc) => ({
        doc,
        ...breakdownById.get(doc._id.toString()),
      }))
      .filter((entry) => entry?.claimableProfit > 0);

    if (!payoutRows.length) continue;

    const settledAt = new Date(now);
    payoutRows.forEach((row) => {
      row.doc.realizedProfit = row.accruedProfit;
      row.doc.lastProfitSettledAt = settledAt;
    });
    await Promise.all(payoutRows.map((row) => row.doc.save()));

    const claimedAmount = roundCurrency(
      payoutRows.reduce((sum, row) => sum + row.claimableProfit, 0)
    );

    if (claimedAmount <= 0) continue;

    await applyBalanceChange({
      user,
      delta: claimedAmount,
      type: "CopyTrade",
      paymentMethod: "Passive Copy Trade Profit",
      details: `Automatic copy trade profit settlement from ${payoutRows.length} trader${payoutRows.length === 1 ? "" : "s"}`,
      sourceFeature: "trading",
      actorRole: "system",
      actor: user?._id || null,
      actorLabel: "Passive Income Worker",
      metadata: {
        phase: "profit_auto_claim",
        tradeCount: payoutRows.length,
        payoutBreakdown: payoutRows.map((row) => ({
          copyTradeId: row.doc._id.toString(),
          traderName:
            row.doc.traderName ||
            row.doc?.traderData?.name ||
            row.doc.sourceTraderId ||
            "Copy Trader",
          amount: row.claimableProfit,
          settledProfit: row.accruedProfit,
        })),
      },
    });

    summary.copyTrades.users += 1;
    summary.copyTrades.trades += payoutRows.length;
    summary.copyTrades.amount = roundCurrency(
      summary.copyTrades.amount + claimedAmount
    );
  }
};

const getBuyBotBreakdown = (bot, now) => {
  const metrics = getBuyBotMetrics(bot, now.getTime());
  const normalizedStatus = `${bot?.status || ""}`.trim().toLowerCase();
  const isActive = normalizedStatus === "active";
  const storedProfit = toPositiveNumber(bot?.generatedProfit);
  const alreadySettled = roundCurrency(toPositiveNumber(bot?.settledProfit));
  const lastSettledAt = toDate(bot?.lastProfitSettledAt);
  const cooldownElapsed =
    !lastSettledAt ||
    now.getTime() - lastSettledAt.getTime() >= BUY_BOT_SETTLEMENT_COOLDOWN_MS;
  const shouldSeedFromComputedProfit =
    !isActive &&
    storedProfit <= 0 &&
    alreadySettled <= 0 &&
    !lastSettledAt;
  const accruedProfit = roundCurrency(
    isActive
      ? Math.max(0, storedProfit, toPositiveNumber(metrics.accruedProfit))
      : shouldSeedFromComputedProfit
      ? Math.max(0, toPositiveNumber(metrics.accruedProfit))
      : Math.max(0, storedProfit)
  );
  const claimableProfit = Math.max(
    0,
    roundCurrency(accruedProfit - alreadySettled)
  );

  return {
    metrics,
    accruedProfit,
    claimableProfit,
    shouldSettle: claimableProfit > 0 && (!isActive || cooldownElapsed),
  };
};

const settleBuyBots = async (now, summary) => {
  const docs = await BuyBot.find({
    status: { $in: ["Active", "Paused", "Completed"] },
  }).sort({ createdAt: 1 });

  const eligibleDocs = docs
    .map((doc) => {
      const breakdown = getBuyBotBreakdown(doc, now);
      return breakdown.shouldSettle ? { doc, breakdown } : null;
    })
    .filter(Boolean);

  const byUser = groupByUser(eligibleDocs.map((entry) => entry.doc));
  const breakdownById = new Map(
    eligibleDocs.map((entry) => [entry.doc._id.toString(), entry.breakdown])
  );

  for (const [userId, userDocs] of byUser.entries()) {
    const user = await User.findById(userId);
    if (!user) continue;

    const payoutRows = userDocs
      .map((doc) => ({
        doc,
        ...breakdownById.get(doc._id.toString()),
      }))
      .filter((entry) => entry?.claimableProfit > 0);

    if (!payoutRows.length) continue;

    const settledAt = new Date(now);
    payoutRows.forEach((row) => {
      row.doc.generatedProfit = row.accruedProfit;
      row.doc.settledProfit = row.accruedProfit;
      row.doc.lastProfitSettledAt = settledAt;
    });
    await Promise.all(payoutRows.map((row) => row.doc.save()));

    const claimedAmount = roundCurrency(
      payoutRows.reduce((sum, row) => sum + row.claimableProfit, 0)
    );

    if (claimedAmount <= 0) continue;

    await applyBalanceChange({
      user,
      delta: claimedAmount,
      type: "BuyBot",
      paymentMethod: "Passive Buy Bot Profit",
      details: `Automatic buy bot profit settlement from ${payoutRows.length} bot${payoutRows.length === 1 ? "" : "s"}`,
      sourceFeature: "bots",
      actorRole: "system",
      actor: user?._id || null,
      actorLabel: "Passive Income Worker",
      metadata: {
        phase: "profit_auto_claim",
        botCount: payoutRows.length,
        payoutBreakdown: payoutRows.map((row) => ({
          buyBotId: row.doc._id.toString(),
          strategyName: row.doc.strategyName || "Buy Bot",
          amount: row.claimableProfit,
          settledProfit: row.accruedProfit,
        })),
      },
    });

    summary.buyBots.users += 1;
    summary.buyBots.bots += payoutRows.length;
    summary.buyBots.amount = roundCurrency(
      summary.buyBots.amount + claimedAmount
    );
  }
};

const settleMining = async (now, summary) => {
  const activeDocs = await Mining.find({ status: "Active" }).sort({ createdAt: 1 });
  const byUser = groupByUser(activeDocs);

  for (const [userId, userDocs] of byUser.entries()) {
    const dueDocs = userDocs.filter((doc) => {
      const lastClaimedAt =
        toDate(doc.lastClaimedAt, toDate(doc.createdAt, now)) || now;
      return now.getTime() - lastClaimedAt.getTime() >= MINING_CYCLE_MS;
    });

    if (!dueDocs.length) continue;

    const [user, activeBuyBots] = await Promise.all([
      User.findById(userId),
      BuyBot.find({ user: userId, status: "Active" }).select("settings"),
    ]);
    if (!user) continue;

    const dueGroups = dueDocs.reduce((accumulator, doc) => {
      const boostKey = Number.isFinite(Number(doc.boostBotId))
        ? String(Number(doc.boostBotId))
        : "none";
      if (!accumulator.has(boostKey)) {
        accumulator.set(boostKey, []);
      }
      accumulator.get(boostKey).push(doc);
      return accumulator;
    }, new Map());

    const activeMiningBotCount = userDocs.length;
    const activeBuyBotCount = activeBuyBots.length;
    const payoutRows = [];

    for (const [boostKey, docsForBoost] of dueGroups.entries()) {
      const multiplier = getMiningMultiplier({
        activeMiningBotCount,
        activeBuyBotCount,
        selectedBoostLevel: getSelectedBoostLevel(
          activeBuyBots,
          boostKey === "none" ? null : Number(boostKey)
        ),
      });

      docsForBoost.forEach((doc) => {
        const accrued = accrueMiningUsd(doc, multiplier, now);
        if (accrued > 0) {
          doc.rewardBalance = roundCurrency(
            toPositiveNumber(doc.rewardBalance) + accrued
          );
          doc.lastClaimedAt = now;
        }

        const claimable = Math.max(
          0,
          roundCurrency(
            toPositiveNumber(doc.rewardBalance) - toPositiveNumber(doc.totalPaidUsd)
          )
        );

        if (claimable > 0) {
          doc.totalPaidUsd = roundCurrency(
            toPositiveNumber(doc.totalPaidUsd) + claimable
          );
        }

        payoutRows.push({
          doc,
          claimable,
        });
      });
    }

    await Promise.all(payoutRows.map((row) => row.doc.save()));

    const claimBreakdown = payoutRows.filter((row) => row.claimable > 0);
    if (!claimBreakdown.length) continue;

    const payoutAmount = roundCurrency(
      claimBreakdown.reduce((sum, row) => sum + row.claimable, 0)
    );

    await applyBalanceChange({
      user,
      delta: payoutAmount,
      type: "Mining",
      paymentMethod: "Passive Mining Claim",
      details: `Automatic mining payout credited from ${claimBreakdown.length} rig${claimBreakdown.length === 1 ? "" : "s"}`,
      sourceFeature: "mining",
      actorRole: "system",
      actor: user?._id || null,
      actorLabel: "Passive Income Worker",
      metadata: {
        phase: "auto_claim",
        rigCount: claimBreakdown.length,
        payoutBreakdown: claimBreakdown.map((row) => ({
          miningId: row.doc._id.toString(),
          asset: row.doc.asset,
          amount: row.claimable,
        })),
      },
    });

    summary.mining.users += 1;
    summary.mining.rigs += claimBreakdown.length;
    summary.mining.amount = roundCurrency(
      summary.mining.amount + payoutAmount
    );
  }
};

const settleStakes = async (now, summary) => {
  const docs = await Stake.find({
    status: "Active",
    endsAt: { $lte: now },
  }).sort({ endsAt: 1, createdAt: 1 });

  const byUser = groupByUser(docs);

  for (const [userId, userDocs] of byUser.entries()) {
    const user = await User.findById(userId);
    if (!user) continue;

    const payoutRows = userDocs.map((doc) => ({
      doc,
      payoutUsd: roundCurrency(doc.principalUsd + doc.rewardUsdTotal),
    }));

    payoutRows.forEach((row) => {
      row.doc.status = "Completed";
      row.doc.settledAt = now;
      row.doc.payoutUsd = row.payoutUsd;
    });
    await Promise.all(payoutRows.map((row) => row.doc.save()));

    const payoutAmount = roundCurrency(
      payoutRows.reduce((sum, row) => sum + row.payoutUsd, 0)
    );
    if (payoutAmount <= 0) continue;

    await applyBalanceChange({
      user,
      delta: payoutAmount,
      type: "Stake",
      paymentMethod: "Passive Stake Maturity",
      details: `Automatic stake settlement for ${payoutRows.length} position${payoutRows.length === 1 ? "" : "s"}`,
      sourceFeature: "staking",
      actorRole: "system",
      actor: user?._id || null,
      actorLabel: "Passive Income Worker",
      metadata: {
        phase: "auto_settled",
        positionCount: payoutRows.length,
        payoutBreakdown: payoutRows.map((row) => ({
          stakeId: row.doc._id.toString(),
          asset: row.doc.asset,
          principalUsd: roundCurrency(row.doc.principalUsd),
          rewardUsd: roundCurrency(row.doc.rewardUsdTotal),
          payoutUsd: row.payoutUsd,
        })),
      },
    });

    summary.stakes.users += 1;
    summary.stakes.positions += payoutRows.length;
    summary.stakes.amount = roundCurrency(
      summary.stakes.amount + payoutAmount
    );
  }
};

const settleRealEstate = async (now, summary) => {
  const docs = await RealEstate.find({
    status: "Active",
    endDate: { $lte: now },
  }).sort({ endDate: 1, createdAt: 1 });

  const byUser = groupByUser(docs);

  for (const [userId, userDocs] of byUser.entries()) {
    const user = await User.findById(userId);
    if (!user) continue;

    const payoutRows = userDocs.map((doc) => ({
      doc,
      payoutUsd: roundCurrency(
        toPositiveNumber(doc.expectedPayoutUsd, doc.amount)
      ),
    }));

    payoutRows.forEach((row) => {
      row.doc.status = "Completed";
      row.doc.payoutUsd = row.payoutUsd;
    });
    await Promise.all(payoutRows.map((row) => row.doc.save()));

    const payoutAmount = roundCurrency(
      payoutRows.reduce((sum, row) => sum + row.payoutUsd, 0)
    );
    if (payoutAmount <= 0) continue;

    await applyBalanceChange({
      user,
      delta: payoutAmount,
      type: "RealEstate",
      paymentMethod: "Passive Real Estate Payout",
      details: `Automatic real estate settlement for ${payoutRows.length} investment${payoutRows.length === 1 ? "" : "s"}`,
      sourceFeature: "real-estate",
      actorRole: "system",
      actor: user?._id || null,
      actorLabel: "Passive Income Worker",
      metadata: {
        phase: "auto_settled",
        investmentCount: payoutRows.length,
        payoutBreakdown: payoutRows.map((row) => ({
          realEstateId: row.doc._id.toString(),
          propertyName: row.doc.propertyName || row.doc.reference || "Real Estate",
          principalUsd: roundCurrency(row.doc.amount),
          payoutUsd: row.payoutUsd,
        })),
      },
    });

    summary.realEstate.users += 1;
    summary.realEstate.positions += payoutRows.length;
    summary.realEstate.amount = roundCurrency(
      summary.realEstate.amount + payoutAmount
    );
  }
};

const settlePlaceTrades = async (now, summary) => {
  const docs = await PlaceTrade.find({ status: "Active" }).sort({
    createdAt: 1,
  });

  const dueDocs = docs.filter((doc) => getPlaceTradeSettleAt(doc) <= now.getTime());
  const byUser = groupByUser(dueDocs);

  for (const [userId, userDocs] of byUser.entries()) {
    const user = await User.findById(userId);
    if (!user) continue;

    let settledCount = 0;
    let settledAmount = 0;

    for (const doc of userDocs) {
      const { outcome, profitLoss, settlementAmount } =
        resolvePlaceTradeSettlement(doc);

      doc.status = "Completed";
      doc.result = outcome;
      doc.profitLoss = profitLoss;
      doc.settledAt = now;
      await doc.save();

      if (settlementAmount !== 0) {
        await applyBalanceChange({
          user,
          delta: settlementAmount,
          type: "PlaceTrade",
          paymentMethod: "PlaceTrade Auto Settlement",
          details: `Place trade ${doc.asset || doc._id.toString()} auto-settled ${outcome}`,
          sourceFeature: "trading",
          actorRole: "system",
          actor: user?._id || null,
          actorLabel: "Passive Income Worker",
          metadata: {
            tradeId: doc._id.toString(),
            asset: doc.asset || "",
            direction: doc.direction || "",
            profitLoss,
            settlementAmount,
            principal: roundCurrency(doc.amount),
            result: outcome,
            reservedStake: !!doc.stakeReserved,
            phase: "auto_settled",
            executionMode: doc.executionMode || "Manual",
            buyBotId: doc.buyBot ? doc.buyBot.toString() : "",
            buyBotName: doc.buyBotName || "",
          },
        });
      }

      settledCount += 1;
      settledAmount = roundCurrency(settledAmount + settlementAmount);
    }

    if (!settledCount) continue;

    summary.placeTrades.users += 1;
    summary.placeTrades.trades += settledCount;
    summary.placeTrades.amount = roundCurrency(
      summary.placeTrades.amount + settledAmount
    );
  }
};

export const runPassiveIncomeWorker = async () => {
  if (!env.PASSIVE_INCOME_WORKER_ENABLED) {
    return null;
  }

  if (runInProgress) {
    return null;
  }

  runInProgress = true;
  const now = new Date();
  const summary = buildInitialSummary();

  try {
    const leaseAcquired = await acquireLease(now);
    if (!leaseAcquired) {
      return null;
    }

    await settleBuyBots(now, summary);
    await settleCopyTrades(now, summary);
    await settleMining(now, summary);
    await settleStakes(now, summary);
    await settleRealEstate(now, summary);
    await settlePlaceTrades(now, summary);

    await finalizeLease({ now: new Date(), summary });

    const totalAmount = roundCurrency(
      summary.buyBots.amount +
        summary.copyTrades.amount +
        summary.mining.amount +
        summary.stakes.amount +
        summary.realEstate.amount +
        summary.placeTrades.amount
    );

    const totalActions =
      summary.buyBots.bots +
      summary.copyTrades.trades +
      summary.mining.rigs +
      summary.stakes.positions +
      summary.realEstate.positions +
      summary.placeTrades.trades;

    if (totalActions > 0) {
      console.log("Passive income worker settled credits:", {
        owner: WORKER_OWNER,
        totalActions,
        totalAmount,
        summary,
      });
    }

    return summary;
  } catch (error) {
    console.error("Passive income worker failed:", error);
    await finalizeLease({
      now: new Date(),
      summary,
      error,
    });
    return null;
  } finally {
    runInProgress = false;
  }
};

export const startPassiveIncomeWorker = () => {
  if (!env.PASSIVE_INCOME_WORKER_ENABLED) {
    console.log("Passive income worker is disabled");
    return {
      stop: () => {},
    };
  }

  if (intervalId) {
    return {
      stop: () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      },
    };
  }

  console.log("Starting passive income worker", {
    owner: WORKER_OWNER,
    intervalMs: env.PASSIVE_INCOME_WORKER_INTERVAL_MS,
    leaseMs: env.PASSIVE_INCOME_WORKER_LEASE_MS,
  });

  void runPassiveIncomeWorker();
  intervalId = setInterval(() => {
    void runPassiveIncomeWorker();
  }, env.PASSIVE_INCOME_WORKER_INTERVAL_MS);

  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
};
