import dotenv from "dotenv";
import process from "node:process";

dotenv.config();

const defaultCorsOrigins = ["http://localhost:5173", "http://localhost:5174"];
const parsedCorsOrigins = (
  process.env.CORS_ORIGINS ||
  process.env.CORS_ORIGIN ||
  defaultCorsOrigins.join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = {
  PORT: process.env.PORT ? Number(process.env.PORT) : 5000,
  MONGODB_URI:
    process.env.MONGODB_URI || "mongodb://localhost:27017/coinquestx",
  PASSIVE_INCOME_WORKER_ENABLED:
    process.env.PASSIVE_INCOME_WORKER_ENABLED !== "false",
  PASSIVE_INCOME_WORKER_INTERVAL_MS: process.env.PASSIVE_INCOME_WORKER_INTERVAL_MS
    ? Number(process.env.PASSIVE_INCOME_WORKER_INTERVAL_MS)
    : 60 * 1000,
  PASSIVE_INCOME_WORKER_LEASE_MS: process.env.PASSIVE_INCOME_WORKER_LEASE_MS
    ? Number(process.env.PASSIVE_INCOME_WORKER_LEASE_MS)
    : 10 * 60 * 1000,
  JWT_SECRET: process.env.JWT_SECRET || "change_me",
  CORS_ORIGINS: parsedCorsOrigins,
  CORS_ORIGIN: parsedCorsOrigins[0] || "http://localhost:5173",
  FRONTEND_URL:
    process.env.FRONTEND_URL ||
    process.env.APP_BASE_URL ||
    parsedCorsOrigins[0] ||
    "http://localhost:5173",
  REFERRAL_BONUS: process.env.REFERRAL_BONUS
    ? Number(process.env.REFERRAL_BONUS)
    : 25,
  REQUIRE_KYC: process.env.REQUIRE_KYC === "true",
  REQUIRE_ADMIN: process.env.REQUIRE_ADMIN === "true",
  AUTO_VERIFY_KYC: process.env.AUTO_VERIFY_KYC === "true",
  ADMIN_AUTH_CODE: process.env.ADMIN_AUTH_CODE || "",
  RESET_TOKEN_TTL_MINUTES: process.env.RESET_TOKEN_TTL_MINUTES
    ? Number(process.env.RESET_TOKEN_TTL_MINUTES)
    : 60,
  OTP_TTL_MINUTES: process.env.OTP_TTL_MINUTES
    ? Number(process.env.OTP_TTL_MINUTES)
    : 10,
  WITHDRAWAL_COOLDOWN_MINUTES: process.env.WITHDRAWAL_COOLDOWN_MINUTES
    ? Number(process.env.WITHDRAWAL_COOLDOWN_MINUTES)
    : 30,
  BREVO_API_KEY:
    process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY || "",
  SENDINBLUE_API_KEY: process.env.SENDINBLUE_API_KEY || "",
  BREVO_FROM: process.env.BREVO_FROM || "",
  BREVO_SENDER: process.env.BREVO_SENDER || "",
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || "",
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || "CoinQuestX",
  BREVO_REPLY_TO_EMAIL: process.env.BREVO_REPLY_TO_EMAIL || "",
  BREVO_REPLY_TO_NAME: process.env.BREVO_REPLY_TO_NAME || "CoinQuestX Support",
  BREVO_API_BASE_URL:
    process.env.BREVO_API_BASE_URL || "https://api.brevo.com/v3",
  BREVO_TIMEOUT_MS: process.env.BREVO_TIMEOUT_MS
    ? Number(process.env.BREVO_TIMEOUT_MS)
    : 30000,
  SUPPORT_SLA_LOW_HOURS: process.env.SUPPORT_SLA_LOW_HOURS
    ? Number(process.env.SUPPORT_SLA_LOW_HOURS)
    : 48,
  SUPPORT_SLA_NORMAL_HOURS: process.env.SUPPORT_SLA_NORMAL_HOURS
    ? Number(process.env.SUPPORT_SLA_NORMAL_HOURS)
    : 24,
  SUPPORT_SLA_HIGH_HOURS: process.env.SUPPORT_SLA_HIGH_HOURS
    ? Number(process.env.SUPPORT_SLA_HIGH_HOURS)
    : 8,
  SUPPORT_SLA_URGENT_HOURS: process.env.SUPPORT_SLA_URGENT_HOURS
    ? Number(process.env.SUPPORT_SLA_URGENT_HOURS)
    : 2,
  COINGECKO_API_KEY: process.env.COINGECKO_API_KEY || "",
  COINGECKO_PRO_API_KEY: process.env.COINGECKO_PRO_API_KEY || "",
  BTC_WALLET_ADDRESS: process.env.BTC_WALLET_ADDRESS?.trim() || "",
  ETH_WALLET_ADDRESS: process.env.ETH_WALLET_ADDRESS?.trim() || "",
  SOL_WALLET_ADDRESS: process.env.SOL_WALLET_ADDRESS?.trim() || "",
  BASE_WALLET_ADDRESS: process.env.BASE_WALLET_ADDRESS?.trim() || "",
  SUI_WALLET_ADDRESS: process.env.SUI_WALLET_ADDRESS?.trim() || "",
  POL_WALLET_ADDRESS: process.env.POL_WALLET_ADDRESS?.trim() || "",
};
