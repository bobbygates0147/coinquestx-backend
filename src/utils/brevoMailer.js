import { env } from "../config/env.js";

const DEFAULT_BREVO_BASE_URL = "https://api.brevo.com/v3";
const SMTP_KEY_PREFIX = "xsmtpsib-";
const API_KEY_PREFIX = "xkeysib-";

const sanitizeText = (value = "") => `${value || ""}`.trim();

const parseSenderAddress = (value = "", fallbackName = "CoinQuestX") => {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return { name: fallbackName, email: "" };
  }

  const match = normalized.match(/^(.*)<([^>]+)>$/);
  if (match) {
    return {
      name: sanitizeText(match[1]) || fallbackName,
      email: sanitizeText(match[2]).toLowerCase(),
    };
  }

  return {
    name: fallbackName,
    email: normalized.toLowerCase(),
  };
};

const isBrevoSmtpKey = (value = "") =>
  sanitizeText(value).toLowerCase().startsWith(SMTP_KEY_PREFIX);

const looksLikeBrevoApiKey = (value = "") =>
  sanitizeText(value).toLowerCase().startsWith(API_KEY_PREFIX);

const getBrevoConfig = () => {
  const apiKey = sanitizeText(env.BREVO_API_KEY || env.SENDINBLUE_API_KEY);
  if (!apiKey) {
    return null;
  }

  const configuredSender = sanitizeText(
    env.BREVO_FROM || env.BREVO_SENDER || env.BREVO_SENDER_EMAIL
  );
  const sender = parseSenderAddress(
    configuredSender,
    sanitizeText(env.BREVO_SENDER_NAME) || "CoinQuestX"
  );

  if (!sender.email) {
    return null;
  }

  return {
    apiKey,
    apiKeyLooksLikeSmtp: isBrevoSmtpKey(apiKey),
    apiKeyLooksValid: looksLikeBrevoApiKey(apiKey),
    apiBaseUrl: sanitizeText(env.BREVO_API_BASE_URL) || DEFAULT_BREVO_BASE_URL,
    timeoutMs:
      Number(env.BREVO_TIMEOUT_MS) > 0 ? Number(env.BREVO_TIMEOUT_MS) : 30000,
    sender,
  };
};

export const getBrevoDiagnostics = () => {
  const config = getBrevoConfig();
  return {
    configured: Boolean(config),
    apiKeyLooksLikeSmtp: Boolean(config?.apiKeyLooksLikeSmtp),
    apiKeyLooksValid: Boolean(config?.apiKeyLooksValid),
    senderEmail: config?.sender?.email || "",
    senderName: config?.sender?.name || "",
    apiBaseUrl: config?.apiBaseUrl || DEFAULT_BREVO_BASE_URL,
    timeoutMs: config?.timeoutMs || 30000,
  };
};

export const isBrevoConfigured = () => Boolean(getBrevoConfig());

export const sendBrevoEmail = async ({
  to,
  subject,
  htmlContent = "",
  textContent = "",
  tags = [],
  replyTo = null,
  headers = {},
  from = "",
}) => {
  if (!to || !subject || (!htmlContent && !textContent)) {
    return {
      success: false,
      skipped: true,
      message: "Missing email payload",
    };
  }

  const brevoConfig = getBrevoConfig();
  if (!brevoConfig) {
    return {
      success: false,
      skipped: true,
      message: "Brevo is not configured",
    };
  }

  if (brevoConfig.apiKeyLooksLikeSmtp) {
    return {
      success: false,
      skipped: false,
      message:
        "BREVO_API_KEY looks like an SMTP key (xsmtpsib-...). Use a Brevo API key (xkeysib-...) instead.",
    };
  }

  const sender = parseSenderAddress(
    from || `${brevoConfig.sender.name} <${brevoConfig.sender.email}>`,
    brevoConfig.sender.name
  );

  const payload = {
    sender,
    to: [{ email: to }],
    subject,
    htmlContent,
    textContent,
  };

  if (Array.isArray(tags) && tags.length > 0) {
    payload.tags = tags;
  }

  if (headers && typeof headers === "object" && Object.keys(headers).length > 0) {
    payload.headers = headers;
  }

  const replyEmail = replyTo?.email || env.BREVO_REPLY_TO_EMAIL;
  if (replyEmail) {
    payload.replyTo = {
      email: replyEmail,
      name: replyTo?.name || env.BREVO_REPLY_TO_NAME || "CoinQuestX Support",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), brevoConfig.timeoutMs);

  let response;
  try {
    response = await fetch(
      `${brevoConfig.apiBaseUrl.replace(/\/+$/, "")}/smtp/email`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": brevoConfig.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    );
  } catch (error) {
    clearTimeout(timeout);
    return {
      success: false,
      skipped: false,
      message:
        error?.name === "AbortError"
          ? `Brevo request timed out after ${brevoConfig.timeoutMs}ms`
          : error?.message || "Brevo request failed",
    };
  }

  clearTimeout(timeout);

  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    return {
      success: false,
      skipped: false,
      message:
        data?.message ||
        data?.code ||
        rawText ||
        `Brevo request failed (${response.status})`,
      status: response.status,
      data,
    };
  }

  return {
    success: true,
    skipped: false,
    status: response.status,
    data,
    messageId: data?.messageId || data?.messageIds?.[0] || "",
  };
};
