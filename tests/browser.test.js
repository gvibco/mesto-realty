import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Set TEST_DATABASE_URL to a separate _test database");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_ORIGIN = "http://localhost:3101";
process.env.UPLOAD_DIR = await mkdtemp(
  path.join(os.tmpdir(), "mesto-browser-"),
);
const { createApp } = await import("../server/app.js");
const { migrate } = await import("../server/migrate.js");
const { pool } = await import("../server/db.js");
await migrate();
const instance = createApp();
const server = instance.app.listen(3101);
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(10000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const email = `e2e-${Date.now()}@example.com`;
const password = "Browser-scenario-123!";
const base = process.env.APP_ORIGIN;
await mkdir("output/playwright", { recursive: true });
after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await pool.query("DELETE FROM users WHERE email=$1", [email]);
  instance.close();
  await pool.end();
  const cleanupDir = path.resolve(process.env.UPLOAD_DIR);
  if (
    path.dirname(cleanupDir) !== path.resolve(os.tmpdir()) ||
    !path.basename(cleanupDir).startsWith("mesto-browser-")
  )
    throw new Error("Unsafe cleanup");
  await rm(cleanupDir, { recursive: true, force: true });
});
async function fillProperty(title = "Офис для проверки браузера") {
  await page.getByLabel("Заголовок объявления").fill(title);
  await page.getByLabel("Цена, ₽", { exact: true }).fill("13500000");
  await page.getByLabel("Площадь, м²", { exact: true }).fill("63.5");
  await page.getByLabel("Класс здания", { exact: true }).selectOption("A");
  await page.getByLabel("Этаж", { exact: true }).fill("8");
  await page.getByLabel("Высота потолков, м", { exact: true }).fill("3.8");
  await page.getByLabel("Мощность, кВт", { exact: true }).fill("50");
  await page.getByLabel("Парковка", { exact: true }).selectOption("true");
  await page.getByLabel("НДС", { exact: true }).selectOption("included");
  await page.getByLabel("Город", { exact: true }).fill("Москва");
  await page.getByLabel("Район", { exact: true }).fill("Браузерный район");
  await page.getByLabel("Адрес", { exact: true }).fill("Тестовая улица, 24");
  await page
    .getByLabel("Описание", { exact: true })
    .fill(
      "Офис для сквозной проверки деловой площадки. <img src=x onerror=alert(1)>",
    );
  await page.getByLabel("Телефон", { exact: true }).fill("+79991112233");
  await page
    .getByLabel("Контактное лицо", { exact: true })
    .fill("Отдел аренды");
}
test("browser: account, listing lifecycle, responsiveness and recovery", async (t) => {
  let propertyUrl;
  await t.test(
    "assistant safely renders results, retries failure and works on mobile",
    async () => {
      let attempts = 0;
      await page.route("**/api/assistant", async (route) => {
        if (route.request().method() === "GET")
          return route.fulfill({ json: { enabled: true } });
        if (++attempts === 1)
          return route.fulfill({
            status: 503,
            json: { error: "Повторите запрос" },
          });
        const body = route.request().postDataJSON();
        assert.equal(body.messages.at(-1).content, "Офис в Москве");
        return route.fulfill({
          json: {
            reply: "Вариант <img src=x onerror=alert(1)>",
            properties: [
              {
                id: 7,
                title: "Офис <script>alert(1)</script>",
                city: "Москва",
                area: 100,
                price: 150000,
                deal: "rent",
                category: "office",
                url: "javascript:alert(1)",
              },
            ],
          },
        });
      });
      await page.goto(base + "/");
      const launch = page.locator(".hero [data-assistant-open]").first();
      await launch.click();
      const dialog = page.getByRole("dialog", { name: "Помощник по подбору" });
      await page
        .getByLabel("Ваш запрос", { exact: true })
        .fill("Офис в Москве");
      await dialog
        .getByRole("button", { name: "Отправить", exact: true })
        .click();
      await page
        .locator(".assistant-error")
        .filter({ hasText: "Повторите запрос" })
        .waitFor();
      assert.equal(
        await page.getByLabel("Ваш запрос", { exact: true }).inputValue(),
        "Офис в Москве",
      );
      await dialog
        .getByRole("button", { name: "Отправить", exact: true })
        .click();
      await page.locator(".assistant-property").waitFor();
      assert.equal(
        await page.locator(".assistant-property").getAttribute("href"),
        "/property/7",
      );
      assert.equal(
        await page.locator(".assistant-log img,.assistant-log script").count(),
        0,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      const box = await dialog.boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.x + box.width <= 390 &&
          box.y >= 0 &&
          box.y + box.height <= 844,
      );
      await page.screenshot({ path: "output/playwright/assistant-mobile.png" });
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), false);
      assert.equal(
        await launch.evaluate((el) => el === document.activeElement),
        true,
      );
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.unroute("**/api/assistant");
      await page.reload();
      await launch.click();
      await page
        .locator(".assistant-notice")
        .filter({ hasText: "Подбор по каталогу" })
        .waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Отправить", exact: true })
          .isDisabled(),
        false,
      );
      await page
        .getByLabel("Ваш запрос", { exact: true })
        .fill("Склад до 300 м²");
      await dialog
        .getByRole("button", { name: "Отправить", exact: true })
        .click();
      await page
        .locator(".assistant-log")
        .getByText(/В каком городе/)
        .waitFor();
      await page.keyboard.press("Escape");
    },
  );
  await t.test(
    "page navigation animates content and respects reduced motion",
    async () => {
      await page.goto(base + "/");
      await page.locator(".hero").waitFor();
      const enterDuration = await page
        .locator("#main > *")
        .evaluate((element) => getComputedStyle(element).animationDuration);
      assert.notEqual(enterDuration, "0s");
      const leaving = await page.evaluate(() => {
        document.querySelector('.main-nav a[href="/catalog"]').click();
        return {
          active: document.body.classList.contains("is-leaving"),
          duration: getComputedStyle(document.body).animationDuration,
        };
      });
      assert.deepEqual(leaving, { active: true, duration: "0.13s" });
      await page.waitForURL("**/catalog");
      await page.locator(".catalog-layout").waitFor();
      assert.equal(await page.locator(".page-intro h1").count(), 1);

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(base + "/login");
      await page.locator("#auth-form").waitFor();
      assert.equal(
        await page
          .locator("#main > *")
          .evaluate((element) => getComputedStyle(element).animationDuration),
        "0s",
      );
      const reducedMotionExit = await page.evaluate(() => {
        document.querySelector('a[href="/register"]').click();
        return document.body.classList.contains("is-leaving");
      });
      assert.equal(reducedMotionExit, false);
      await page.waitForURL("**/register");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    },
  );
  await t.test("registration then logout and login", async () => {
    await page.goto(base + "/register");
    await page.getByLabel("Ваше имя").fill("Браузерный владелец");
    await page
      .getByLabel("Компания", { exact: true })
      .fill("Тестовая компания");
    await page.getByLabel("Ваша роль", { exact: true }).selectOption("broker");
    await page.getByLabel("Электронная почта").fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByLabel("Повторите пароль").fill(password);
    await page
      .getByRole("button", { name: "Создать аккаунт", exact: true })
      .click();
    await page.waitForURL("**/account");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL(base + "/");
    await page.getByRole("link", { name: "Войти", exact: true }).click();
    await page.getByLabel("Электронная почта").fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL("**/account");
  });
  await t.test(
    "two photos, publish, gallery, phone and safe text",
    async () => {
      await page
        .getByRole("link", { name: "+ Новое объявление", exact: true })
        .click();
      await fillProperty();
      await page
        .getByLabel("Добавьте до 200 фотографий")
        .setInputFiles([
          "public/assets/property-1.webp",
          "public/assets/property-2.webp",
        ]);
      assert.equal(await page.locator(".photo-preview").count(), 2);
      await page
        .getByRole("button", { name: "Опубликовать", exact: true })
        .click();
      await page.waitForURL("**/property/*");
      propertyUrl = page.url();
      await page.locator(".gallery-main").waitFor();
      assert.match(
        await page.locator(".owner").innerText(),
        /Тестовая компания/,
      );
      assert.match(await page.locator(".owner").innerText(), /Брокер/);
      assert.equal(await page.locator(".description img").count(), 0);
      assert.match(
        await page.locator(".description").innerText(),
        /<img src=x/,
      );
      const before = await page.locator(".gallery-main").getAttribute("src");
      await page.getByRole("button", { name: "Фото 2", exact: true }).click();
      assert.notEqual(
        await page.locator(".gallery-main").getAttribute("src"),
        before,
      );
      await page
        .getByRole("button", { name: "Показать телефон", exact: true })
        .click();
      await page.locator('a[href="tel:+79991112233"]').waitFor();
    },
  );
  await t.test("URL search and persisted favorites", async () => {
    await page.goto(
      base +
        "/catalog?category=office&buildingClass=A&minCeilingHeight=3.5&minPowerKw=40&parking=true&q=" +
        encodeURIComponent("Браузерный район"),
    );
    await page.locator("#result-count").filter({ hasText: "1" }).waitFor();
    assert.equal(await page.locator('[name="rooms"]').count(), 0);
    assert.equal(
      await page.locator('[name="buildingClass"]').inputValue(),
      "A",
    );
    assert.equal(
      await page.locator('[name="minCeilingHeight"]').inputValue(),
      "3.5",
    );
    assert.equal(await page.locator('[name="minPowerKw"]').inputValue(), "40");
    assert.equal(await page.locator('[name="parking"]').inputValue(), "true");
    await page.locator('[name="minArea"]').fill("63.5");
    await page.locator('[name="maxArea"]').fill("63.5");
    await page
      .getByRole("button", { name: "Показать объявления", exact: true })
      .click();
    await page.waitForURL((url) => url.searchParams.get("minArea") === "63.5");
    await page.locator("#result-count").filter({ hasText: "1" }).waitFor();
    await page
      .getByRole("button", { name: "Добавить в избранное", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Убрать из избранного", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("button", { name: "Убрать из избранного", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Город, район или адрес").inputValue(),
      "Браузерный район",
    );
    await page.goto(base + "/account?tab=favorites");
    await page
      .locator(".card-title")
      .filter({ hasText: "Офис для проверки браузера" })
      .waitFor();
    assert.equal(await page.locator(".property-card").count(), 1);
  });
  await t.test("edit price and photos, archive and republish", async () => {
    await page.goto(propertyUrl);
    await page
      .getByRole("link", { name: "Редактировать", exact: true })
      .click();
    await page.getByLabel("Заголовок объявления").fill("Обновлённый офис");
    await page.getByLabel("Цена, ₽", { exact: true }).fill("12900000");
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Удалить фото", exact: true })
      .last()
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-remove-image]").length === 1,
    );
    await page
      .getByRole("button", { name: "Сохранить и опубликовать", exact: true })
      .click();
    await page.waitForURL(propertyUrl);
    await page
      .getByRole("heading", { name: "Обновлённый офис", exact: true })
      .waitFor();
    assert.match(
      await page.locator(".detail-price").innerText(),
      /12\s900\s000/,
    );
    await page.goto(base + "/account");
    await page.getByRole("button", { name: "В архив", exact: true }).click();
    await page.locator(".status").filter({ hasText: "В архиве" }).waitFor();
    await page.locator(".manage a").filter({ hasText: "Изменить" }).click();
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await page.waitForURL(propertyUrl);
  });
  await t.test("profile and avatar persist", async () => {
    await page.goto(base + "/account?tab=profile");
    await page.getByLabel("Имя", { exact: true }).fill("Анна Браузерная");
    await page.getByLabel("Компания", { exact: true }).fill("Новая компания");
    await page.getByLabel("Ваша роль", { exact: true }).selectOption("owner");
    await page.getByLabel("Телефон", { exact: true }).fill("+79998887766");
    await page
      .getByLabel("О компании и вашей работе", { exact: true })
      .fill("Описание компании из браузера.");
    await page
      .getByRole("button", { name: "Сохранить изменения", exact: true })
      .click();
    await page
      .locator("#toast")
      .filter({ hasText: "Изменения сохранены" })
      .waitFor();
    await page
      .getByLabel("Фото профиля", { exact: true })
      .setInputFiles("public/assets/property-3.webp");
    await page
      .getByRole("button", { name: "Загрузить фото", exact: true })
      .click();
    await page.locator("#avatar-form img").waitFor();
    await page.reload();
    await page.getByLabel("Имя", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("Имя", { exact: true }).inputValue(),
      "Анна Браузерная",
    );
    assert.equal(
      await page.getByLabel("Компания", { exact: true }).inputValue(),
      "Новая компания",
    );
    assert.equal(
      await page.getByLabel("Ваша роль", { exact: true }).inputValue(),
      "owner",
    );
    await page.getByLabel("Компания", { exact: true }).fill("");
    await page
      .getByRole("button", { name: "Сохранить изменения", exact: true })
      .click();
    await page
      .locator("#toast")
      .filter({ hasText: "Изменения сохранены" })
      .waitFor();
    await page.goto(propertyUrl);
    await page.locator(".owner").waitFor();
    assert.match(await page.locator(".owner").innerText(), /Отдел аренды/);
  });
  await t.test(
    "commercial categories, legacy URLs and land-specific fields",
    async () => {
      const expected = [
        "office",
        "retail",
        "warehouse",
        "industrial",
        "free_purpose",
        "commercial_land",
      ];
      await page.goto(base + "/catalog?category=apartment&rooms=2");
      await page.locator("#result-count").waitFor();
      assert.equal(new URL(page.url()).searchParams.has("rooms"), false);
      assert.equal(new URL(page.url()).searchParams.has("category"), false);
      assert.deepEqual(
        await page
          .locator('[name="category"] option')
          .evaluateAll((options) =>
            options.map((o) => o.value).filter(Boolean),
          ),
        expected,
      );
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /квартир|комнат|студии|жил[а-яё]* недвижим/iu,
      );
      await page.goto(base + "/publish");
      await page.locator("#editor").waitFor();
      await fillProperty("Участок для коммерческого проекта");
      await page.locator('[name="ceilingHeight"]').fill("51");
      assert.deepEqual(
        await page
          .locator('[name="category"] option')
          .evaluateAll((options) => options.map((o) => o.value)),
        expected,
      );
      await page.locator('[name="category"]').selectOption("commercial_land");
      for (const name of ["buildingClass", "floor", "ceilingHeight"])
        assert.equal(await page.locator(`[name="${name}"]`).isVisible(), false);
      assert.equal(await page.locator('[name="powerKw"]').isVisible(), true);
      assert.equal(await page.locator('[name="rooms"]').count(), 0);
      await page
        .getByRole("button", { name: "Сохранить черновик", exact: true })
        .click();
      await page.waitForURL("**/account");
      await page
        .locator(".card-title")
        .filter({ hasText: "Участок для коммерческого проекта" })
        .click();
      await page.waitForURL("**/property/*");
      const land = await page.evaluate(async () => {
        const id = location.pathname.split("/").pop();
        return (await (await fetch("/api/properties/" + id)).json()).property;
      });
      assert.equal(land.category, "commercial_land");
      assert.equal(land.buildingClass, "");
      assert.equal(land.floor, null);
      assert.equal(land.ceilingHeight, null);
      assert.equal(Number(land.powerKw), 50);
    },
  );
  await t.test(
    "mobile, tablet and desktop layouts do not overflow",
    async () => {
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of [
          "/",
          "/catalog",
          new URL(propertyUrl).pathname,
          "/account?tab=profile",
          "/publish",
        ]) {
          await page.goto(base + route);
          await page.locator("#header a").first().waitFor();
          await page.waitForFunction(
            () => !document.querySelector("#main .loading"),
          );
          const excess = await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          );
          assert.ok(
            excess <= 1,
            `${route} overflows ${excess}px at ${width}px`,
          );
        }
        await page.screenshot({
          path: `output/playwright/editor-${width}.png`,
          fullPage: true,
        });
      }
    },
  );
  await t.test(
    "uncertain committed create prevents duplicate retry",
    async () => {
      await page.goto(base + "/publish");
      await fillProperty("Черновик с потерянным ответом");
      await page.route("**/api/properties", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fetch(); // Server commits; browser deliberately loses the response.
        await route.abort("failed");
      });
      await page
        .getByRole("button", { name: "Сохранить черновик", exact: true })
        .click();
      await page
        .locator("#editor > .form-error")
        .filter({ hasText: "Возможно, черновик уже сохранён" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Сохранить черновик", exact: true })
          .isDisabled(),
        true,
      );
      await page.unroute("**/api/properties");
      await page.getByRole("link", { name: "В кабинет", exact: true }).click();
      await page
        .locator(".card-title")
        .filter({ hasText: "Черновик с потерянным ответом" })
        .waitFor();
      assert.equal(
        await page
          .locator(".card-title")
          .filter({ hasText: "Черновик с потерянным ответом" })
          .count(),
        1,
      );
    },
  );
  await t.test("failed logout can be retried", async () => {
    await page.route("**/api/auth/logout", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page
      .locator("#toast")
      .filter({ hasText: "Не удалось связаться" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Выйти", exact: true })
        .isEnabled(),
      true,
    );
    await page.unroute("**/api/auth/logout");
  });
  await t.test("delete own objects and favorites disappear", async () => {
    await page.goto(base + "/account");
    await page.locator(".manage").first().waitFor();
    while (await page.locator("[data-delete]").count()) {
      page.once("dialog", (d) => d.accept());
      const button = page.locator("[data-delete]").first();
      const id = await button.getAttribute("data-delete");
      await button.click();
      await page
        .locator(`[data-delete="${id}"]`)
        .waitFor({ state: "detached" });
      await page.waitForFunction(() => {
        const content = document.querySelector("#account-content");
        return content && !content.querySelector(".loading");
      });
    }
    await page
      .getByRole("heading", {
        name: "Разместите первый объект",
        exact: true,
      })
      .waitFor();
    await page.goto(base + "/account?tab=favorites");
    await page
      .getByRole("heading", {
        name: "Соберите подходящие объекты",
        exact: true,
      })
      .waitFor();
    assert.deepEqual(pageErrors, []);
  });
});
