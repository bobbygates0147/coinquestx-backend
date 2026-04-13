import { env } from "../config/env.js";

const DEFAULT_IDS = [
  "bitcoin",
  "ethereum",
  "cardano",
  "solana",
  "polkadot",
  "avalanche-2",
  "chainlink",
  "litecoin",
  "ripple",
];

const MAX_IDS = 50;
const MAX_VS = 5;
const CACHE_TTL_MS = 20 * 1000;
const STALE_CACHE_WINDOW_MS = 6 * 60 * 60 * 1000;

const COINCAP_ID_BY_COINGECKO = {
  "avalanche-2": "avalanche",
  ripple: "xrp",
};

const COINGECKO_ID_BY_COINCAP = Object.fromEntries(
  Object.entries(COINCAP_ID_BY_COINGECKO).map(([coingeckoId, coincapId]) => [
    coincapId,
    coingeckoId,
  ])
);

const cacheByKey = new Map();

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseIds = (input) => {
  const list = `${input || ""}`
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(list)];
  return unique.slice(0, MAX_IDS);
};

const parseVsCurrencies = (input) => {
  const list = `${input || "usd"}`
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(list)];
  return (unique.length ? unique : ["usd"]).slice(0, MAX_VS);
};

const buildCacheKey = ({ ids, vsCurrencies, include24h }) =>
  `${ids.join(",")}::${vsCurrencies.join(",")}::${include24h ? "1" : "0"}`;

const readCache = (key) => {
  const row = cacheByKey.get(key);
  if (!row?.data) return null;
  const now = Date.now();
  return {
    ...row,
    isFresh: now < row.expiresAt,
    isStale: now - row.updatedAt <= STALE_CACHE_WINDOW_MS,
  };
};

const writeCache = (key, payload) => {
  cacheByKey.set(key, {
    data: payload.data,
    source: payload.source,
    ids: payload.ids,
    updatedAt: Date.now(),
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const hasAnyPrice = (data = {}, ids = []) =>
  ids.some((id) => toNumber(data?.[id]?.usd, 0) > 0);

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const safeParseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const withTimeoutFetch = async (url, options = {}, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchCoinGeckoPrices = async ({ ids, vsCurrencies, include24h }) => {
  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: vsCurrencies.join(","),
  });
  if (include24h) {
    params.set("include_24hr_change", "true");
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "coinquestx-backend/1.0",
  };

  if (env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = env.COINGECKO_API_KEY;
  }
  if (env.COINGECKO_PRO_API_KEY) {
    headers["x-cg-pro-api-key"] = env.COINGECKO_PRO_API_KEY;
  }

  const response = await withTimeoutFetch(
    `https://api.coingecko.com/api/v3/simple/price?${params.toString()}`,
    {
      method: "GET",
      headers,
    }
  );

  const raw = await response.text();
  const json = safeParseJson(raw);

  if (!response.ok || !json || typeof json !== "object") {
    throw createHttpError(
      response.status || 502,
      `CoinGecko request failed (${response.status}): ${raw?.slice(0, 180) || "No response body"}`
    );
  }

  return json;
};

const mapCoinCapToSimplePrice = ({ rows, ids, include24h }) => {
  const byCoinGeckoId = new Map();
  rows.forEach((item) => {
    const coincapId = `${item?.id || ""}`.toLowerCase();
    const coingeckoId = COINGECKO_ID_BY_COINCAP[coincapId] || coincapId;
    const usd = toNumber(item?.priceUsd, 0);
    if (!usd) return;

    const row = { usd };
    if (include24h) {
      row.usd_24h_change = toNumber(item?.changePercent24Hr, 0);
    }
    byCoinGeckoId.set(coingeckoId, row);
  });

  const normalized = {};
  ids.forEach((id) => {
    const row = byCoinGeckoId.get(id);
    if (row) {
      normalized[id] = row;
    }
  });
  return normalized;
};

const fetchCoinCapPrices = async ({ ids, include24h }) => {
  const coincapIds = ids.map((id) => COINCAP_ID_BY_COINGECKO[id] || id).join(",");
  const response = await withTimeoutFetch(
    `https://api.coincap.io/v2/assets?ids=${encodeURIComponent(coincapIds)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  const raw = await response.text();
  const json = safeParseJson(raw);
  const rows = Array.isArray(json?.data) ? json.data : [];

  if (!response.ok || !rows.length) {
    throw createHttpError(
      response.status || 502,
      `CoinCap request failed (${response.status}): ${raw?.slice(0, 180) || "No response body"}`
    );
  }

  return mapCoinCapToSimplePrice({ rows, ids, include24h });
};

const respondWithCache = ({ res, cache, ids, reason }) =>
  res.json({
    success: true,
    data: cache.data,
    source: cache.source,
    cached: true,
    stale: true,
    ids,
    warning: reason,
    updatedAt: new Date(cache.updatedAt).toISOString(),
  });

export const getSimplePrices = async (req, res, next) => {
  const ids = parseIds(req.query.ids);
  const vsCurrencies = parseVsCurrencies(req.query.vs_currencies);
  const include24h = `${req.query.include_24hr_change || ""}`.toLowerCase() === "true";

  const resolvedIds = ids.length ? ids : DEFAULT_IDS;
  const cacheKey = buildCacheKey({
    ids: resolvedIds,
    vsCurrencies,
    include24h,
  });
  const cache = readCache(cacheKey);

  if (cache?.isFresh) {
    return res.json({
      success: true,
      data: cache.data,
      source: cache.source,
      cached: true,
      stale: false,
      ids: resolvedIds,
      updatedAt: new Date(cache.updatedAt).toISOString(),
    });
  }

  try {
    const data = await fetchCoinGeckoPrices({
      ids: resolvedIds,
      vsCurrencies,
      include24h,
    });

    if (!hasAnyPrice(data, resolvedIds)) {
      throw createHttpError(502, "CoinGecko returned empty prices.");
    }

    writeCache(cacheKey, { data, source: "coingecko", ids: resolvedIds });
    const updated = readCache(cacheKey);
    return res.json({
      success: true,
      data,
      source: "coingecko",
      cached: false,
      stale: false,
      ids: resolvedIds,
      updatedAt: updated ? new Date(updated.updatedAt).toISOString() : new Date().toISOString(),
    });
  } catch (coingeckoError) {
    try {
      if (!vsCurrencies.includes("usd")) {
        throw createHttpError(
          503,
          `Fallback supports USD only. CoinGecko failed: ${coingeckoError.message}`
        );
      }

      const coincapData = await fetchCoinCapPrices({
        ids: resolvedIds,
        include24h,
      });
      if (!hasAnyPrice(coincapData, resolvedIds)) {
        throw createHttpError(502, "CoinCap returned empty prices.");
      }

      writeCache(cacheKey, { data: coincapData, source: "coincap", ids: resolvedIds });
      const updated = readCache(cacheKey);
      return res.json({
        success: true,
        data: coincapData,
        source: "coincap",
        cached: false,
        stale: false,
        ids: resolvedIds,
        warning: `CoinGecko failed: ${coingeckoError.message}`,
        updatedAt: updated ? new Date(updated.updatedAt).toISOString() : new Date().toISOString(),
      });
    } catch (fallbackError) {
      if (cache?.isStale) {
        return respondWithCache({
          res,
          cache,
          ids: resolvedIds,
          reason: `Live provider unavailable. CoinGecko: ${coingeckoError.message}. Fallback: ${fallbackError.message}`,
        });
      }

      return next(
        createHttpError(
          503,
          `Market price providers unavailable. CoinGecko: ${coingeckoError.message}. Fallback: ${fallbackError.message}`
        )
      );
    }
  }
};
