import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const publicDir = path.resolve(import.meta.dirname, "../public");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const adminUser = {
  id: 1,
  name: "Админ Админов",
  email: "admin@example.com",
  phone: null,
  bio: null,
  company: "Место Бизнес",
  businessRole: "owner",
  avatar: null,
};
const plainUser = { ...adminUser, id: 9, name: "Обычный Пользователь" };

let server;
let browser;
const base = () => `http://127.0.0.1:${server.address().port}`;

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let pathname = decodeURIComponent(url.pathname);
    const json = (value, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const cookie = req.headers.cookie || "";
    if (pathname === "/api/auth/session") {
      if (/stub=admin/.test(cookie))
        return json({
          user: adminUser,
          isAdmin: true,
          csrfToken: "a".repeat(64),
        });
      if (/stub=user/.test(cookie))
        return json({
          user: plainUser,
          isAdmin: false,
          csrfToken: "b".repeat(64),
        });
      return json({ user: null, isAdmin: false, csrfToken: "c".repeat(64) });
    }
    if (pathname === "/api/admin/stats")
      return json({
        users: 5,
        blockedUsers: 1,
        properties: 7,
        published: 4,
        drafts: 2,
        archived: 1,
        sale: 3,
        rent: 4,
      });
    if (pathname === "/api/admin/properties")
      return json({
        items: [
          {
            id: 5,
            title: "Склад 500 м²",
            deal: "sale",
            category: "warehouse",
            city: "Казань",
            price: "25000000",
            area: "500",
            status: "draft",
            createdAt: "2026-10-01T10:00:00.000Z",
            ownerName: "Иван Петров",
            ownerCompany: "ООО Склад",
            ownerEmail: "ivan@example.com",
          },
        ],
        total: 1,
        page: 1,
        pages: 1,
      });
    if (pathname === "/api/admin/users")
      return json({
        items: [
          {
            id: 9,
            name: "Обычный Пользователь",
            email: "user@example.com",
            company: "",
            businessRole: "owner",
            blocked: false,
            createdAt: "2026-09-01T10:00:00.000Z",
            propertyCount: 2,
          },
        ],
        total: 1,
        page: 1,
        pages: 1,
      });
    if (pathname === "/api/admin/content")
      return json({
        heroTitle: "Заголовок из админки",
        heroText: "Подзаголовок из админки",
        commissionTitle: "Как мы зарабатываем",
        commissionText:
          "Комиссия сервиса — 1% только с успешной продажи объекта.",
      });
    if (pathname.startsWith("/api/"))
      return json({ error: "Маршрут API не найден" }, 404);
    // SPA-фолбэк: пути без расширения отдаём как index.html.
    if (!path.extname(pathname)) pathname = "/index.html";
    try {
      const file = path.join(publicDir, pathname);
      if (!file.startsWith(publicDir)) throw new Error("traversal");
      const data = await readFile(file);
      res.writeHead(200, {
        "content-type": types[path.extname(file)] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

const withRole = async (stub) => {
  const page = await browser.newPage();
  if (stub)
    await page
      .context()
      .addCookies([{ name: "stub", value: stub, url: base() }]);
  return page;
};

test("anonymous visitor is redirected to /login", async () => {
  const page = await withRole(null);
  await page.goto(base() + "/admin");
  await page.waitForURL(/\/login/);
  assert.match(page.url(), /next=%2Fadmin/);
  await page.close();
});

test("non-admin is redirected to the home page", async () => {
  const page = await withRole("user");
  await page.goto(base() + "/admin");
  await page.waitForURL(base() + "/");
  await page.close();
});

test("admin sees dashboard, listings, users and content tabs", async () => {
  const page = await withRole("admin");
  await page.goto(base() + "/admin");
  await page.locator(".admin-stat b", { hasText: "7" }).first().waitFor();
  assert.equal(await page.locator(".admin-stat").count(), 8);

  await page.goto(base() + "/admin?tab=properties");
  await page.locator(".admin-item", { hasText: "Склад 500 м²" }).waitFor();
  assert.ok(await page.locator("text=Иван Петров").first().isVisible());
  assert.equal(await page.locator('.admin-item a[href="/edit/5"]').count(), 1);
  assert.ok(
    await page.locator('[data-status="published"]').first().isVisible(),
  );

  await page.goto(base() + "/admin?tab=users");
  await page
    .locator(".admin-item", { hasText: "Обычный Пользователь" })
    .waitFor();
  assert.ok(await page.locator("[data-block]").first().isVisible());

  await page.goto(base() + "/admin?tab=content");
  const input = page.locator('input[name="heroTitle"]');
  await input.waitFor();
  assert.equal(await input.inputValue(), "Заголовок из админки");
  await page.close();
});
