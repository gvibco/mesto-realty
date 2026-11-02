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

test("assistant sends on Enter, keeps Shift+Enter as a newline and explains the shortcut", async () => {
  const page = await browser.newPage();
  const requests = [];
  await page.route("**/api/assistant", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { enabled: true, mode: "catalog" } });
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { reply: "Готово", properties: [] } });
  });
  await page.goto(base() + "/", { waitUntil: "networkidle" });
  await page.locator(".hero [data-assistant-open]").first().click();
  const input = page.getByLabel("Ваш запрос", { exact: true });
  await input.fill("Первая строка");
  await input.press("Shift+Enter");
  await input.pressSequentially("Вторая строка");
  assert.equal(await input.inputValue(), "Первая строка\nВторая строка");
  assert.equal(requests.length, 0);
  await input.press("Enter");
  await page.locator(".assistant-log").getByText("Готово").waitFor();
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].messages.at(-1).content,
    "Первая строка\nВторая строка",
  );
  assert.equal(await input.inputValue(), "");
  const hintId = await input.getAttribute("aria-describedby");
  assert.ok(hintId, "поле ввода связано с подсказкой о клавишах");
  assert.match(await page.locator(`#${hintId}`).textContent(), /Enter/);
  await page.close();
});

test("assistant panel stays usable on a short landscape viewport", async () => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  await page.goto(base() + "/", { waitUntil: "networkidle" });
  await page.locator(".hero [data-assistant-open]").first().click();
  await page.setViewportSize({ width: 844, height: 390 });
  const panel = await page.locator("#assistant-panel").boundingBox();
  assert.ok(
    panel.y >= 0 && panel.y + panel.height <= 390,
    "панель помещается по высоте",
  );
  const header = await page.locator(".assistant-header").boundingBox();
  assert.ok(header.y >= 0 && header.y + header.height <= 390, "шапка видна");
  await page.getByLabel("Ваш запрос", { exact: true }).focus();
  const focusedHeader = await page.locator(".assistant-header").boundingBox();
  assert.ok(focusedHeader.y >= 0, "фокус не прокручивает шапку за экран");
  for (const selector of [
    "#assistant-input",
    ".assistant-form .button",
    ".assistant-catalog",
  ]) {
    const control = page.locator(selector);
    assert.ok(await control.isVisible(), `${selector} виден`);
    const box = await control.boundingBox();
    assert.ok(
      box.y >= 0 && box.y + box.height <= 390,
      `${selector} помещается по высоте`,
    );
  }
  await page.close();
});

test("other pages keep the floating launcher", async () => {
  const page = await browser.newPage();
  await page.goto(base() + "/catalog", { waitUntil: "networkidle" });
  await page.locator("#assistant .assistant-launch").waitFor();
  assert.ok(await page.locator("#assistant .assistant-launch").isVisible());
  await page.close();
});
