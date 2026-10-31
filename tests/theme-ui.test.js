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
    let pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (pathname === "/") pathname = "/index.html";
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

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test("light by default, dark via cookie, toggle flips and persists", async () => {
  const page = await browser.newPage();
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(base() + "/");
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  const lightBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  await page
    .context()
    .addCookies([{ name: "theme", value: "dark", url: base() }]);
  await page.goto(base() + "/");
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  const darkBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  assert.ok(
    luminance(darkBg) < luminance(lightBg),
    "тёмный фон должен быть темнее светлого",
  );

  await page.click("#theme-toggle");
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  assert.match(await page.evaluate(() => document.cookie), /theme=light/);
  await page.close();
});

test("auto follows prefers-color-scheme when no cookie", async () => {
  const page = await browser.newPage();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(base() + "/");
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  await page.close();
});
