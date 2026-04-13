import app from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { getBrevoDiagnostics } from "./utils/brevoMailer.js";

const maskEmail = (value = "") => {
  const normalized = `${value || ""}`.trim();
  if (!normalized || !normalized.includes("@")) {
    return normalized;
  }

  const [local, domain] = normalized.split("@");
  if (!local || !domain) {
    return normalized;
  }

  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 0))}@${domain}`;
};

const start = async () => {
  try {
    await connectDb();
    app.listen(env.PORT, () => {
      console.log(`API listening on port ${env.PORT}`);
      const brevo = getBrevoDiagnostics();
      console.log("Brevo status:", {
        configured: brevo.configured,
        apiKeyLooksLikeSmtp: brevo.apiKeyLooksLikeSmtp,
        apiKeyLooksValid: brevo.apiKeyLooksValid,
        sender: maskEmail(brevo.senderEmail),
        apiBaseUrl: brevo.apiBaseUrl,
        timeoutMs: brevo.timeoutMs,
      });
      if (brevo.apiKeyLooksLikeSmtp) {
        console.warn(
          "BREVO_API_KEY looks like an SMTP key (xsmtpsib-...). Use a Brevo API key (xkeysib-...) for API delivery."
        );
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

start();
