import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Dedicated TEST_DATABASE_URL required");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.ROOM_MODEL_WORKER_TOKEN = "architecture-test-worker-".repeat(4);
process.env.ROOM_MODEL_DEBOUNCE_SECONDS = "0";
const directory = await mkdtemp(path.join(os.tmpdir(), "architecture-api-"));
process.env.UPLOAD_DIR = directory;
const { createApp } = await import("../server/app.js");
const { pool } = await import("../server/db.js");
const { migrate } = await import("../server/migrate.js");
let analyses = 0,
  analysisGate,
  analysisStarted,
  lastPhotos;
const scene = {
  version: 1,
  width: 6,
  depth: 4,
  height: 3,
  floors: [
    {
      points: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      tone: "neutral",
    },
  ],
  walls: [
    { id: "w", start: [0, 0], end: [6, 0], thickness: 0.15, exterior: true },
  ],
  openings: [],
  columns: [],
  furniture: [],
  warnings: [],
};
const instance = createApp({
    architecture: {
      analyze: async ({ photos }) => {
        lastPhotos = photos;
        analyses++;
        analysisStarted?.();
        if (analysisGate) await analysisGate;
        return scene;
      },
    },
  }),
  app = instance.app,
  owner = request.agent(app);
const email = "architecture-" + Date.now() + "@example.invalid";
let csrf, propertyId;
const png = await sharp({
  create: { width: 100, height: 100, channels: 3, background: "#ffffff" },
})
  .png()
  .toBuffer();
const auth = (method, url) => owner[method](url).set("X-CSRF-Token", csrf);
const worker = (url) =>
  request(app)
    .post("/internal/architectural-models" + url)
    .set("Authorization", "Bearer " + process.env.ROOM_MODEL_WORKER_TOKEN);
before(async () => {
  await migrate();
  csrf = (await owner.get("/api/auth/session")).body.csrfToken;
  csrf = (
    await auth("post", "/api/auth/register")
      .send({ name: "Автор модели", email, password: "Long-password-123!" })
      .expect(201)
  ).body.csrfToken;
  propertyId = (
    await auth("post", "/api/properties")
      .send({
        title: "Архитектурная модель офиса",
        deal: "rent",
        category: "office",
        city: "Москва",
        address: "Тестовая улица 10",
        price: 1000,
        area: 24,
        description: "Тест архитектурной модели по планировке и размерам.",
        contactName: "Автор модели",
        contactPhone: "+79991234567",
        status: "draft",
      })
      .expect(201)
  ).body.property.id;
});
after(async () => {
  await pool.query("DELETE FROM users WHERE email=$1", [email]);
  instance.close();
  await pool.end();
  assert.equal(path.dirname(directory), os.tmpdir());
  await rm(directory, { recursive: true, force: true });
});
test("plan and dimension inputs trigger automatic architecture, stale leases fail and draft access stays private", async () => {
  const base = "/api/properties/" + propertyId + "/architecture";
  await request(app).get(base).expect(404);
  await request(app)
    .put(base + "/input")
    .send({ width: 6, depth: 4, height: 3 })
    .expect(403);
  await auth("put", base + "/input")
    .send({ width: 0, depth: 4, height: 3 })
    .expect(422);
  await auth("put", base + "/input")
    .send({ width: 6, depth: 4, height: 3 })
    .expect(200);
  assert.equal((await owner.get(base)).body.model.state, "needs_inputs");
  await auth("post", base + "/plan")
    .attach("plan", png, { filename: "plan.png", contentType: "image/png" })
    .expect(200);
  assert.equal(
    (await owner.get(base)).body.model.state,
    "queued",
    "plan and dimensions without photos must queue the model",
  );
  const planOnly = (await worker("/claim").send({}).expect(200)).body.job;
  assert.deepEqual(planOnly.images, []);
  await worker("/" + propertyId + "/analyze")
    .send(planOnly)
    .expect(200);
  assert.deepEqual(lastPhotos, []);
  assert.equal((await owner.get(base)).body.model.state, "ready");
  const planUrl = (await owner.get(base)).body.inputs.planUrl;
  await request(app).get(planUrl).expect(404);
  await owner.get(planUrl).expect(200);
  await auth("post", "/api/properties/" + propertyId + "/images")
    .attach("images", png, { filename: "room.png", contentType: "image/png" })
    .expect(201);
  assert.equal((await owner.get(base)).body.model.state, "queued");
  await request(app)
    .post("/internal/architectural-models/claim")
    .send({})
    .expect(401);
  const old = (await worker("/claim").send({}).expect(200)).body.job;
  assert.equal(old.propertyId, propertyId);
  await auth("put", base + "/input")
    .send({ width: 6, depth: 4, height: 3 })
    .expect(200);
  await worker("/" + propertyId + "/heartbeat")
    .send(old)
    .expect(409);
  const job = (await worker("/claim").send({}).expect(200)).body.job;
  await worker("/" + propertyId + "/heartbeat")
    .send(job)
    .expect(200);
  await worker("/" + propertyId + "/analyze")
    .send(job)
    .expect(200);
  assert.equal(analyses, 2);
  const model = (await owner.get(base)).body.model;
  assert.equal(model.state, "ready");
  assert.match(model.url, /scene\.json$/);
  await request(app).get(model.url).expect(404);
  assert.deepEqual((await owner.get(model.url).expect(200)).body, scene);
  await auth("patch", "/api/properties/" + propertyId)
    .send({ status: "published" })
    .expect(200);
  assert.equal(
    (await request(app).get(base).expect(200)).body.model.state,
    "ready",
  );
  await request(app).get(model.url).expect(200);
  await auth("put", base + "/input")
    .send({ width: 6, depth: 4, height: 3 })
    .expect(200);
  const pending = (await worker("/claim").send({}).expect(200)).body.job;
  let release;
  analysisGate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    analysisStarted = resolve;
  });
  const requestInFlight = worker("/" + propertyId + "/analyze")
    .send(pending)
    .then((response) => response);
  await started;
  await auth("put", base + "/input")
    .send({ width: 6, depth: 4, height: 3 })
    .expect(200);
  release();
  assert.equal(
    (await requestInFlight).status,
    409,
    "input change while provider is running must reject completion",
  );
  analysisGate = null;
  analysisStarted = null;
  assert.equal((await owner.get(base)).body.model.state, "queued");
  const local = (await worker("/claim").send({}).expect(200)).body.job;
  assert.deepEqual(local.dimensions, { width: 6, depth: 4, height: 3 });
  assert.ok(local.instructions.includes("floor plan"));
  assert.ok(local.sceneSchema.anyOf);
  await request(app).get(local.plan.url).expect(401);
  const localGet = (url) =>
    request(app)
      .get(url)
      .set("Authorization", "Bearer " + process.env.ROOM_MODEL_WORKER_TOKEN)
      .set("X-Room-Model-Revision", String(local.revision))
      .set("X-Room-Model-Lease", local.leaseToken);
  await localGet(local.plan.url).expect(200);
  await localGet(local.images[0].url).expect(200);
  await worker("/" + propertyId + "/complete")
    .send({ ...local, scene: { ...scene, width: 7 } })
    .expect(422);
  assert.equal((await owner.get(base)).body.model.state, "processing");
  await worker("/" + propertyId + "/complete")
    .send({ ...local, scene })
    .expect(200);
  const localReady = (await request(app).get(base)).body.model;
  assert.equal(localReady.state, "ready");
  assert.deepEqual(
    (await request(app).get(localReady.url).expect(200)).body,
    scene,
  );
  await localGet(local.plan.url).expect(409);
  await auth("delete", base + "/plan").expect(200);
  await request(app).get(model.url).expect(404);
});
