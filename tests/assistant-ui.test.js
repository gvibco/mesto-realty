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
    if (pathname === "/api/auth/session")
      return json({ user: null, isAdmin: false, csrfToken: "a".repeat(64) });
    if (pathname === "/api/content") return json({});
    if (pathname === "/api/assistant")
      return json({ enabled: true, mode: "catalog" });
    if (pathname === "/api/properties")
      return json({ items: [], total: 0, page: 1, pages: 1 });
    if (pathname.startsWith("/api/"))
      return json({ error: "Маршрут API не найден" }, 404);
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

test("home shows AI call to action in the hero and hides the floating launcher", async () => {
  const page = await browser.newPage();
  await page.goto(base() + "/", { waitUntil: "networkidle" });
  await page.locator(".hero [data-assistant-open]").first().waitFor();
  assert.equal(
    await page.locator("#assistant .assistant-launch").isVisible(),
    false,
  );
  assert.ok(
    await page.locator(".search-hint [data-assistant-open]").isVisible(),
  );
  const ai = await page.locator(".hero-ai").boundingBox();
  const catalog = await page.locator(".hero-actions a").boundingBox();
  assert.equal(Math.round(ai.height), Math.round(catalog.height));
  assert.ok(
    Math.abs(ai.y + ai.height / 2 - (catalog.y + catalog.height / 2)) < 2,
    "кнопки hero выровнены по центру",
  );

  await page.locator(".hero [data-assistant-open]").first().click();
  await page.locator("#assistant-panel").waitFor();
  assert.ok(await page.locator("#assistant-panel").isVisible());
  assert.equal(
    await page
      .locator(".hero [data-assistant-open]")
      .first()
      .getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(
    await page
      .locator(".hero [data-assistant-open]")
      .first()
      .getAttribute("aria-controls"),
    "assistant-panel",
  );
  await page.close();
});

test("other pages keep the floating launcher", async () => {
  const page = await browser.newPage();
  await page.goto(base() + "/catalog", { waitUntil: "networkidle" });
  await page.locator("#assistant .assistant-launch").waitFor();
  assert.ok(await page.locator("#assistant .assistant-launch").isVisible());
  await page.close();
});
