import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { listProperties } from "./property-data.js";
import { createAssistant } from "./assistant-service.js";
import { createCatalogAssistant } from "./catalog-assistant.js";
import { pool } from "./db.js";

export function assistantRouter({ chat, enabled = true } = {}) {
  const router = Router();
  const mode = config.ai.apiKey && config.ai.model ? "ai" : "catalog";
  const respond =
    chat ||
    (mode === "ai"
      ? createAssistant({ ...config.ai, search: listProperties })
      : createCatalogAssistant({
          search: listProperties,
          locations: async () =>
            (
              await pool.query(
                "SELECT DISTINCT city FROM properties WHERE status='published' ORDER BY city LIMIT 100",
              )
            ).rows.map((row) => row.city),
        }));
  router.get("/", (req, res) =>
    res.json({
      enabled,
      mode,
      diagnosticsVersion: 1,
      configuration: {
        apiKeySet: Boolean(config.ai.apiKey),
        modelSet: Boolean(config.ai.model),
      },
    }),
  );
  router.post(
    "/",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "Слишком много сообщений. Подождите минуту и повторите запрос.",
      },
    }),
    async (req, res) => {
      try {
        res.json(await respond(req.body?.messages));
      } catch (error) {
        // These messages are created by our service, never by the provider.
        if (error.status === 503)
          return res.status(503).json({
            error: error.message,
            ...(error.reason ? { reason: error.reason } : {}),
          });
        throw error;
      }
    },
  );
  return router;
}
