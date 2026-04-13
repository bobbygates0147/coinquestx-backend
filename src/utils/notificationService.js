import OutboundNotification from "../models/OutboundNotification.js";
import { sendBrevoEmail } from "./brevoMailer.js";

const NOTIFICATION_PREF_MAP = {
  deposit: "depositEmails",
  payment_proof: "depositEmails",
  withdrawal: "withdrawalEmails",
  kyc: "kycEmails",
  trade_close: "tradeEmails",
  copy_trade: "tradeEmails",
  investment: "tradeEmails",
  referral_reward: "referralEmails",
  subscription: "subscriptionEmails",
  signal: "subscriptionEmails",
  subscription_expiry: "subscriptionEmails",
  support: "supportEmails",
};

const escapeHtml = (value = "") =>
  `${value || ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildEmailTemplate = ({
  headline,
  intro,
  bullets = [],
  ctaLabel = "",
  ctaUrl = "",
  footer = "CoinQuestX automated security and account notification.",
}) => {
  const safeHeadline = escapeHtml(headline);
  const safeIntro = escapeHtml(intro);
  const safeFooter = escapeHtml(footer);
  const bulletMarkup = bullets.length
    ? `<ul style="margin:20px 0;padding-left:20px;color:#cbd5e1;">${bullets
        .map((item) => `<li style="margin:8px 0;">${escapeHtml(item)}</li>`)
        .join("")}</ul>`
    : "";
  const ctaMarkup =
    ctaLabel && ctaUrl
      ? `<a href="${escapeHtml(
          ctaUrl
        )}" style="display:inline-block;margin-top:20px;padding:12px 20px;background:linear-gradient(135deg,#14b8a6,#06b6d4);border-radius:14px;color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(
          ctaLabel
        )}</a>`
      : "";

  const htmlContent = `
    <div style="background:#020617;padding:32px 18px;font-family:Arial,sans-serif;color:#e2e8f0;">
      <div style="max-width:640px;margin:0 auto;background:linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98));border:1px solid rgba(45,212,191,0.18);border-radius:24px;padding:32px;">
        <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#5eead4;">CoinQuestX Notification</p>
        <h1 style="margin:0;font-size:28px;line-height:1.2;color:#f8fafc;">${safeHeadline}</h1>
        <p style="margin:18px 0 0 0;font-size:15px;line-height:1.7;color:#cbd5e1;">${safeIntro}</p>
        ${bulletMarkup}
        ${ctaMarkup}
        <div style="margin-top:28px;padding-top:18px;border-top:1px solid rgba(148,163,184,0.18);font-size:12px;line-height:1.6;color:#94a3b8;">
          ${safeFooter}
        </div>
      </div>
    </div>
  `;

  const textContent = [headline, intro, ...bullets, ctaLabel && ctaUrl ? `${ctaLabel}: ${ctaUrl}` : "", footer]
    .filter(Boolean)
    .join("\n\n");

  return { htmlContent, textContent };
};

const isNotificationEnabled = (user, type, bypassPreferences = false) => {
  if (bypassPreferences) return true;
  const key = NOTIFICATION_PREF_MAP[type];
  if (!key) return true;
  const prefs = user?.notificationSettings || {};
  return prefs[key] !== false;
};

export const sendUserNotificationEmail = async ({
  user,
  recipientEmail = "",
  type = "account",
  subject,
  headline,
  intro,
  bullets = [],
  ctaLabel = "",
  ctaUrl = "",
  metadata = {},
  bypassPreferences = false,
  footer,
}) => {
  const email = `${recipientEmail || user?.email || ""}`.trim().toLowerCase();
  if (!email || !subject || !headline || !intro) {
    return null;
  }

  const notification = await OutboundNotification.create({
    user: user?._id || null,
    type,
    recipient: email,
    subject,
    status: "pending",
    metadata,
  });

  if (!isNotificationEnabled(user, type, bypassPreferences)) {
    notification.status = "skipped";
    notification.errorMessage = "Recipient disabled this notification type";
    await notification.save();
    return notification;
  }

  const { htmlContent, textContent } = buildEmailTemplate({
    headline,
    intro,
    bullets,
    ctaLabel,
    ctaUrl,
    footer,
  });

  const result = await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    tags: ["coinquestx", type],
  });

  notification.status = result.success
    ? "sent"
    : result.skipped
    ? "skipped"
    : "failed";
  notification.providerMessageId = result.messageId || "";
  notification.errorMessage = result.success ? "" : result.message || "";
  notification.sentAt = result.success ? new Date() : null;
  notification.metadata = {
    ...(notification.metadata || {}),
    providerResponse: result.data || {},
  };
  await notification.save();

  return notification;
};
