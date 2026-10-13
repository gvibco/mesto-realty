import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { id } from "./validation.js";
import { requireAuth, notFound } from "./security.js";
import {
  analyzeFloorPlan,
  architecturalPrompt,
} from "./architectural-analysis.js";
import { architecturalJsonSchema } from "./architectural-json-schema.js";
import { parseArchitecturalScene } from "../public/js/architectural-schema.js";
import {
  architectureDir,
  plansDir,
  ensureArchitecturalDirectories,
  removeArchitecturalFiles,
  queueArchitecturalModel,
} from "./architectural-store.js";

const error = (message, status = 422, code) =>
  Object.assign(new Error(message), { status, code });
const stale = () => error("Задание устарело", 409);
const dimensions = z
  .object({
    width: z.number().min(0.1).max(200),
    depth: z.number().min(0.1).max(200),
    height: z.number().min(0.5).max(50),
  })
  .strict();
const credentials = z.object({
  revision: z.number().int().positive(),
  leaseToken: z.string().uuid(),
});
const planPattern = /^[a-f0-9-]{36}\.webp$/;
const scenePattern = /^[a-f0-9-]{36}\.json$/;
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw error("Проверьте размеры и параметры");
  return result.data;
}
async function own(client, propertyId, userId) {
  if (
    !(
      await client.query(
        "SELECT id FROM properties WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [propertyId, userId],
      )
    ).rows.length
  )
    throw notFound();
}
async function visible(propertyId, userId) {
  const row = (
    await pool.query(
      "SELECT owner_id,category FROM properties WHERE id=$1 AND (status='published' OR owner_id=$2)",
      [propertyId, userId || null],
    )
  ).rows[0];
  if (!row) throw notFound();
  return row;
}
async function lease(client, propertyId, value, lock = false) {
  const c = parse(credentials, value);
  const row = (
    await client.query(
      `SELECT * FROM architectural_models WHERE property_id=$1 AND revision=$2 AND lease_token=$3 AND state='processing' AND lease_until>now() AND started_at>now()-interval '60 minutes' ${lock ? "FOR UPDATE" : ""}`,
      [propertyId, c.revision, c.leaseToken],
    )
  ).rows[0];
  if (!row) throw stale();
  return row;
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  fileFilter(req, file, done) {
    done(
      null,
      ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype),
    );
  },
}).single("plan");
export function architecturalModelsRouter() {
  const router = Router();
  router.get("/properties/:id/architecture", async (req, res) => {
    const propertyId = id(req.params.id),
      p = await visible(propertyId, req.session.userId);
    const row = (
      await pool.query(
        "SELECT * FROM architectural_models WHERE property_id=$1",
        [propertyId],
      )
    ).rows[0];
    const owner = p.owner_id === req.session.userId;
    const model =
      row?.state === "ready"
        ? {
            state: "ready",
            revision: row.revision,
            url: `/architectural-models/${propertyId}/${row.revision}/scene.json`,
            warnings: row.warnings,
          }
        : owner
          ? {
              state:
                config.roomModel.workerToken.length < 32
                  ? "unavailable"
                  : row?.state || "needs_inputs",
              revision: row?.revision || 0,
              errorCode: row?.error_code || null,
            }
          : { state: "none" };
    const input = owner
      ? (
          await pool.query(
            "SELECT * FROM architectural_inputs WHERE property_id=$1",
            [propertyId],
          )
        ).rows[0]
      : null;
    res.json({
      model,
      ...(owner
        ? {
            inputs: {
              width: input?.width ?? null,
              depth: input?.depth ?? null,
              height: input?.height ?? null,
              hasPlan: !!input?.plan_filename,
              planUrl: input?.plan_filename
                ? `/property-plans/${propertyId}/${input.plan_filename}`
                : null,
            },
          }
        : {}),
    });
  });
  router.put(
    "/properties/:id/architecture/input",
    requireAuth,
    async (req, res) => {
      const propertyId = id(req.params.id),
        d = parse(dimensions, req.body);
      await transaction(async (client) => {
        await own(client, propertyId, req.session.userId);
        await client.query(
          "INSERT INTO architectural_inputs(property_id,width,depth,height) VALUES($1,$2,$3,$4) ON CONFLICT(property_id) DO UPDATE SET width=$2,depth=$3,height=$4,updated_at=now()",
          [propertyId, d.width, d.depth, d.height],
        );
        await queueArchitecturalModel(client, propertyId);
      });
      res.json({ ok: true });
    },
  );
  router.post(
    "/properties/:id/architecture/plan",
    requireAuth,
    rateLimit({
      windowMs: 60000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res, next) => {
      try {
        const propertyId = id(req.params.id);
        if (
          !(
            await pool.query(
              "SELECT id FROM properties WHERE id=$1 AND owner_id=$2",
              [propertyId, req.session.userId],
            )
          ).rows.length
        )
          throw notFound();
        next();
      } catch (err) {
        next(err);
      }
    },
    upload,
    async (req, res) => {
      if (!req.file) throw error("Загрузите планировку в PNG, JPEG или WebP");
      let bytes;
      try {
        const image = sharp(req.file.buffer, {
          limitInputPixels: 40000000,
          animated: false,
        });
        const meta = await image.metadata();
        if (
          (meta.pages || 1) > 1 ||
          !["png", "jpeg", "webp"].includes(meta.format) ||
          { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" }[
            req.file.mimetype
          ] !== meta.format
        )
          throw new Error();
        bytes = await image
          .rotate()
          .resize({
            width: 2200,
            height: 2200,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ lossless: true })
          .toBuffer();
        if (bytes.length > 8 * 1024 * 1024) throw new Error();
      } catch {
        throw error("Не удалось прочитать планировку");
      }
      const propertyId = id(req.params.id),
        filename = randomUUID() + ".webp";
      await ensureArchitecturalDirectories();
      await writeFile(path.join(plansDir, filename), bytes, { flag: "wx" });
      let old;
      try {
        await transaction(async (client) => {
          await own(client, propertyId, req.session.userId);
          old = (
            await client.query(
              "SELECT plan_filename FROM architectural_inputs WHERE property_id=$1",
              [propertyId],
            )
          ).rows[0]?.plan_filename;
          await client.query(
            "INSERT INTO architectural_inputs(property_id,plan_filename) VALUES($1,$2) ON CONFLICT(property_id) DO UPDATE SET plan_filename=$2,updated_at=now()",
            [propertyId, filename],
          );
          await queueArchitecturalModel(client, propertyId);
        });
      } catch (err) {
        await removeArchitecturalFiles({ plans: [filename] });
        throw err;
      }
      await removeArchitecturalFiles({ plans: [old] });
      res.json({
        ok: true,
        inputs: {
          hasPlan: true,
          planUrl: `/property-plans/${propertyId}/${filename}`,
        },
      });
    },
  );
  router.delete(
    "/properties/:id/architecture/plan",
    requireAuth,
    async (req, res) => {
      let old;
      const propertyId = id(req.params.id);
      await transaction(async (client) => {
        await own(client, propertyId, req.session.userId);
        old = (
          await client.query(
            "SELECT plan_filename FROM architectural_inputs WHERE property_id=$1",
            [propertyId],
          )
        ).rows[0]?.plan_filename;
        await client.query(
          "UPDATE architectural_inputs SET plan_filename=NULL,updated_at=now() WHERE property_id=$1",
          [propertyId],
        );
        await queueArchitecturalModel(client, propertyId);
      });
      await removeArchitecturalFiles({ plans: [old] });
      res.json({ ok: true });
    },
  );
  return router;
}
export async function servePropertyPlan(req, res, next) {
  const propertyId = id(req.params.id);
  await visible(propertyId, req.session.userId);
  const row = (
    await pool.query(
      "SELECT plan_filename FROM architectural_inputs WHERE property_id=$1",
      [propertyId],
    )
  ).rows[0];
  if (
    !planPattern.test(req.params.filename) ||
    row?.plan_filename !== req.params.filename
  )
    throw notFound();
  res.set("Cache-Control", "private, no-store");
  res.type("image/webp");
  res.sendFile(
    row.plan_filename,
    { root: plansDir, dotfiles: "deny" },
    (err) => {
      if (err) next(err);
    },
  );
}
export async function serveArchitecturalModel(req, res, next) {
  const row = (
    await pool.query(
      "SELECT m.filename FROM architectural_models m JOIN properties p ON p.id=m.property_id WHERE m.property_id=$1 AND m.revision=$2 AND m.state='ready' AND (p.status='published' OR p.owner_id=$3)",
      [id(req.params.id), id(req.params.revision), req.session.userId || null],
    )
  ).rows[0];
  if (!row?.filename || !scenePattern.test(row.filename)) throw notFound();
  res.set("Cache-Control", "private, no-store");
  res.type("application/json");
  res.sendFile(
    row.filename,
    { root: architectureDir, dotfiles: "deny" },
    (err) => {
      if (err) next(err);
    },
  );
}

const failureCodes = new Set([
  "provider_unavailable",
  "vision_unavailable",
  "unreadable_plan",
  "invalid_layout",
  "processing_failed",
  "processing_timeout",
]);
async function fail(propertyId, value, code) {
  await transaction(async (client) => {
    const row = await lease(client, propertyId, value, true);
    const retry =
      [
        "provider_unavailable",
        "processing_failed",
        "processing_timeout",
      ].includes(code) && row.attempts < 3;
    await client.query(
      "UPDATE architectural_models SET state=$2,error_code=$3,lease_token=NULL,lease_until=NULL,available_at=now()+interval '60 seconds',updated_at=now() WHERE property_id=$1",
      [propertyId, retry ? "queued" : "failed", code],
    );
  });
}
export function architecturalWorkerRouter({ analyze = analyzeFloorPlan } = {}) {
  const router = Router(),
    inflight = new Map();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const supplied = Buffer.from(req.get("Authorization") || ""),
      expected = Buffer.from("Bearer " + config.roomModel.workerToken);
    if (
      config.roomModel.workerToken.length < 32 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return res.status(401).json({ error: "Недопустимый токен" });
    next();
  });
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  router.post("/claim", async (req, res) => {
    const job = await transaction(async (client) => {
      await client.query(
        "UPDATE architectural_models SET state='failed',error_code='processing_timeout',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='processing' AND (lease_until<=now() OR started_at<=now()-interval '60 minutes') AND attempts>=3",
      );
      const row = (
        await client.query(
          "SELECT * FROM architectural_models WHERE attempts<3 AND available_at<=now() AND (state='queued' OR (state='processing' AND (lease_until<=now() OR started_at<=now()-interval '60 minutes'))) ORDER BY available_at,property_id FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return null;
      const token = randomUUID();
      await client.query(
        "UPDATE architectural_models SET state='processing',error_code=NULL,attempts=attempts+1,lease_token=$2,lease_until=now()+interval '5 minutes',started_at=now(),updated_at=now() WHERE property_id=$1",
        [row.property_id, token],
      );
      return {
        propertyId: row.property_id,
        revision: row.revision,
        leaseToken: token,
        dimensions: row.dimensions,
        instructions: architecturalPrompt,
        sceneSchema: architecturalJsonSchema(row.dimensions),
        plan: { url: `/internal/architectural-models/${row.property_id}/plan` },
        images: Array.from(
          new Set([
            row.image_ids[0],
            row.image_ids[Math.floor(row.image_ids.length / 2)],
            row.image_ids.at(-1),
          ]),
        )
          .filter(Boolean)
          .map((imageId) => ({
            url: `/internal/architectural-models/${row.property_id}/photos/${imageId}`,
          })),
      };
    });
    res.json({ job });
  });
  const downloadCredentials = (req) => ({
    revision: Number(req.get("X-Room-Model-Revision")),
    leaseToken: req.get("X-Room-Model-Lease"),
  });
  router.get("/:id/plan", async (req, res, next) => {
    const row = await lease(pool, id(req.params.id), downloadCredentials(req));
    if (!planPattern.test(row.plan_filename)) throw notFound();
    res.type("image/webp");
    res.sendFile(
      row.plan_filename,
      { root: plansDir, dotfiles: "deny" },
      (err) => {
        if (err) next(err);
      },
    );
  });
  router.get("/:id/photos/:imageId", async (req, res, next) => {
    const propertyId = id(req.params.id),
      row = await lease(pool, propertyId, downloadCredentials(req)),
      imageId = id(req.params.imageId);
    if (!row.image_ids.includes(imageId)) throw notFound();
    const image = (
      await pool.query(
        "SELECT filename FROM property_images WHERE property_id=$1 AND id=$2",
        [propertyId, imageId],
      )
    ).rows[0];
    if (!image || !planPattern.test(image.filename)) throw notFound();
    res.type("image/webp");
    res.sendFile(
      image.filename,
      { root: config.uploadDir, dotfiles: "deny" },
      (err) => {
        if (err) next(err);
      },
    );
  });
  router.post("/:id/complete", async (req, res) => {
    const propertyId = id(req.params.id),
      c = parse(credentials, req.body),
      row = await lease(pool, propertyId, c);
    let scene;
    try {
      scene = parseArchitecturalScene(req.body.scene, row.dimensions);
    } catch {
      return res
        .status(422)
        .json({ error: "Некорректная геометрия", code: "invalid_layout" });
    }
    const filename = randomUUID() + ".json";
    await ensureArchitecturalDirectories();
    await writeFile(
      path.join(architectureDir, filename),
      JSON.stringify(scene),
      { flag: "wx" },
    );
    let previous;
    try {
      await transaction(async (client) => {
        const current = await lease(client, propertyId, c, true);
        previous = current.previous_filename;
        await client.query(
          "UPDATE architectural_models SET state='ready',filename=$2,previous_filename=NULL,warnings=$3,error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE property_id=$1",
          [propertyId, filename, JSON.stringify(scene.warnings)],
        );
      });
    } catch (err) {
      await removeArchitecturalFiles({ models: [filename] });
      throw err;
    }
    await removeArchitecturalFiles({ models: [previous] });
    res.json({ ok: true });
  });
  router.post("/:id/heartbeat", async (req, res) => {
    await transaction(async (client) => {
      await lease(client, id(req.params.id), req.body, true);
      await client.query(
        "UPDATE architectural_models SET lease_until=LEAST(now()+interval '5 minutes',started_at+interval '60 minutes'),updated_at=now() WHERE property_id=$1",
        [id(req.params.id)],
      );
    });
    res.json({ ok: true });
  });
  router.post("/:id/fail", async (req, res) => {
    const code = failureCodes.has(req.body.code)
      ? req.body.code
      : "processing_failed";
    await fail(id(req.params.id), req.body, code);
    res.json({ ok: true });
  });
  router.post("/:id/analyze", async (req, res) => {
    const propertyId = id(req.params.id),
      c = parse(credentials, req.body),
      key = `${propertyId}:${c.revision}:${c.leaseToken}`;
    if (!inflight.has(key))
      inflight.set(
        key,
        (async () => {
          const row = await lease(pool, propertyId, c);
          const images = (
            await pool.query(
              "SELECT filename FROM property_images WHERE property_id=$1 AND id=ANY($2::int[]) ORDER BY position,id",
              [propertyId, row.image_ids],
            )
          ).rows;
          if (
            !planPattern.test(row.plan_filename) ||
            images.length !== row.image_ids.length
          )
            throw error("Исходные данные изменились", 422, "invalid_layout");
          async function image(directory, filename, size) {
            if (!planPattern.test(filename))
              throw error("Некорректное изображение", 422, "invalid_layout");
            const bytes = await sharp(
              await readFile(path.join(directory, filename)),
              { limitInputPixels: 40000000 },
            )
              .rotate()
              .resize({
                width: size,
                height: size,
                fit: "inside",
                withoutEnlargement: true,
              })
              .webp({ quality: 90 })
              .toBuffer();
            return { bytes, mime: "image/webp" };
          }
          const plan = await image(plansDir, row.plan_filename, 2200),
            photos = await Promise.all(
              images
                .slice(0, 6)
                .map((x) => image(config.uploadDir, x.filename, 1200)),
            );
          const scene = parseArchitecturalScene(
              await analyze(
                { plan, photos, dimensions: row.dimensions },
                config.ai,
              ),
              row.dimensions,
            ),
            filename = randomUUID() + ".json";
          await ensureArchitecturalDirectories();
          await writeFile(
            path.join(architectureDir, filename),
            JSON.stringify(scene),
            { flag: "wx" },
          );
          let previous;
          try {
            await transaction(async (client) => {
              const current = await lease(client, propertyId, c, true);
              previous = current.previous_filename;
              await client.query(
                "UPDATE architectural_models SET state='ready',filename=$2,previous_filename=NULL,warnings=$3,error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE property_id=$1",
                [propertyId, filename, JSON.stringify(scene.warnings)],
              );
            });
          } catch (err) {
            await removeArchitecturalFiles({ models: [filename] });
            throw err;
          }
          await removeArchitecturalFiles({ models: [previous] });
        })(),
      );
    try {
      await inflight.get(key);
      res.json({ ok: true });
    } catch (err) {
      if (err.status === 409) throw err;
      const code = failureCodes.has(err.code) ? err.code : "processing_failed";
      try {
        await fail(propertyId, c, code);
      } catch (failure) {
        if (failure.status !== 409) throw failure;
      }
      res.status(err.status === 422 ? 422 : 503).json({
        error:
          code === "unreadable_plan"
            ? "Планировка не читается. Загрузите чёткое изображение"
            : "Не удалось создать модель. Проверьте исходные данные или повторите позже.",
        code,
        ...([
          "insufficient_quota",
          "rate_limit_exceeded",
          "billing_hard_limit_reached",
          "quota_exceeded",
          "too_many_requests",
        ].includes(err.providerCode)
          ? { providerCode: err.providerCode }
          : {}),
        ...(/^(http_[1-5]\d\d|timeout|request_failed)$/.test(
          err.diagnostic || "",
        )
          ? { diagnostic: err.diagnostic }
          : {}),
      });
    } finally {
      inflight.delete(key);
    }
  });
  return router;
}
