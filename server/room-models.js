import { Router } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { id } from "./validation.js";
import { notFound, isAdminUser } from "./security.js";
import { queueArchitecturalModel } from "./architectural-store.js";
import {
  MAX_SCENE_BYTES,
  validateSceneFile,
  parseCamera,
} from "./room-model-validation.js";

const modelsDir = path.join(config.uploadDir, "models");
const workerEnabled = () => config.roomModel.workerToken.length >= 32;
const stale = () =>
  Object.assign(new Error("Задание устарело или срок обработки истёк"), {
    status: 409,
  });
const credentials = z.object({
  revision: z.coerce.number().int().positive().max(2147483647),
  leaseToken: z.string().uuid(),
});
function parseCredentials(value) {
  const result = credentials.safeParse(value);
  if (!result.success)
    throw Object.assign(new Error("Некорректные параметры задания"), {
      status: 422,
    });
  return result.data;
}
export async function removeModelFiles(names) {
  for (const name of names.filter(Boolean)) {
    if (!/^[a-f0-9-]{36}\.ply$/.test(name)) continue;
    try {
      await unlink(path.join(modelsDir, name));
    } catch (err) {
      if (err.code !== "ENOENT")
        console.error("Model cleanup failed:", err.code);
    }
  }
}
// Called while the property row is locked, in the same transaction as image mutation.
export async function queueRoomModel(client, propertyId) {
  await queueArchitecturalModel(client, propertyId);
  const images = (
    await client.query(
      "SELECT id FROM property_images WHERE property_id=$1 ORDER BY position,id",
      [propertyId],
    )
  ).rows.map((x) => x.id);
  const previous = (
    await client.query(
      "SELECT filename FROM property_models WHERE property_id=$1 FOR UPDATE",
      [propertyId],
    )
  ).rows[0];
  const category = (
    await client.query("SELECT category FROM properties WHERE id=$1", [
      propertyId,
    ])
  ).rows[0]?.category;
  const state =
    images.length >= config.roomModel.minPhotos &&
    category !== "commercial_land"
      ? "queued"
      : "needs_photos";
  await client.query(
    `INSERT INTO property_models(property_id,state,image_ids,available_at) VALUES($1,$2,$3,now()+$4*interval '1 second')
    ON CONFLICT(property_id) DO UPDATE SET revision=property_models.revision+1,state=EXCLUDED.state,image_ids=EXCLUDED.image_ids,available_at=EXCLUDED.available_at,attempts=0,lease_token=NULL,lease_until=NULL,started_at=NULL,filename=NULL,camera=NULL,error_code=NULL,updated_at=now()`,
    [propertyId, state, images, config.roomModel.debounceSeconds],
  );
  return previous?.filename;
}
async function validLease(client, propertyId, value, lock = false) {
  const c = parseCredentials(value);
  const row = (
    await client.query(
      `SELECT * FROM property_models WHERE property_id=$1 AND revision=$2 AND lease_token=$3 AND state='processing' AND lease_until>now() AND started_at>now()-interval '60 minutes' ${lock ? "FOR UPDATE" : ""}`,
      [propertyId, c.revision, c.leaseToken],
    )
  ).rows[0];
  if (!row) throw stale();
  return row;
}
export function roomModelsRouter() {
  const router = Router();
  router.get("/properties/:id/model", async (req, res) => {
    const propertyId = id(req.params.id);
    const admin = await isAdminUser(req.session.userId);
    const p = (
      await pool.query(
        "SELECT owner_id,category FROM properties WHERE id=$1 AND ($3 OR status='published' OR owner_id=$2)",
        [propertyId, req.session.userId || null, admin],
      )
    ).rows[0];
    if (!p) throw notFound();
    const row = (
      await pool.query(
        "SELECT revision,state,filename,camera,error_code,array_length(image_ids,1) AS image_count FROM property_models WHERE property_id=$1",
        [propertyId],
      )
    ).rows[0];
    const isOwner = admin || p.owner_id === req.session.userId;
    if (row?.state === "ready")
      return res.json({
        model: {
          state: "ready",
          revision: row.revision,
          url: `/models/${propertyId}/${row.revision}/scene.ply`,
          camera: row.camera,
          ...(isOwner
            ? {
                minPhotos: config.roomModel.minPhotos,
                imageCount: row.image_count || 0,
              }
            : {}),
        },
      });
    if (!isOwner || p.category === "commercial_land")
      return res.json({ model: { state: "none" } });
    const count = (
      await pool.query(
        "SELECT count(*)::int AS count FROM property_images WHERE property_id=$1",
        [propertyId],
      )
    ).rows[0].count;
    res.json({
      model: {
        state: !workerEnabled() ? "unavailable" : row?.state || "needs_photos",
        revision: row?.revision || 0,
        minPhotos: config.roomModel.minPhotos,
        imageCount: count,
        errorCode: row?.error_code || null,
      },
    });
  });
  return router;
}
export async function serveRoomModel(req, res, next) {
  const propertyId = id(req.params.id),
    revision = id(req.params.revision);
  const admin = await isAdminUser(req.session.userId);
  const row = (
    await pool.query(
      `SELECT m.filename FROM property_models m JOIN properties p ON p.id=m.property_id WHERE m.property_id=$1 AND m.revision=$2 AND m.state='ready' AND ($4 OR p.status='published' OR p.owner_id=$3)`,
      [propertyId, revision, req.session.userId || null, admin],
    )
  ).rows[0];
  if (!row?.filename || !/^[a-f0-9-]{36}\.ply$/.test(row.filename))
    throw notFound();
  res.set("Cache-Control", "private, no-store");
  res.type("application/octet-stream");
  res.sendFile(row.filename, { root: modelsDir, dotfiles: "deny" }, (err) => {
    if (err) next(err);
  });
}
export function roomModelWorkerRouter() {
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const supplied = Buffer.from(req.get("Authorization") || ""),
      expected = Buffer.from("Bearer " + config.roomModel.workerToken);
    if (
      !workerEnabled() ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return res.status(401).json({ error: "Worker authentication required" });
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
  router.use((req, res, next) => {
    // Browser session cookies and Origin are never used to authorize this service API.
    if (req.get("Origin")) return res.sendStatus(403);
    next();
  });
  router.post("/claim", async (req, res) => {
    const job = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(483972)");
      await client.query(
        `UPDATE property_models SET state='failed',error_code='processing_timeout',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='processing' AND (lease_until<=now() OR started_at<=now()-interval '60 minutes') AND attempts>=3`,
      );
      if (
        (
          await client.query(
            "SELECT 1 FROM property_models WHERE state='processing' AND lease_until>now() AND started_at>now()-interval '60 minutes' LIMIT 1",
          )
        ).rowCount
      )
        return null;
      const row = (
        await client.query(
          `SELECT m.* FROM property_models m JOIN properties p ON p.id=m.property_id WHERE p.category<>'commercial_land' AND m.attempts<3 AND ((m.state='queued' AND m.available_at<=now()) OR (m.state='processing' AND (m.lease_until<=now() OR m.started_at<=now()-interval '60 minutes'))) ORDER BY m.available_at,m.property_id FOR UPDATE OF m SKIP LOCKED LIMIT 1`,
        )
      ).rows[0];
      if (!row) return null;
      const token = randomUUID();
      await client.query(
        "UPDATE property_models SET state='processing',lease_token=$2,lease_until=now()+interval '5 minutes',started_at=now(),attempts=attempts+1,updated_at=now() WHERE property_id=$1",
        [row.property_id, token],
      );
      return {
        propertyId: row.property_id,
        revision: row.revision,
        leaseToken: token,
        heartbeatSeconds: 60,
        images: row.image_ids.map((imageId) => ({
          id: imageId,
          url: `/internal/room-models/${row.property_id}/images/${imageId}`,
        })),
      };
    });
    res.json({ job });
  });
  router.post("/:id/heartbeat", async (req, res) => {
    await transaction(async (client) => {
      await validLease(client, id(req.params.id), req.body, true);
      await client.query(
        "UPDATE property_models SET lease_until=LEAST(now()+interval '5 minutes',started_at+interval '60 minutes'),updated_at=now() WHERE property_id=$1",
        [id(req.params.id)],
      );
    });
    res.json({ ok: true });
  });
  router.get("/:id/images/:imageId", async (req, res, next) => {
    const propertyId = id(req.params.id),
      imageId = id(req.params.imageId);
    const row = await validLease(pool, propertyId, {
      revision: req.get("X-Room-Model-Revision"),
      leaseToken: req.get("X-Room-Model-Lease"),
    });
    if (!row.image_ids.includes(imageId)) throw stale();
    const image = (
      await pool.query(
        "SELECT filename FROM property_images WHERE id=$1 AND property_id=$2",
        [imageId, propertyId],
      )
    ).rows[0];
    if (!image || !/^[a-f0-9-]{36}\.webp$/.test(image.filename)) throw stale();
    res
      .type("webp")
      .sendFile(
        image.filename,
        { root: config.uploadDir, dotfiles: "deny" },
        (err) => {
          if (err) next(err);
        },
      );
  });
  router.post("/:id/fail", async (req, res) => {
    const propertyId = id(req.params.id);
    const codes = ["reconstruction_failed", "insufficient_overlap"];
    if (!codes.includes(req.body.code))
      throw Object.assign(new Error("Invalid failure code"), { status: 422 });
    await transaction(async (client) => {
      const row = await validLease(client, propertyId, req.body, true);
      const retry =
        row.attempts < 3 && req.body.code !== "insufficient_overlap";
      await client.query(
        "UPDATE property_models SET state=$2,error_code=$3,lease_token=NULL,lease_until=NULL,available_at=now()+interval '5 minutes',updated_at=now() WHERE property_id=$1",
        [propertyId, retry ? "queued" : "failed", req.body.code],
      );
    });
    res.json({ ok: true });
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, modelsDir),
      filename: (req, file, cb) => cb(null, randomUUID() + ".ply"),
    }),
    limits: {
      fileSize: MAX_SCENE_BYTES,
      files: 1,
      fields: 3,
      fieldSize: 4096,
      parts: 4,
    },
  }).single("scene");
  router.post("/:id/complete", async (req, res, next) => {
    await mkdir(modelsDir, { recursive: true });
    upload(req, res, async (err) => {
      try {
        if (err) throw err;
        if (!req.file)
          throw Object.assign(new Error("Missing scene file"), { status: 422 });
        const propertyId = id(req.params.id),
          camera = parseCamera(req.body.camera);
        await validateSceneFile(req.file.path);
        await transaction(async (client) => {
          await validLease(client, propertyId, req.body, true);
          await client.query(
            "UPDATE property_models SET state='ready',filename=$2,camera=$3,lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=now() WHERE property_id=$1",
            [propertyId, req.file.filename, camera],
          );
        });
        res.json({ ok: true });
      } catch (error) {
        if (req.file?.filename) await removeModelFiles([req.file.filename]);
        if (error instanceof multer.MulterError)
          error = Object.assign(
            new Error(
              error.code === "LIMIT_FILE_SIZE"
                ? "3D-модель должна быть не больше 100 МБ"
                : "Некорректная загрузка 3D-модели",
            ),
            { status: error.code === "LIMIT_FILE_SIZE" ? 413 : 422 },
          );
        next(error);
      }
    });
  });
  return router;
}
