import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Use a dedicated _test database");
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_ORIGIN = "https://mesto.example";
process.env.TRUST_PROXY = "1";
const { createApp } = await import("../server/app.js");
const { pool } = await import("../server/db.js");
const { migrate } = await import("../server/migrate.js");
await migrate();
const instance = createApp();
after(async () => {
  instance.close();
  await pool.end();
});
test("production enforces HTTPS and Secure HttpOnly cookies", async () => {
  await request(instance.app).get("/api/auth/session").expect(400);
  const result = await request(instance.app)
    .get("/api/auth/session")
    .set("X-Forwarded-Proto", "https")
    .expect(200);
  assert.match(result.headers["set-cookie"][0], /; Secure/);
  assert.match(result.headers["set-cookie"][0], /; HttpOnly/);
  assert.match(result.headers["set-cookie"][0], /; SameSite=Lax/);
  assert.ok(result.headers["strict-transport-security"]);
});
test("authentication attempts are rate limited", async () => {
  const session = await request(instance.app)
    .get("/api/auth/session")
    .set("X-Forwarded-Proto", "https");
  const cookie = session.headers["set-cookie"][0].split(";")[0];
  for (let attempt = 0; attempt < 20; attempt++) {
    await request(instance.app)
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ email: "invalid" })
      .expect(422);
  }
  const limited = await request(instance.app)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .set("Cookie", cookie)
    .set("X-CSRF-Token", session.body.csrfToken)
    .send({ email: "invalid" })
    .expect(429);
  assert.ok(limited.headers["retry-after"]);
});
test("entry assets revalidate on every load so deploys take effect", async () => {
  for (const path of ["/styles.css", "/js/app.js"]) {
    const res = await request(instance.app)
      .get(path)
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    assert.match(res.headers["cache-control"], /no-cache/);
  }
  const asset = await request(instance.app)
    .get("/assets/favicon.svg")
    .set("X-Forwarded-Proto", "https")
    .expect(200);
  assert.match(asset.headers["cache-control"], /max-age=3600/);
});
