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

const baseProperty = {
  id: 1,
  ownerId: 2,
  title: "Офис 120 м² в деловом центре",
  deal: "sale",
  category: "office",
  city: "Москва",
  district: "ЦАО",
  address: "ул. Тверская, 1",
  price: "12345678",
  area: "120",
  buildingClass: "B+",
  floor: "3",
  ceilingHeight: "3",
  powerKw: "15",
  parking: true,
  tax: "unspecified",
  description: "Светлый офис для команды.",
  contactName: "Тест Тестов",
  status: "published",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  cover: null,
  imageCount: 0,
  isFavorite: false,
};
const sale = baseProperty;
const rent = { ...baseProperty, id: 2, deal: "rent", price: "150000" };
const owner = {
  id: 2,
  name: "Тест Тестов",
  company: "ООО Тест",
  businessRole: "owner",
  avatar: null,
  bio: null,
};

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
    if (pathname === "/api/properties/1")
      return json({ property: sale, owner, images: [], others: [] });
    if (pathname === "/api/properties/2")
      return json({ property: rent, owner, images: [], others: [] });
    if (pathname === "/api/content") {
      // Задача 6: при cookie stub-content=1 отдаём «отредактированные» тексты.
      if (/stub-content=1/.test(req.headers.cookie || ""))
        return json({
          heroTitle: "ЗАГОЛОВОК ИЗ АДМИНКИ",
          heroText: "Подзаголовок из админки",
          commissionTitle: "Комиссия из админки",
          commissionText: "Текст комиссии из админки",
        });
      return json({ error: "Маршрут API не найден" }, 404);
    }
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

test("home shows the commission block and no pricing remnants", async () => {
  const page = await browser.newPage();
  await page.goto(base() + "/", { waitUntil: "domcontentloaded" });
  const section = page.locator(".commission-section");
  await section.waitFor();
  assert.match(
    await section.locator("#commission-title").textContent(),
    /Как мы зарабатываем/,
  );
  assert.match(
    await section.locator("#commission-text").textContent(),
    /1%\s*только с успешной продажи/,
  );
  assert.equal(await page.locator(".pricing-card").count(), 0);
  assert.equal(await page.locator(".sub-request").count(), 0);
  assert.ok(!(await page.content()).includes("Тарифы"));
  await page.close();
});

test("sale property shows the 1% commission note", async () => {
  const page = await browser.newPage();
  await page.goto(base() + "/property/1", { waitUntil: "networkidle" });
  const note = page.locator(".commission-note");
  await note.waitFor();
  const text = (await note.textContent()).replace(/[\u00a0\u202f]/g, " ");
  assert.match(text, /Комиссия сервиса: 1% — 123\s?457\s?₽/);
  await page.close();
});

test("rent property has no commission note", async () => {
  const page = await browser.newPage();
  await page.goto(base() + "/property/2", { waitUntil: "networkidle" });
  await page.locator(".contact-panel").waitFor();
  assert.equal(await page.locator(".commission-note").count(), 0);
  await page.close();
});
