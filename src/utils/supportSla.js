import { env } from "../config/env.js";

export const SUPPORT_CATEGORIES = [
  "general",
  "deposit",
  "withdrawal",
  "kyc",
  "trading",
  "technical",
  "billing",
];

export const normalizeSupportCategory = (value, fallback = "general") => {
  const normalized = `${value || ""}`.trim().toLowerCase();
  return SUPPORT_CATEGORIES.includes(normalized) ? normalized : fallback;
};

export const normalizeSupportPriority = (value, fallback = "normal") => {
  const normalized = `${value || ""}`.trim().toLowerCase();
  return ["low", "normal", "high", "urgent"].includes(normalized)
    ? normalized
    : fallback;
};

export const getSupportSlaHours = (priority = "normal") => {
  switch (normalizeSupportPriority(priority)) {
    case "low":
      return env.SUPPORT_SLA_LOW_HOURS;
    case "high":
      return env.SUPPORT_SLA_HIGH_HOURS;
    case "urgent":
      return env.SUPPORT_SLA_URGENT_HOURS;
    default:
      return env.SUPPORT_SLA_NORMAL_HOURS;
  }
};

export const computeSlaTargetAt = (priority, createdAt = new Date()) =>
  new Date(new Date(createdAt).getTime() + getSupportSlaHours(priority) * 60 * 60 * 1000);

export const computeSlaStatus = (thread, now = new Date()) => {
  const normalizedStatus = `${thread?.status || "open"}`.toLowerCase();
  if (normalizedStatus === "resolved") return "resolved";
  if (normalizedStatus === "closed") return "paused";

  const targetMs = new Date(thread?.slaTargetAt || 0).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(targetMs) || !targetMs) {
    return "on_track";
  }

  if (thread?.lastReplyAt) {
    const repliedMs = new Date(thread.lastReplyAt).getTime();
    if (Number.isFinite(repliedMs) && repliedMs <= targetMs) {
      return "met";
    }
  }

  const remainingMs = targetMs - nowMs;
  if (remainingMs <= 0) return "breached";
  if (remainingMs <= 2 * 60 * 60 * 1000) return "due_soon";
  return "on_track";
};

export const applySupportSla = (thread, now = new Date()) => {
  if (!thread) return thread;

  if (!thread.slaTargetAt) {
    thread.slaTargetAt = computeSlaTargetAt(
      thread.priority || "normal",
      thread.createdAt || now
    );
  }

  thread.slaStatus = computeSlaStatus(thread, now);
  if (["resolved", "closed"].includes(`${thread.status || ""}`.toLowerCase()) && !thread.closedAt) {
    thread.closedAt = now;
  }

  return thread;
};
