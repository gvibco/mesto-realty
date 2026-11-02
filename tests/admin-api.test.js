import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error(
    "Set TEST_DATABASE_URL to a dedicated database ending in _test",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.UPLOAD_DIR = await mkdtemp(path.join(os.tmpdir(), "mesto-admin-"));
process.env.NODE_ENV = "test";
// ВАЖНО: до импорта server/app.js (config.js читает ADMIN_EMAIL один раз).
const ADMIN_EMAIL = `admin-${Date.now()}@example.com`;
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const { createApp } = await import("../server/app.js");
const { migrate } = await import("../server/migrate.js");
const { pool } = await import("../server/db.js");
const instance = createApp();
const app = instance.app;
const admin = request.agent(app);
const user = request.agent(app);
const password = "test-password-123";
const userEmail = `user-${Date.now()}@example.com`;
let adminToken;
let userToken;
let userId;
let draftId;

// Минимальный валидный черновик — поля сверить с propertySchema в
// server/validation.js и образцом создания объекта в tests/api.test.js.
const draftPayload = {
  deal: "sale",
  category: "office",
  title: "Админ-тест: офис 100 м²",
  city: "Москва",
  address: "ул. Тестовая, 1",
  price: "10000000",
  area: "100",
  tax: "unspecified",
  parking: false,
  description: "Тестовое объявление для админ-проверок.",
  contactName: "Пользователь Тест",
  contactPhone: "+79001234567",
  status: "draft",
};

before(async () => {
  await migrate();
  let r = await admin.get("/api/auth/session").expect(200);
  adminToken = r.body.csrfToken;
  r = await admin
    .post("/api/auth/register")
    .set("X-CSRF-Token", adminToken)
    .send({
      name: "Админ Тест",
      email: ADMIN_EMAIL,
      password,
      company: "Место Бизнес",
      businessRole: "owner",
    });
  assert.equal(r.status, 201);
  assert.equal(r.body.isAdmin, true);
  adminToken = r.body.csrfToken;

  r = await user.get("/api/auth/session").expect(200);
  userToken = r.body.csrfToken;
  r = await user
    .post("/api/auth/register")
    .set("X-CSRF-Token", userToken)
    .send({
      name: "Пользователь Тест",
      email: userEmail,
      password,
      company: "",
      businessRole: "owner",
    });
  assert.equal(r.status, 201);
  assert.equal(r.body.isAdmin, false);
  userToken = r.body.csrfToken;
  userId = r.body.user.id;

  r = await user
    .post("/api/properties")
    .set("X-CSRF-Token", userToken)
    .send(draftPayload);
  assert.equal(r.status, 201);
  draftId = r.body.property.id;
});

after(async () => {
  await pool.query("DELETE FROM properties WHERE owner_id=$1", [userId]);
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.query("DELETE FROM users WHERE email=$1", [ADMIN_EMAIL]);
  await rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
  instance.close();
  await pool.end();
});

test("session reports effective admin rights", async () => {
  const a = await admin.get("/api/auth/session").expect(200);
  assert.equal(a.body.isAdmin, true);
  const u = await user.get("/api/auth/session").expect(200);
  assert.equal(u.body.isAdmin, false);
  const anon = await request(app).get("/api/auth/session").expect(200);
  assert.equal(anon.body.isAdmin, false);
});

test("blocked user cannot log in and loses the active session", async () => {
  await pool.query("UPDATE users SET is_blocked=true WHERE id=$1", [userId]);
  const login = await user
    .post("/api/auth/login")
    .set("X-CSRF-Token", userToken)
    .send({ email: userEmail, password });
  assert.equal(login.status, 403);
  assert.equal(login.body.error, "Аккаунт заблокирован");
  const session = await user.get("/api/auth/session").expect(200);
  assert.equal(session.body.user, null);
  // Сессия перегенерирована — берём свежий CSRF-токен, как делает клиент.
  userToken = session.body.csrfToken;
  await pool.query("UPDATE users SET is_blocked=false WHERE id=$1", [userId]);
  const ok = await user
    .post("/api/auth/login")
    .set("X-CSRF-Token", userToken)
    .send({ email: userEmail, password });
  assert.equal(ok.status, 200);
  userToken = ok.body.csrfToken;
});

test("admin sees and edits a foreign draft via existing endpoints", async () => {
  const anon = await request(app).get(`/api/properties/${draftId}`);
  assert.equal(anon.status, 404);
  const seen = await admin.get(`/api/properties/${draftId}`).expect(200);
  assert.equal(seen.body.property.id, draftId);
  const patched = await admin
    .patch(`/api/properties/${draftId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ title: "Отредактировано админом" });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.property.title, "Отредактировано админом");

  // Посторонний зарегистрированный пользователь не может править чужое.
  const other = request.agent(app);
  let r = await other.get("/api/auth/session").expect(200);
  r = await other
    .post("/api/auth/register")
    .set("X-CSRF-Token", r.body.csrfToken)
    .send({
      name: "Посторонний Тест",
      email: `other-${Date.now()}@example.com`,
      password,
      company: "",
      businessRole: "broker",
    })
    .expect(201);
  try {
    assert.equal(
      await other.get(`/api/properties/${draftId}`).then((x) => x.status),
      404,
    );
    const forbidden = await other
      .patch(`/api/properties/${draftId}`)
      .set("X-CSRF-Token", r.body.csrfToken)
      .send({ title: "Не положено" });
    assert.equal(forbidden.status, 404);
  } finally {
    await pool.query("DELETE FROM users WHERE id=$1", [r.body.user.id]);
  }
});

test("admin API is closed to non-admins", async () => {
  for (const path of [
    "/api/admin/stats",
    "/api/admin/properties",
    "/api/admin/users",
    "/api/admin/content",
  ]) {
    assert.equal((await request(app).get(path)).status, 401);
    assert.equal((await user.get(path)).status, 403);
  }
  const patch = await user
    .patch(`/api/admin/users/${userId}`)
    .set("X-CSRF-Token", userToken)
    .send({ blocked: true });
  assert.equal(patch.status, 403);
});

test("admin dashboard, listings and user management", async () => {
  const stats = await admin.get("/api/admin/stats").expect(200);
  assert.ok(stats.body.users >= 2);
  assert.ok(stats.body.properties >= 1);
  assert.ok(stats.body.drafts >= 1);

  const list = await admin
    .get("/api/admin/properties?status=draft&limit=48")
    .expect(200);
  const item = list.body.items.find((p) => p.id === draftId);
  assert.ok(item, "черновик пользователя виден админу");
  assert.equal(item.ownerEmail, userEmail);

  const users = await admin.get("/api/admin/users").expect(200);
  const u = users.body.items.find((x) => x.id === userId);
  assert.ok(u);
  assert.equal(u.blocked, false);
  assert.ok(u.propertyCount >= 1);

  const adminId = (
    await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])
  ).rows[0].id;
  const self = await admin
    .patch(`/api/admin/users/${adminId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ blocked: true });
  assert.equal(self.status, 422, "самоблокировка запрещена");

  const blocked = await admin
    .patch(`/api/admin/users/${userId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ blocked: true });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.blocked, true);
  const dead = await user.get("/api/auth/session").expect(200);
  assert.equal(dead.body.user, null, "сессия заблокированного убита");
  userToken = dead.body.csrfToken;
  const unblocked = await admin
    .patch(`/api/admin/users/${userId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ blocked: false });
  assert.equal(unblocked.status, 200);
});

test("admin can grant and revoke admin rights without self-lockout", async () => {
  const adminId = (
    await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])
  ).rows[0].id;
  const self = await admin
    .patch(`/api/admin/users/${adminId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ admin: false });
  assert.equal(self.status, 422, "самоснятие прав запрещено");

  const promote = await admin
    .patch(`/api/admin/users/${userId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ admin: true });
  assert.equal(promote.status, 200);
  assert.equal(promote.body.admin, true);
  // Предыдущий тест блокировки удалил старые сессии пользователя —
  // входим заново, чтобы проверить обновлённые права.
  let login = await user.get("/api/auth/session").expect(200);
  login = await user
    .post("/api/auth/login")
    .set("X-CSRF-Token", login.body.csrfToken)
    .send({ email: userEmail, password });
  assert.equal(login.status, 200);
  userToken = login.body.csrfToken;
  const session = await user.get("/api/auth/session").expect(200);
  assert.equal(session.body.isAdmin, true);
  await user.get("/api/admin/stats").expect(200);

  const bootstrap = await user
    .patch(`/api/admin/users/${adminId}`)
    .set("X-CSRF-Token", userToken)
    .send({ admin: false });
  assert.equal(bootstrap.status, 422, "ADMIN_EMAIL нельзя разжаловать");

  const blockBootstrap = await user
    .patch(`/api/admin/users/${adminId}`)
    .set("X-CSRF-Token", userToken)
    .send({ blocked: true });
  assert.equal(blockBootstrap.status, 422, "ADMIN_EMAIL нельзя заблокировать");

  const mixedSelf = await admin
    .patch(`/api/admin/users/${adminId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ blocked: false, admin: true });
  assert.equal(mixedSelf.status, 422);
  const untouched = (
    await pool.query("SELECT is_blocked,is_admin FROM users WHERE id=$1", [
      adminId,
    ])
  ).rows[0];
  assert.equal(untouched.is_blocked, false, "422 не меняет блокировку");
  assert.equal(untouched.is_admin, false, "422 не меняет права");

  const demote = await admin
    .patch(`/api/admin/users/${userId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ admin: false });
  assert.equal(demote.status, 200);
  assert.equal(demote.body.admin, false);
  const after = await user.get("/api/auth/session").expect(200);
  assert.equal(after.body.isAdmin, false);
  assert.equal((await user.get("/api/admin/stats")).status, 403);
});

test("content: public defaults, admin edit, validation", async () => {
  const pub = await request(app).get("/api/content").expect(200);
  assert.match(pub.body.heroTitle, /48 часов/);
  assert.match(pub.body.commissionText, /1%/);

  const fields = await admin.get("/api/admin/content-fields").expect(200);
  assert.ok(
    fields.body.some(
      (field) => field.key === "heroTitle" && field.group && field.label,
    ),
  );
  const missing = await admin
    .put("/api/admin/content")
    .set("X-CSRF-Token", adminToken)
    .send({ heroTitle: "Только один ключ" });
  assert.equal(missing.status, 422, "полная замена требует все ключи");

  const before = { ...pub.body };
  const updated = await admin
    .put("/api/admin/content")
    .set("X-CSRF-Token", adminToken)
    .send({
      ...before,
      heroTitle: "Новый заголовок главной",
      heroText: "Новый подзаголовок главной страницы.",
      commissionTitle: "Новое название блока",
      commissionText: "Новый текст блока про комиссию сервиса.",
    })
    .expect(200);
  assert.equal(updated.body.heroTitle, "Новый заголовок главной");
  const again = await request(app).get("/api/content").expect(200);
  assert.equal(again.body.heroTitle, "Новый заголовок главной");

  const bad = await admin
    .put("/api/admin/content")
    .set("X-CSRF-Token", adminToken)
    .send({ ...before, heroTitle: "x".repeat(301) });
  assert.equal(bad.status, 422);

  const restored = await admin
    .put("/api/admin/content")
    .set("X-CSRF-Token", adminToken)
    .send(before);
  assert.equal(restored.status, 200);
});
