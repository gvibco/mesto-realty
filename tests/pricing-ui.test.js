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
let page;
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
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  // The static server has no API: session and listings fail and the home
  // page falls back to its error panel, but pricing and categories render.
  await page.goto(base() + "/");
  await page.locator(".pricing-card").first().waitFor();
});
after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test("category arrows sit at the same even position in every card", async () => {
  const positions = await page.$$eval(".category-link", (links) =>
    links.map((el) => {
      const cs = getComputedStyle(el, "::after");
      return { position: cs.position, right: cs.right, bottom: cs.bottom };
    }),
  );
  assert.equal(positions.length, 6);
  for (const pos of positions) assert.equal(pos.position, "absolute");
  for (const pos of positions) {
    assert.equal(pos.right, positions[0].right);
    assert.equal(pos.bottom, positions[0].bottom);
  }
});

test("no tariff is highlighted before selection", async () => {
  const borders = await page.$$eval(".pricing-card", (cards) =>
    cards.map((el) => getComputedStyle(el).borderColor),
  );
  assert.equal(new Set(borders).size, 1);
  assert.notEqual(borders[0], "rgb(35, 94, 232)");
});

test("tariffs show prices", async () => {
  const price = (tariff) =>
    page
      .locator(`.pricing-card[data-tariff="${tariff}"] .pricing-price`)
      .innerText();
  assert.match(await price("Базовый"), /Бесплатно/);
  assert.match(await price("Бизнес"), /1\s?990 ₽/);
  assert.match(await price("Премиум"), /5\s?900 ₽/);
});

test("selecting a new tariff deselects the previous one and centers it", async () => {
  await page.evaluate(() => {
    window.scrollCalls = [];
    Element.prototype.scrollIntoView = function (options) {
      window.scrollCalls.push({ tariff: this.dataset.tariff, options });
    };
  });
  const card = (tariff) =>
    page.locator(`.pricing-card[data-tariff="${tariff}"]`);
  const premium = card("Премиум");
  const basic = card("Базовый");
  const business = card("Бизнес");

  await premium.click({ position: { x: 10, y: 10 } });
  assert.equal(await premium.getAttribute("class"), "pricing-card selected");
  assert.equal(
    await premium.locator(".sub-request").getAttribute("class"),
    "button sub-request",
  );

  await basic.click({ position: { x: 10, y: 10 } });
  // The previously selected tariff is no longer highlighted.
  assert.equal(await premium.getAttribute("class"), "pricing-card");
  assert.ok(
    await premium
      .locator(".sub-request")
      .evaluate((el) => el.classList.contains("secondary")),
  );
  assert.equal(await basic.getAttribute("class"), "pricing-card selected");
  assert.equal(
    await basic.locator(".sub-request").getAttribute("class"),
    "button sub-request",
  );
  // The featured card keeps a neutral border while another card is selected.
  assert.notEqual(
    await business.evaluate((el) => getComputedStyle(el).borderColor),
    "rgb(35, 94, 232)",
  );
  // Every selection scrolls the chosen card to the vertical center.
  const scrollCalls = await page.evaluate(() => window.scrollCalls);
  assert.equal(scrollCalls.length, 2);
  assert.deepEqual(
    scrollCalls.map((c) => [c.tariff, c.options.block]),
    [
      ["Премиум", "center"],
      ["Базовый", "center"],
    ],
  );
  // Selection plays the pulse animation.
  assert.equal(
    await basic.evaluate((el) => getComputedStyle(el).animationName),
    "selectPulse",
  );
});
