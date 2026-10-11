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
  ".woff2": "font/woff2",
};
const TEST_PAGE = `<!doctype html>
<html lang="ru">
  <head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
  <body>
    <div class="section-heading">
      <div><h1>Кабинет компании</h1><p>Ваши объявления</p></div>
      <a class="button" href="/publish">+ Новое объявление</a>
    </div>
    <script type="module" src="/js/core.js"></script>
  </body>
</html>`;

let server;
let browser;
let base;
before(async () => {
  server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (pathname === "/test-page") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(TEST_PAGE);
      return;
    }
    try {
      const file = path.join(publicDir, pathname);
      if (!file.startsWith(publicDir)) throw new Error("traversal");
      const data = await readFile(file);
      res.writeHead(200, {
        "content-type": types[path.extname(file)] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test("button inside .section-heading keeps white label on blue background", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base + "/test-page");
    const styles = await page
      .locator(".section-heading > a.button")
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, background: cs.backgroundColor };
      });
    assert.equal(styles.background, "rgb(35, 94, 232)");
    assert.equal(styles.color, "rgb(255, 255, 255)");
  } finally {
    await page.close();
  }
});

test("pageshow restores visibility and cancels pending navigation", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base + "/test-page");
    const started = page.url();
    const bodyClass = await page.evaluate(async () => {
      const { navigate } = await import("/js/core.js");
      navigate("/other-page");
      // Browser restores the page from the back-forward cache.
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
      return document.body.className;
    });
    assert.equal(bodyClass, "");
    await page.waitForTimeout(400); // navigation timer (130 ms) must be cancelled
    assert.equal(page.url(), started);
  } finally {
    await page.close();
  }
});
