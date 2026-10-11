import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { config } from "./config.js";
import { csrf } from "./security.js";
import { authRouter } from "./auth.js";
import { propertiesRouter } from "./properties.js";
import { profileRouter } from "./profile.js";
import { uploadsRouter, serveMedia } from "./uploads.js";
import { assistantRouter } from "./assistant.js";
import { subscriptionsRouter } from "./subscriptions.js";
import {
  architecturalModelsRouter,
  architecturalWorkerRouter,
  serveArchitecturalModel,
  servePropertyPlan,
} from "./architectural-models.js";
import {
  roomModelsRouter,
  roomModelWorkerRouter,
  serveRoomModel,
} from "./room-models.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
export function createApp({ assistant, architecture } = {}) {
  const app = express();

  app.set("trust proxy", 1);

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            (req) =>
              /^\/property\/\d+\/?$/.test(req.path)
                ? "'wasm-unsafe-eval'"
                : "'self'",
          ],
          workerSrc: ["'self'", "blob:"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "blob:", "data:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production ? undefined : false,
    }),
  );
  app.use((req, res, next) => {
    if (config.production && !req.secure)
      return res
        .status(400)
        .json({ error: "Используйте защищённое HTTPS-соединение" });
    next();
  });
  app.use(
    express.static(publicDir, {
      index: false,
      dotfiles: "deny",
      maxAge: config.production ? "1h" : 0,
    }),
  );
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    tableName: "sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60,
  });
  app.use(
    session({
      name: "mesto.sid",
      store,
      secret: config.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      },
    }),
  );
  app.use(
    "/internal/architectural-models",
    express.json({ limit: "1100kb", strict: true }),
    architecturalWorkerRouter(architecture),
  );
  app.use(express.json({ limit: "100kb", strict: true }));
  app.use("/internal/room-models", roomModelWorkerRouter());
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Слишком много запросов. Попробуйте через минуту." },
    }),
    csrf,
  );
  app.get("/api/health", async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.use("/api/auth", authRouter());
  app.use("/api/profile", profileRouter());
  app.use("/api/assistant", assistantRouter(assistant));
  app.use("/api", subscriptionsRouter());
  app.use(
    "/api",
    propertiesRouter(),
    uploadsRouter(),
    roomModelsRouter(),
    architecturalModelsRouter(),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Маршрут API не найден" }),
  );
  app.get("/media/:filename", serveMedia);
  app.get("/models/:id/:revision/scene.ply", serveRoomModel);
  app.get("/property-plans/:id/:filename", servePropertyPlan);
  app.get(
    "/architectural-models/:id/:revision/scene.json",
    serveArchitecturalModel,
  );
  app.get(
    /^\/(?:catalog|property\/\d+|login|register|account|publish|edit\/\d+)?\/?$/,
    (req, res) => res.sendFile(path.join(publicDir, "index.html")),
  );
  app.use((req, res) => res.status(404).json({ error: "Страница не найдена" }));
  app.use((err, req, res, next) => {
    if (req.aborted || res.destroyed) return;
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError)
      return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 422).json({
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? "Файл должен быть не больше 8 МБ"
            : "Не более 10 фотографий; используйте корректное поле загрузки",
      });
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "Слишком большой запрос" });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "Некорректный JSON" });
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500)
      console.error("Request failed:", err.code || err.name, err.message);
    res.status(status).json({
      error:
        status === 500
          ? "Сервис временно недоступен. Попробуйте позже."
          : err.message,
      ...(err.fields ? { fields: err.fields } : {}),
    });
  });
  return { app, close: () => store.close() };
}
