import "dotenv/config";
import path from "node:path";

const production = process.env.NODE_ENV === "production";
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32)
  throw new Error(
    "SESSION_SECRET должен содержать минимум 32 символа. См. .env.example",
  );
if (!process.env.DATABASE_URL) throw new Error("Не задан DATABASE_URL");
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
if (production && !origin.startsWith("https://"))
  throw new Error("В production APP_ORIGIN должен использовать HTTPS");
const aiBaseUrl = process.env.AI_BASE_URL || "https://api.openai.com/v1";
const boundedInteger = (value, fallback, min, max) => {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  return Math.max(
    min,
    Math.min(max, Number.isFinite(parsed) ? Math.floor(parsed) : fallback),
  );
};
export const config = {
  production,
  secret,
  origin: new URL(origin).origin,
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "./uploads"),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  adminEmail: (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
  roomModel: {
    workerToken: process.env.ROOM_MODEL_WORKER_TOKEN || "",
    minPhotos: boundedInteger(process.env.ROOM_MODEL_MIN_PHOTOS, 20, 2, 200),
    debounceSeconds: boundedInteger(
      process.env.ROOM_MODEL_DEBOUNCE_SECONDS,
      60,
      0,
      3600,
    ),
  },
  ai: {
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || "",
    baseUrl: aiBaseUrl,
    provider: (
      process.env.AI_PROVIDER ||
      (aiBaseUrl.includes("giga.chat") ? "gigachat" : "openai")
    ).toLowerCase(),
    oauthUrl:
      process.env.AI_OAUTH_URL ||
      "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    scope: process.env.AI_SCOPE || "GIGACHAT_API_PERS",
  },
};
