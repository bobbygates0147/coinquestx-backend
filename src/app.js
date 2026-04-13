import express from "express";
import cors from "cors";
import morgan from "morgan";
import routes from "./routes/index.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();
const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const allowedOrigins = env.CORS_ORIGINS.map((origin) => {
  if (!origin.includes("*")) {
    return { raw: origin, regex: null };
  }

  const pattern = `^${escapeRegExp(origin).replace(/\\\*/g, ".*")}$`;
  return { raw: origin, regex: new RegExp(pattern) };
});

const isOriginAllowed = (origin = "") =>
  allowedOrigins.some((entry) =>
    entry.regex ? entry.regex.test(origin) : entry.raw === origin
  );

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/api/health", (req, res) => {
  res.json({ success: true, status: "ok" });
});

app.use("/api", routes);

app.use(errorHandler);

export default app;
