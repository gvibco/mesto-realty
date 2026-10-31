# План: комиссия 1%, админ-панель, тёмная тема, главная по 4U

**Спецификация:** `docs/superpowers/specs/2026-10-31-commission-admin-dark-4u-design.md`
**Цель:** заменить блок «Тарифы»/подписки на messaging комиссии 1% (+расчёт на
карточке продажи), добавить админ-панель `/admin` (объявления, пользователи,
дашборд, тексты главной), тёмную тему с переключателем и cookie, переписать
hero и `<title>` по формуле 4U. В конце — полный прогон проверок, push на
GitHub и деплой в Dockhost.

## Как выполнять этот план

- Windows PowerShell: используйте `npm.cmd`, `npx.cmd`, `node` (не `npm`).
- TDD: сначала тест → прогон (падает) → реализация → прогон (зелёный) →
  `npx.cmd prettier --write <файлы>` → коммит. Коммит после каждой задачи.
- Перед API-тестами: `docker compose up -d db`, затем
  `npm.cmd run db:migrate` и тестовая миграция запускается сама
  (`TEST_DATABASE_URL` из `.env`, база должна заканчиваться на `_test`).
- Форматирование обязательное: `npm.cmd run format:check` должен проходить.
- Не трогать: `whoosh_case.txt`, `.local/`, ветки кроме `main`.
- Таблица `subscription_requests` в БД СОХРАНЯЕТСЯ (решение пользователя) —
  удаляется только код подписок.

## Карта файлов

| Файл | Действие |
|---|---|
| `public/js/theme.js` | создать: cookie-тема, `data-theme`, переключатель |
| `public/index.html` | title/description, скрипт темы, кнопка `#theme-toggle` |
| `public/styles.css` | токены палитры + тёмная тема, стили commission/admin, удалить pricing/modal |
| `public/js/app.js` | убрать sub-модалку, hero 4U, секция комиссии, commission-note, роут `/admin`, контент из API, ссылка админа в шапке |
| `public/js/forms.js` | `editorPage`: обход проверки владельца для админа |
| `public/js/admin.js` | создать: страницы админ-панели |
| `server/config.js` | `adminEmail` |
| `server/security.js` | `isAdminUser`, `requireAdmin` |
| `server/auth.js` | `is_blocked` в выборке, 403 при входе, `isAdmin` в ответах, смерть сессии заблокированного |
| `server/properties.js` | `owned(client, id, userId, admin)`, видимость черновиков админу |
| `server/uploads.js` | `checkOwner`, tx-проверки, `serveMedia` — обход для админа |
| `server/architectural-models.js` | `own`/`visible`, pre-check плана, `serveArchitecturalModel`, `servePropertyPlan` — обход для админа |
| `server/room-models.js` | `GET /properties/:id/model`, `serveRoomModel` — обход для админа |
| `server/admin.js` | создать: `adminRouter()` (requireAdmin) + `contentRouter()` (публичный) |
| `server/app.js` | убрать subscriptions, подключить admin/content, `admin` в SPA-regex |
| `server/subscriptions.js` | УДАЛИТЬ файл |
| `migrations/006_admin_content.sql` | создать: `is_blocked`, `site_settings`, seed текстов |
| `tests/theme-ui.test.js` | создать |
| `tests/commission-ui.test.js` | создать (заменяет `tests/pricing-ui.test.js` — удалить) |
| `tests/admin-ui.test.js` | создать |
| `tests/admin-api.test.js` | создать |
| `package.json` | обновить скрипты `test` и `test:api` |
| `.env.example`, `README.md` | `ADMIN_EMAIL`, документация |

---

## Задача 1. Тёмная тема: theme.js, кнопка, токены CSS

**Файлы:** `public/js/theme.js` (новый), `public/index.html`,
`public/styles.css`, `tests/theme-ui.test.js` (новый), `package.json`.

### Шаг 1.1 — Тест (падает)

Создать `tests/theme-ui.test.js`. Статический сервер отдаёт `public/` без API
(theme.js не зависит от API; ошибка сетевых вызовов страницы мешать не должна):

```js
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
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.context().addCookies([{ name: "theme", value: "dark", url: base() }]);
  await page.goto(base() + "/");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.ok(luminance(darkBg) < luminance(lightBg), "тёмный фон должен быть темнее светлого");

  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  assert.match(await page.evaluate(() => document.cookie), /theme=light/);
  await page.close();
});

test("auto follows prefers-color-scheme when no cookie", async () => {
  const page = await browser.newPage();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(base() + "/");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.close();
});
```

Добавить файл в скрипт `test` в `package.json`: вставить
`tests/theme-ui.test.js` в список файлов (остальные пока не трогать;
`tests/pricing-ui.test.js` удаляется из списка в задаче 2, новые тесты
добавляются в задачах 2 и 6 — список должен оставаться зелёным после каждой
задачи).

Прогон: `node --test tests/theme-ui.test.js` — падает (нет theme.js).

### Шаг 1.2 — `public/js/theme.js`

Classic-скрипт (CSP запрещает inline). Создать файл:

```js
// Тёмная тема. Cookie `theme` = dark|light|auto (по умолчанию auto —
// системная prefers-color-scheme). Скрипт выполняется в <head> до отрисовки,
// чтобы тема применялась без мигания. LocalStorage в проекте запрещён.
(function () {
  function readCookie() {
    const match = document.cookie.match(/(?:^|;\s*)theme=(dark|light|auto)/);
    return match ? match[1] : "auto";
  }
  function resolve(value) {
    if (value === "dark" || value === "light") return value;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function apply() {
    const dark = resolve(saved) === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#16212f" : "#235ee8";
  }
  var saved = readCookie();
  apply();
  window.setTheme = function (value) {
    saved = value;
    document.cookie = "theme=" + value + ";path=/;max-age=31536000;SameSite=Lax";
    apply();
  };
  document.addEventListener("DOMContentLoaded", function () {
    var button = document.querySelector("#theme-toggle");
    if (!button) return;
    function sync() {
      var dark = document.documentElement.dataset.theme === "dark";
      button.textContent = dark ? "☀️" : "🌙";
      button.setAttribute(
        "aria-label",
        dark ? "Включить светлую тему" : "Включить тёмную тему",
      );
    }
    sync();
    button.addEventListener("click", function () {
      window.setTheme(
        document.documentElement.dataset.theme === "dark" ? "light" : "dark",
      );
      sync();
    });
  });
})();
```

### Шаг 1.3 — `public/index.html`

1. В `<head>` перед `<link rel="stylesheet" href="/styles.css" />` добавить:
   `<script src="/js/theme.js"></script>` (без defer — до отрисовки).
2. В `.header-actions` между ссылкой «Избранное» и `[data-auth-link]` вставить:

```html
<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Включить тёмную тему">🌙</button>
```

(т.е. после `>♡ &nbsp;Избранное</a`>` и перед `<a href="/login" data-auth-link>`).

### Шаг 1.4 — Токены палитры в `public/styles.css`

Заменить блок `:root` (строки 14–22) на:

```css
:root {
  color-scheme: light dark;
  --ink: #172b43;
  --ink-soft: #455b75;
  --muted: #596b80;
  --placeholder: #65768a;
  --blue: #235ee8;
  --blue-hover: #174cce;
  --line: #dbe3ed;
  --line-strong: #9eafc5;
  --paper: #f3f5f8;
  --soft: #eaf0ff;
  --radius: 8px;
  --surface: #ffffff;
  --on-accent: #ffffff;
  --img-bg: #e9eef5;
  --banner-bg: #f8faff;
  --blue-border: #b6caf8;
  --blue-light: #e7eefb;
  --danger: #a72f24;
  --danger-bg: #fffafa;
  --danger-border: #e8c4c7;
  --ok-bg: #e4f5e9;
  --ok-fg: #1d6b3a;
  --empty-mark: #c5cfdd;
  --heart-border: #b9c9df;
  --veil: #172b4309;
  --ring: #235ee826;
  --shadow-1: 0 6px 24px #172b4326;
  --shadow-2: 0 16px 60px #172b4326;
}
html[data-theme="dark"] {
  --ink: #e8eef7;
  --ink-soft: #c9d5e4;
  --muted: #9db0c7;
  --placeholder: #7b8ca1;
  --blue: #5b8af5;
  --blue-hover: #7aa2ff;
  --line: #2c3a4e;
  --line-strong: #46586f;
  --paper: #0e1621;
  --soft: #1b2a41;
  --surface: #16212f;
  --on-accent: #ffffff;
  --img-bg: #1d2937;
  --banner-bg: #16212f;
  --blue-border: #2f4a7d;
  --blue-light: #1b2a41;
  --danger: #f0897d;
  --danger-bg: #3a201d;
  --danger-border: #6e3a33;
  --ok-bg: #1c3324;
  --ok-fg: #8fd6a5;
  --empty-mark: #33414f;
  --heart-border: #46586f;
  --veil: #ffffff0f;
  --ring: #5b8af540;
  --shadow-1: 0 6px 24px #00000066;
  --shadow-2: 0 16px 60px #00000080;
}
```

### Шаг 1.5 — Замена жёстких литералов токенами

Инвентарь (уникальные значения и количества на момент написания плана):
`white`×26, `#fff`×8, `#172b4326`×2, `#172b4325`, `#172b4330`, `#a72f24`,
`#a42b31`×3, `#174cce`, `#9eafc5`, `#f8faff`, `#b6caf8`, `#9fb6e4`×2,
`#d7e2f6`, `#e7eefb`, `#e9eef5`, `#e5ebf3`, `#e3eaf3`, `#e8f0f7`, `#c5cfdd`,
`#b9c9df`, `#65768a`, `#657a98`, `#455b75`, `#e8c4c7`, `#fffafa`, `#172b4308`,
`#172b4309`×2, `#235ee826`, `#ffffff66`.

Правила замены (по всему `public/styles.css`, КРОМЕ блоков `:root` и
`html[data-theme="dark"]`):

| Литерал | Токен |
|---|---|
| `white`/`#fff` как фон (background) | `var(--surface)` |
| `white`/`#fff` как цвет текста/иконки на синем | `var(--on-accent)` |
| `#172b4326`, `#172b4325`, `#172b4330` в `box-shadow` | `var(--shadow-1)` (малые) / `var(--shadow-2)` (0 16px 60px) — заменить целое значение shadow |
| `#a72f24`, `#a42b31` | `var(--danger)` |
| `#fffafa` | `var(--danger-bg)` |
| `#e8c4c7` | `var(--danger-border)` |
| `#174cce` (hover синего) | `var(--blue-hover)` |
| `#9eafc5` | `var(--line-strong)` |
| `#f8faff` | `var(--banner-bg)` |
| `#b6caf8`, `#9fb6e4`, `#d7e2f6` (голубые рамки) | `var(--blue-border)` |
| `#e7eefb`, `#e9eef5`, `#e5ebf3`, `#e3eaf3`, `#e8f0f7` (светлые фоны/полосы) | `var(--blue-light)` для голубоватых, `var(--img-bg)` для фонов картинок/плейсхолдеров |
| `#c5cfdd` | `var(--empty-mark)` |
| `#b9c9df` | `var(--heart-border)` |
| `#65768a`, `#657a98` | `var(--placeholder)` |
| `#455b75` | `var(--ink-soft)` |
| `#172b4308`, `#172b4309` (полупрозрачные hover/разделители) | `var(--veil)` |
| `#235ee826` | `var(--ring)` |

НЕ трогать (связано с 3D-сценой, тёмная по замыслу): `#242b29` (`.room-canvas`),
`#eceee9`, `deded7`×2, `#f5f5f0`, `#ffffff66` (полупрозрачный белый на тёмном
hero — работает в обеих темах). Также проверить единственное вхождение
`rgba(`/`rgb(` — оставить или токенизировать по смыслу.

После замен: `Select-String -Path public\styles.css -Pattern '#[0-9a-fA-F]{3,8}'` —
все оставшиеся hex должны находиться только в `:root`, `html[data-theme="dark"]`
и в перечисленных выше исключениях.

### Шаг 1.6 — Точечные правила для тёмной темы

Добавить в конец `styles.css` (перед медиа-запросами или после — не важно):

```css
.theme-toggle {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
```

Проверить визуально (шаг 1.8), что в тёмной теме читаемы: hero (тёмный фон с
картинкой — текст белый, должен остаться белым: если hero-текст использует
`var(--ink)`, добавить правило `.hero, .hero h1, .hero p { color: #fff; }` в
тёмной И светлой — hero и так тёмный), футер, модалки, тосты, ассистент,
галерея, кабинет, фильтры, карточки. Если hero сейчас задаёт белый текст
литералом `white` — при замене на `var(--on-accent)` он останется белым в обеих
темах (on-accent = #fff всегда) — это корректно.

### Шаг 1.7 — Прогон

`node --test tests/theme-ui.test.js` — зелёный.
`npx.cmd prettier --write public/js/theme.js public/index.html public/styles.css tests/theme-ui.test.js package.json`
`npm.cmd test` — все UI-тесты зелёные (регрессий нет).

### Шаг 1.8 — Ручная визуальная проверка

`docker compose up -d db; npm.cmd run db:migrate; npm.cmd run dev` (фон),
открыть `http://localhost:3000`, переключить тему кнопкой, пройти главную,
каталог, карточку объекта, кабинет, страницу 3D. Тёмная тема без белых пятен.

Коммит: `git add -A -- public tests package.json; git commit -m "feat: dark theme with cookie persistence and header toggle"`

---

## Задача 2. Комиссия 1% вместо «Тарифов»; удаление кода подписок

**Файлы:** `public/js/app.js`, `public/styles.css`, `server/app.js`,
`server/subscriptions.js` (удалить), `tests/commission-ui.test.js` (новый),
`tests/pricing-ui.test.js` (удалить).

### Шаг 2.1 — Тест (падает)

Удалить `tests/pricing-ui.test.js` (файл и упоминание в скрипте `test` в
`package.json`; на его место добавить `tests/commission-ui.test.js`). Создать
`tests/commission-ui.test.js` (статический сервер со стабами API; 4-й тест
добавляется в задаче 6 — сейчас создать файл без него):

```js
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

const base_ = {
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
const sale = base_;
const rent = { ...base_, id: 2, deal: "rent", price: "150000" };
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
```

Прогон: `node --test tests/commission-ui.test.js` — падает.

### Шаг 2.2 — Секция комиссии в `home()` (`public/js/app.js`)

Найти в разметке `home()` секцию `<section class="pricing-section">…</section>`
(идёт после `city-section`, заканчивается перед закрывающим `</div>` контейнера
страницы) и заменить ЦЕЛИКОМ на:

```html
<section class="commission-section"><div class="section-heading"><div><h2 id="commission-title">Как мы зарабатываем</h2><p id="commission-text">Комиссия сервиса — 1% только с успешной продажи объекта. Размещение объявлений и аренда — бесплатно.</p></div></div><div class="commission-facts"><div class="commission-fact"><b>0 ₽</b><span>размещение объявлений</span></div><div class="commission-fact"><b>0 ₽</b><span>аренда — комиссии нет</span></div><div class="commission-fact"><b>1%</b><span>только с состоявшейся продажи</span></div></div></section>
```

### Шаг 2.3 — Строка 1% в `detail()` (`public/js/app.js`)

В `contact-panel` после строки НДС:

```js
<p class="muted">${p.tax && p.tax !== "unspecified" ? taxLabels[p.tax] : "НДС: не указан"}</p>
```

вставить сразу за ней:

```js
${p.deal === "sale" ? `<p class="commission-note">Комиссия сервиса: 1% — ${money(Math.round(Number(p.price) * 0.01))}</p>` : ""}
```

(`p.price` из API — строка NUMERIC, поэтому `Number(...)`; `money` уже
импортирован в app.js.)

### Шаг 2.4 — Удалить код подписок

1. `public/js/app.js`: удалить блок `/* ── Subscription modal ── */` целиком
   (`let subModal`, `ensureSubModal`, обработчики `.sub-request`,
   `#sub-modal-form` и т.п.) и все вызовы из `home()`. Контроль:
   `Select-String -Path public\js\app.js -Pattern 'sub-modal|subModal|sub-request|subscriptions'` — пусто.
2. `server/app.js`: удалить строку
   `import { subscriptionsRouter } from "./subscriptions.js";` и строку
   `app.use("/api", subscriptionsRouter());`.
3. Удалить файл: `Remove-Item server\subscriptions.js`.
4. `public/styles.css`: удалить все правила `.pricing-*` (включая вхождения
   внутри медиа-запросов) и правила модалки подписок
   (`.modal-overlay`, `.modal-dialog`, `.modal-header`, `.modal-*` —
   используются только удалённой модалкой; проверить
   `Select-String -Path public\js\*.js -Pattern 'modal-'` — пусто, кроме
   room/architectural-модалок, если они используют другие классы).

### Шаг 2.5 — Стили комиссии (`public/styles.css`)

Добавить:

```css
.commission-section {
  padding: 56px 0;
}
.commission-facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 24px;
}
.commission-fact {
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: center;
}
.commission-fact b {
  display: block;
  font-size: 34px;
  color: var(--blue);
}
.commission-fact span {
  color: var(--muted);
  font-size: 14px;
}
.commission-note {
  margin: 6px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--blue-border);
  border-radius: 6px;
  background: var(--blue-light);
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}
@media (max-width: 720px) {
  .commission-facts {
    grid-template-columns: 1fr;
  }
  .commission-section {
    padding: 36px 0;
  }
}
```

### Шаг 2.6 — Прогон, формат, коммит

`node --test tests/commission-ui.test.js` — зелёный (3 теста).
`npm.cmd test` — зелёный.
`npx.cmd prettier --write public/js/app.js public/styles.css server/app.js tests/commission-ui.test.js package.json`
`git add -A -- public server tests package.json`
`git commit -m "feat: 1% commission block replaces subscription pricing"`

---

## Задача 3. Миграция 006, ADMIN_EMAIL, requireAdmin, блокировки в auth

**Файлы:** `migrations/006_admin_content.sql` (новый), `server/config.js`,
`server/security.js`, `server/auth.js`, `.env.example`,
`tests/admin-api.test.js` (новый, часть 1), `package.json`.

### Шаг 3.1 — Миграция

Создать `migrations/006_admin_content.sql`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_settings(key,value) VALUES
  ('heroTitle','Подберём помещение под ваш бизнес за 48 часов — платите только 1% при покупке'),
  ('heroText','Офисы, склады и торговые площади напрямую от собственников. Размещение и аренда — бесплатно, комиссия 1% — только когда сделка продажи состоялась.'),
  ('commissionTitle','Как мы зарабатываем'),
  ('commissionText','Комиссия сервиса — 1% только с успешной продажи объекта. Размещение объявлений и аренда — бесплатно.')
ON CONFLICT (key) DO NOTHING;
```

Таблицу `subscription_requests` НЕ трогать.

### Шаг 3.2 — `server/config.js`

В объект `config` добавить поле (рядом с `trustProxy`):

```js
adminEmail: (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
```

В `.env.example` добавить строку с комментарием:

```
# Email администратора (владелец этого аккаунта получает доступ к /admin)
ADMIN_EMAIL=
```

### Шаг 3.3 — `server/security.js`

Добавить импорт `import { pool } from "./db.js";` и в конец файла:

```js
export async function isAdminUser(userId) {
  if (!userId || !config.adminEmail) return false;
  const row = (
    await pool.query("SELECT email FROM users WHERE id=$1", [userId])
  ).rows[0];
  return !!row && row.email.toLowerCase() === config.adminEmail;
}
export async function requireAdmin(req, res, next) {
  if (!req.session.userId)
    return res
      .status(401)
      .json({ error: "Войдите в аккаунт, чтобы продолжить" });
  if (!(await isAdminUser(req.session.userId)))
    return res.status(403).json({ error: "Недостаточно прав" });
  next();
}
```

### Шаг 3.4 — `server/auth.js`

1. Импорт config: `import { config } from "./config.js";`.
2. `userColumns` →
   `"id, name, email, phone, bio, avatar_filename, company, business_role, is_blocked"`.
3. Хелпер рядом с `privateUser`:
   ```js
   const asAdmin = (email) =>
     !!config.adminEmail && String(email).toLowerCase() === config.adminEmail;
   ```
4. `GET /session` — заменить тело на:
   ```js
   router.get("/session", async (req, res) => {
     req.session.csrfToken ||= newToken();
     const user = req.session.userId
       ? (
           await pool.query(`SELECT ${userColumns} FROM users WHERE id=$1`, [
             req.session.userId,
           ])
         ).rows[0]
       : null;
     if (!user || user.is_blocked) {
       if (req.session.userId) {
         await new Promise((resolve, reject) =>
           req.session.destroy((err) => (err ? reject(err) : resolve())),
         );
         res.clearCookie("mesto.sid", { path: "/" });
       }
       req.session.csrfToken ||= newToken();
       return res.json({
         user: null,
         isAdmin: false,
         csrfToken: req.session.csrfToken,
       });
     }
     res.json({
       user: privateUser(user),
       isAdmin: asAdmin(user.email),
       csrfToken: req.session.csrfToken,
     });
   });
   ```
5. `POST /login` — после `if (!valid || !row) return res.status(401)…` добавить:
   ```js
   if (row.is_blocked)
     return res.status(403).json({ error: "Аккаунт заблокирован" });
   ```
   и в ответах login/register добавить `isAdmin: asAdmin(row.email)`:
   `res.json({ user: privateUser(row), isAdmin: asAdmin(row.email), csrfToken: req.session.csrfToken });`
   (аналогично в register — `res.status(201).json({ user: …, isAdmin: asAdmin(row.email), csrfToken: … })`).

### Шаг 3.5 — Тест `tests/admin-api.test.js` (часть 1)

Создать файл (полностью; тесты задачи 5 дописываются в него же):

```js
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

test("session reports isAdmin only for ADMIN_EMAIL", async () => {
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
  await pool.query("UPDATE users SET is_blocked=false WHERE id=$1", [userId]);
  const ok = await user
    .post("/api/auth/login")
    .set("X-CSRF-Token", userToken)
    .send({ email: userEmail, password });
  assert.equal(ok.status, 200);
  userToken = ok.body.csrfToken;
});
```

Добавить `tests/admin-api.test.js` в скрипт `test:api` в `package.json`
(в конец списка файлов).

Прогон: `npm.cmd run test:api` — новые тесты зелёные, старые без регрессий.
(Перед прогоном убедиться, что `subscriptions` уже удалены — задача 2. Если
`tests/migration.test.js` проверяет число/состав миграций — обновить его
ожидания под 006.)

### Шаг 3.6 — Формат, коммит

`npx.cmd prettier --write server migrations tests/admin-api.test.js package.json`
(`.env.example` не форматировать — prettier его не парсит)
`git add -A -- server migrations tests .env.example package.json`
`git commit -m "feat: ADMIN_EMAIL, blocked users, site_settings migration"`

---

## Задача 4. Обход прав владельца для админа (существующие эндпоинты)

**Файлы:** `server/properties.js`, `server/uploads.js`,
`server/architectural-models.js`, `server/room-models.js`,
`public/js/forms.js`, `tests/admin-api.test.js`.

Принцип: админ определяется НА СЕРВЕРЕ (`isAdminUser(req.session.userId)`),
никогда из данных клиента. Паттерч обхода владельца:

- `WHERE id=$1 AND owner_id=$2` → при `admin` — `WHERE id=$1`;
- `WHERE id=$1 AND (status='published' OR owner_id=$2)` →
  `WHERE id=$1 AND ($3 OR status='published' OR owner_id=$2)`, `$3` = admin
  (boolean).

### Шаг 4.1 — Тест (падает)

Дописать в `tests/admin-api.test.js`:

```js
test("admin sees and edits a foreign draft via existing endpoints", async () => {
  const stranger = request.agent(app);
  const anon = await stranger.get(`/api/properties/${draftId}`);
  assert.equal(anon.status, 404);
  const seen = await admin.get(`/api/properties/${draftId}`).expect(200);
  assert.equal(seen.body.property.id, draftId);
  const patched = await admin
    .patch(`/api/properties/${draftId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ title: "Отредактировано админом" });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.property.title, "Отредактировано админом");
  const forbidden = await user
    .patch(`/api/properties/${draftId}`)
    .set("X-CSRF-Token", userToken)
    .send({ title: "Не положено" });
  assert.equal(forbidden.status, 404);
});
```

Прогон `npm.cmd run test:api` — новый тест падает (404 у админа).

### Шаг 4.2 — `server/properties.js`

1. Импорт: `import { requireAuth, notFound, isAdminUser } from "./security.js";`
2. `owned()`:
   ```js
   export async function owned(client, propertyId, userId, admin = false) {
     const row = (
       await client.query(
         admin
           ? "SELECT * FROM properties WHERE id=$1 FOR UPDATE"
           : "SELECT * FROM properties WHERE id=$1 AND owner_id=$2 FOR UPDATE",
         [propertyId, userId],
       )
     ).rows[0];
     if (!row) throw notFound();
     return row;
   }
   ```
3. В `PATCH /properties/:id` и `DELETE /properties/:id` ПЕРЕД
   `transaction(...)` добавить `const admin = await isAdminUser(req.session.userId);`
   и передать 4-м аргументом: `owned(client, id(req.params.id), req.session.userId, admin)`.
4. `GET /properties/:id`:
   ```js
   router.get("/properties/:id", async (req, res) => {
     const admin = await isAdminUser(req.session.userId);
     const row = (
       await pool.query(
         `SELECT ${publicColumns},${imageColumns},EXISTS(SELECT 1 FROM favorites WHERE property_id=p.id AND user_id=$2) AS is_favorite FROM properties p WHERE p.id=$1 AND ($3 OR p.status='published' OR p.owner_id=$2)`,
         [id(req.params.id), req.session.userId || null, admin],
       )
     ).rows[0];
     if (!row) throw notFound();
     if (admin || row.owner_id === req.session.userId)
       row.contact_phone = ( …без изменений… ).rows[0].contact_phone;
     …остальное без изменений…
   ```
5. `GET /properties/:id/contact` — тот же паттерн:
   `WHERE id=$1 AND ($3 OR status='published' OR owner_id=$2)`, параметры
   `[id(req.params.id), req.session.userId || null, admin]`,
   `const admin = await isAdminUser(req.session.userId);` в начале.

### Шаг 4.3 — `server/uploads.js`

1. Импорт `isAdminUser` из `./security.js`.
2. `checkOwner`:
   ```js
   const checkOwner = async (req, res, next) => {
     req.isAdmin = await isAdminUser(req.session.userId);
     if (
       !(
         await pool.query(
           req.isAdmin
             ? "SELECT 1 FROM properties WHERE id=$1"
             : "SELECT 1 FROM properties WHERE id=$1 AND owner_id=$2",
           [id(req.params.id), req.session.userId],
         )
       ).rowCount
     )
       throw notFound();
     next();
   };
   ```
3. В POST-хендлере изображений внутренняя tx-проверка:
   `req.isAdmin ? "SELECT id FROM properties WHERE id=$1 FOR UPDATE" : "SELECT id FROM properties WHERE id=$1 AND owner_id=$2 FOR UPDATE"`
   (параметры те же — лишний `$2` для admin-ветки просто не используется;
   если pg ругается, передавать `[id(req.params.id)]` в admin-ветке).
4. В DELETE-хендлере изображений (без checkOwner): в начале
   `const admin = await isAdminUser(req.session.userId);`, запрос статуса:
   `admin ? "SELECT status FROM properties WHERE id=$1 FOR UPDATE" : "SELECT status FROM properties WHERE id=$1 AND owner_id=$2 FOR UPDATE"`.
5. `serveMedia`:
   ```js
   export async function serveMedia(req, res, next) {
     const name = req.params.filename;
     if (!/^[a-f0-9-]{36}\.webp$/.test(name)) throw notFound();
     const admin = await isAdminUser(req.session.userId);
     const allowed = await pool.query(
       `SELECT 1 FROM property_images i JOIN properties p ON p.id=i.property_id WHERE i.filename=$1 AND ($3 OR p.status='published' OR p.owner_id=$2)
       UNION ALL SELECT 1 FROM users WHERE avatar_filename=$1 LIMIT 1`,
       [name, req.session.userId || null, admin],
     );
     …без изменений…
   ```

### Шаг 4.4 — `server/architectural-models.js`

1. Импорт `isAdminUser`.
2. `own(client, propertyId, userId, admin = false)` — паттерн шага 4.2.2;
   во всех вызовах `own(...)` вычислить `const admin = await isAdminUser(req.session.userId);`
   и передать последним аргументом.
3. `visible(propertyId, userId, admin = false)`:
   `WHERE id=$1 AND ($3 OR status='published' OR owner_id=$2)`, параметры
   `[propertyId, userId || null, admin]`; в вызовах передать admin.
4. Pre-check перед загрузкой плана (строка ~177,
   `SELECT id FROM properties WHERE id=$1 AND owner_id=$2`) — тот же обход.
5. `serveArchitecturalModel` (строка ~307) и `servePropertyPlan`: запросы
   видимости расширить `($N OR p.status='published' OR p.owner_id=$M)` с
   `admin = await isAdminUser(req.session.userId)` дополнительным параметром.

### Шаг 4.5 — `server/room-models.js`

1. Импорт `isAdminUser`.
2. `GET /properties/:id/model` (строка ~97):
   ```js
   const admin = await isAdminUser(req.session.userId);
   const p = (
     await pool.query(
       "SELECT owner_id,category FROM properties WHERE id=$1 AND ($3 OR status='published' OR owner_id=$2)",
       [propertyId, req.session.userId || null, admin],
     )
   ).rows[0];
   ```
3. `serveRoomModel` (строка ~149) — аналогичный обход в запросе видимости.

### Шаг 4.6 — `public/js/forms.js` (редактор для админа)

В `editorPage`:

```js
if (String(p.ownerId) !== String(state.user.id) && !state.isAdmin)
  throw new Error("Вы можете редактировать только свои объявления.");
```

(`state.isAdmin` заполняется из `GET /api/auth/session` — задача 3.)

### Шаг 4.7 — Прогон, формат, коммит

`npm.cmd run test:api` — зелёный. `npm.cmd test` — зелёный.
`npx.cmd prettier --write server public/js/forms.js tests/admin-api.test.js`
`git add -A -- server public tests`
`git commit -m "feat: admin bypass for owner-only property endpoints"`

---

## Задача 5. `server/admin.js`: админ-API и публичный `/api/content`

**Файлы:** `server/admin.js` (новый), `server/app.js`,
`tests/admin-api.test.js`.

### Шаг 5.1 — Тесты (падают)

Дописать в `tests/admin-api.test.js`:

```js
test("admin API is closed to non-admins", async () => {
  for (const path of ["/api/admin/stats", "/api/admin/properties", "/api/admin/users", "/api/admin/content"]) {
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

  const list = await admin.get("/api/admin/properties?status=draft&q=Админ-тест").expect(200);
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
  const unblocked = await admin
    .patch(`/api/admin/users/${userId}`)
    .set("X-CSRF-Token", adminToken)
    .send({ blocked: false });
  assert.equal(unblocked.status, 200);
});

test("content: public defaults, admin edit, validation", async () => {
  const pub = await request(app).get("/api/content").expect(200);
  assert.match(pub.body.heroTitle, /48 часов/);
  assert.match(pub.body.commissionText, /1%/);

  const before = { ...pub.body };
  const updated = await admin
    .put("/api/admin/content")
    .set("X-CSRF-Token", adminToken)
    .send({
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
```

### Шаг 5.2 — `server/admin.js` (новый файл, полностью)

```js
import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { requireAdmin, notFound } from "./security.js";
import { parse, id } from "./validation.js";

export const DEFAULT_CONTENT = {
  heroTitle:
    "Подберём помещение под ваш бизнес за 48 часов — платите только 1% при покупке",
  heroText:
    "Офисы, склады и торговые площади напрямую от собственников. Размещение и аренда — бесплатно, комиссия 1% — только когда сделка продажи состоялась.",
  commissionTitle: "Как мы зарабатываем",
  commissionText:
    "Комиссия сервиса — 1% только с успешной продажи объекта. Размещение объявлений и аренда — бесплатно.",
};
const contentKeys = Object.keys(DEFAULT_CONTENT);
const contentSchema = z
  .object({
    heroTitle: z.string().trim().min(5, "Заголовок: минимум 5 символов").max(300, "Заголовок: максимум 300 символов"),
    heroText: z.string().trim().min(10, "Подзаголовок: минимум 10 символов").max(1000, "Подзаголовок: максимум 1000 символов"),
    commissionTitle: z.string().trim().min(3, "Название блока: минимум 3 символа").max(300, "Название блока: максимум 300 символов"),
    commissionText: z.string().trim().min(10, "Текст блока: минимум 10 символов").max(1000, "Текст блока: максимум 1000 символов"),
  })
  .strict();
const blockedSchema = z.object({ blocked: z.boolean() }).strict();
const statuses = new Set(["draft", "published", "archived"]);
const deals = new Set(["sale", "rent"]);
const pageParams = (query) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(48, Math.max(1, Number(query.limit) || 12));
  return { page, limit, offset: (page - 1) * limit };
};

async function readContent() {
  const rows = (
    await pool.query(
      "SELECT key,value FROM site_settings WHERE key = ANY($1::text[])",
      [contentKeys],
    )
  ).rows;
  const content = { ...DEFAULT_CONTENT };
  for (const row of rows) content[row.key] = row.value;
  return content;
}

// Публичные тексты главной — без авторизации.
export function contentRouter() {
  const router = Router();
  router.get("/content", async (req, res) => res.json(await readContent()));
  return router;
}

export function adminRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get("/stats", async (req, res) => {
    const row = (
      await pool.query(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM users WHERE is_blocked) AS blocked_users,
        (SELECT count(*)::int FROM properties) AS properties,
        (SELECT count(*)::int FROM properties WHERE status='published') AS published,
        (SELECT count(*)::int FROM properties WHERE status='draft') AS drafts,
        (SELECT count(*)::int FROM properties WHERE status='archived') AS archived,
        (SELECT count(*)::int FROM properties WHERE deal='sale') AS sale,
        (SELECT count(*)::int FROM properties WHERE deal='rent') AS rent`)
    ).rows[0];
    res.json({
      users: row.users,
      blockedUsers: row.blocked_users,
      properties: row.properties,
      published: row.published,
      drafts: row.drafts,
      archived: row.archived,
      sale: row.sale,
      rent: row.rent,
    });
  });

  router.get("/properties", async (req, res) => {
    const { page, limit, offset } = pageParams(req.query);
    const q =
      typeof req.query.q === "string" && req.query.q.trim()
        ? req.query.q.trim()
        : null;
    const status = statuses.has(req.query.status) ? req.query.status : null;
    const deal = deals.has(req.query.deal) ? req.query.deal : null;
    const where = `WHERE ($1::text IS NULL OR p.title ILIKE '%'||$1||'%' OR p.city ILIKE '%'||$1||'%' OR p.address ILIKE '%'||$1||'%') AND ($2::text IS NULL OR p.status=$2) AND ($3::text IS NULL OR p.deal=$3)`;
    const params = [q, status, deal];
    const total = Number(
      (await pool.query(`SELECT count(*) FROM properties p ${where}`, params))
        .rows[0].count,
    );
    const rows = (
      await pool.query(
        `SELECT p.id,p.title,p.deal,p.category,p.city,p.price,p.area,p.status,p.created_at,u.name AS owner_name,u.company AS owner_company,u.email AS owner_email
         FROM properties p JOIN users u ON u.id=p.owner_id
         ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT $4 OFFSET $5`,
        [...params, limit, offset],
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        deal: r.deal,
        category: r.category,
        city: r.city,
        price: r.price,
        area: r.area,
        status: r.status,
        createdAt: r.created_at,
        ownerName: r.owner_name,
        ownerCompany: r.owner_company,
        ownerEmail: r.owner_email,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  router.get("/users", async (req, res) => {
    const { page, limit, offset } = pageParams(req.query);
    const total = Number(
      (await pool.query("SELECT count(*) FROM users")).rows[0].count,
    );
    const rows = (
      await pool.query(
        `SELECT u.id,u.name,u.email,u.company,u.business_role,u.is_blocked,u.created_at,
          (SELECT count(*)::int FROM properties p WHERE p.owner_id=u.id) AS property_count
         FROM users u ORDER BY u.created_at DESC,u.id DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        company: r.company,
        businessRole: r.business_role,
        blocked: r.is_blocked,
        createdAt: r.created_at,
        propertyCount: r.property_count,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  router.patch("/users/:id", async (req, res) => {
    const data = parse(blockedSchema, req.body);
    const userId = id(req.params.id);
    if (userId === req.session.userId)
      return res.status(422).json({ error: "Нельзя заблокировать себя" });
    const row = (
      await pool.query("SELECT id,is_blocked FROM users WHERE id=$1", [userId])
    ).rows[0];
    if (!row) throw notFound();
    if (data.blocked && !row.is_blocked)
      await pool.query(
        "DELETE FROM sessions WHERE sess::jsonb->>'userId'=$1::text",
        [String(userId)],
      );
    await pool.query("UPDATE users SET is_blocked=$2 WHERE id=$1", [
      userId,
      data.blocked,
    ]);
    res.json({ blocked: data.blocked });
  });

  router.get("/content", async (req, res) => res.json(await readContent()));

  router.put("/content", async (req, res) => {
    const data = parse(contentSchema, req.body);
    for (const key of contentKeys)
      await pool.query(
        "INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=now()",
        [key, data[key]],
      );
    res.json(await readContent());
  });

  return router;
}
```

### Шаг 5.3 — `server/app.js`

1. Добавить импорт:
   `import { adminRouter, contentRouter } from "./admin.js";`
2. После `app.use("/api/auth", authRouter());` добавить:
   ```js
   app.use("/api", contentRouter());
   app.use("/api/admin", adminRouter());
   ```
3. SPA-regex (строка ~166) — добавить `admin`:
   ```js
   /^\/(?:catalog|property\/\d+|login|register|account|publish|edit\/\d+|admin)?\/?$/,
   ```

### Шаг 5.4 — Прогон, формат, коммит

`npm.cmd run test:api` — зелёный.
`npx.cmd prettier --write server tests/admin-api.test.js`
`git add -A -- server tests`
`git commit -m "feat: admin API (stats, properties, users, content) and public /api/content"`

---

## Задача 6. Фронтенд `/admin`, hero/title по 4U, тексты из `/api/content`

**Файлы:** `public/js/admin.js` (новый), `public/js/app.js`,
`public/index.html`, `public/styles.css`, `tests/admin-ui.test.js` (новый),
`tests/commission-ui.test.js` (4-й тест).

### Шаг 6.1 — Тест `tests/admin-ui.test.js` (падает)

Статический сервер как в задаче 2, но со стабами админ-API; роль задаётся
cookie `stub=admin|user` (по умолчанию аноним):

```js
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
        return json({ user: adminUser, isAdmin: true, csrfToken: "a".repeat(64) });
      if (/stub=user/.test(cookie))
        return json({ user: plainUser, isAdmin: false, csrfToken: "b".repeat(64) });
      return json({ user: null, isAdmin: false, csrfToken: "c".repeat(64) });
    }
    if (pathname === "/api/admin/stats")
      return json({
        users: 5, blockedUsers: 1, properties: 7, published: 4,
        drafts: 2, archived: 1, sale: 3, rent: 4,
      });
    if (pathname === "/api/admin/properties")
      return json({
        items: [
          {
            id: 5, title: "Склад 500 м²", deal: "sale", category: "warehouse",
            city: "Казань", price: "25000000", area: "500", status: "draft",
            createdAt: "2026-10-01T10:00:00.000Z", ownerName: "Иван Петров",
            ownerCompany: "ООО Склад", ownerEmail: "ivan@example.com",
          },
        ],
        total: 1, page: 1, pages: 1,
      });
    if (pathname === "/api/admin/users")
      return json({
        items: [
          {
            id: 9, name: "Обычный Пользователь", email: "user@example.com",
            company: "", businessRole: "owner", blocked: false,
            createdAt: "2026-09-01T10:00:00.000Z", propertyCount: 2,
          },
        ],
        total: 1, page: 1, pages: 1,
      });
    if (pathname === "/api/admin/content")
      return json({
        heroTitle: "Заголовок из админки",
        heroText: "Подзаголовок из админки",
        commissionTitle: "Как мы зарабатываем",
        commissionText: "Комиссия сервиса — 1% только с успешной продажи объекта.",
      });
    if (pathname.startsWith("/api/"))
      return json({ error: "Маршрут API не найден" }, 404);
    if (pathname === "/" || pathname === "/admin" || pathname === "/login")
      pathname = "/index.html";
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
    await page.context().addCookies([{ name: "stub", value: stub, url: base() }]);
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
  assert.equal(
    await page.locator('.admin-item a[href="/edit/5"]').count(),
    1,
  );
  assert.ok(await page.locator('[data-status="published"]').first().isVisible());

  await page.goto(base() + "/admin?tab=users");
  await page.locator(".admin-item", { hasText: "Обычный Пользователь" }).waitFor();
  assert.ok(await page.locator("[data-block]").first().isVisible());

  await page.goto(base() + "/admin?tab=content");
  const input = page.locator('input[name="heroTitle"]');
  await input.waitFor();
  assert.equal(await input.inputValue(), "Заголовок из админки");
  await page.close();
});
```

Дополнить `tests/commission-ui.test.js` четвёртым тестом:

```js
test("home replaces default copy with /api/content values", async () => {
  const page = await browser.newPage();
  await page
    .context()
    .addCookies([{ name: "stub-content", value: "1", url: base() }]);
  await page.goto(base() + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () =>
      document.querySelector("#hero-title")?.textContent ===
      "ЗАГОЛОВОК ИЗ АДМИНКИ",
  );
  assert.equal(
    await page.locator("#commission-title").textContent(),
    "Комиссия из админки",
  );
  await page.close();
});
```

Прогон: `node --test tests/admin-ui.test.js tests/commission-ui.test.js` —
падают.

### Шаг 6.2 — 4U: `public/index.html`

1. `<title>Место Бизнес — коммерческая недвижимость: 1% с продажи, аренда бесплатно</title>`
2. meta description →
   `Подберём помещение под ваш бизнес за 48 часов. Офисы, склады и торговые площади от собственников: размещение и аренда бесплатны, комиссия 1% — только с успешной продажи.`

### Шаг 6.3 — 4U hero + контент из API: `public/js/app.js`

1. В `home()` заменить hero-блок:

   Было:
   ```html
   <div class="eyebrow">Коммерческая недвижимость</div><h1>Пространство для вашего бизнеса.</h1><p>Офисы, торговые площади и объекты для логистики. Аренда и покупка напрямую у авторов объявлений.</p>
   ```
   Стало:
   ```html
   <div class="eyebrow">Коммерческая недвижимость для бизнеса</div><h1 id="hero-title">Подберём помещение под ваш бизнес за 48 часов — платите только 1% при покупке</h1><p id="hero-text">Офисы, склады и торговые площади напрямую от собственников. Размещение и аренда — бесплатно, комиссия 1% — только когда сделка продажи состоялась.</p>
   ```

2. В конце `home()` (после существующей загрузки листингов/категорий, до
   закрытия функции) добавить подмену текстов из админки:

   ```js
   // Тексты главной могут быть отредактированы в админ-панели: дефолты уже
   // в разметке (нет скачков LCP), при отличии заменяем из /api/content.
   api("/content")
     .then((content) => {
       for (const [elementId, value] of [
         ["hero-title", content.heroTitle],
         ["hero-text", content.heroText],
         ["commission-title", content.commissionTitle],
         ["commission-text", content.commissionText],
       ]) {
         const el = document.getElementById(elementId);
         if (el && value) el.textContent = value;
       }
     })
     .catch(() => {
       /* остаются тексты по умолчанию */
     });
   ```

   ВАЖНО: если к моменту ответа страница уже не главная (роутер успел
   уйти), `document.getElementById` вернёт null — замена безопасно
   пропустится. Дополнительно перед заменой проверить
   `location.pathname.replace(/\/$/, "") === "/"`.

3. `header()` — ссылка на админку для админов:

   ```js
   function header() {
     // Header markup is static in index.html to avoid layout shift; only the
     // auth link depends on the session.
     if (!state.user) return;
     const link = document.querySelector("#header [data-auth-link]");
     if (link) {
       link.href = "/account";
       link.textContent = "Кабинет";
     }
     if (state.isAdmin && !document.querySelector("#header [data-admin-link]")) {
       const actions = document.querySelector("#header .header-actions");
       const adminLink = document.createElement("a");
       adminLink.href = "/admin";
       adminLink.dataset.adminLink = "";
       adminLink.textContent = "Админ-панель";
       actions.insertBefore(adminLink, actions.querySelector("[data-auth-link]"));
     }
   }
   ```

4. Роутер — ветка `/admin` после ветки `/account`:

   ```js
   } else if (path === "/admin") {
     await sessionReady;
     const { adminPage } = await import("./admin.js");
     await adminPage();
   }
   ```

### Шаг 6.4 — `public/js/admin.js` (новый файл, полностью)

```js
import { state, api, esc, money, toast, navigate, empty, errors, busy } from "./core.js";
const main = document.querySelector("#main");
const statusLabels = {
  draft: "Черновик",
  published: "Опубликовано",
  archived: "Архив",
};

export async function adminPage() {
  if (!state.user) {
    navigate("/login?next=" + encodeURIComponent("/admin"));
    return;
  }
  if (!state.isAdmin) {
    toast("Недостаточно прав");
    navigate("/");
    return;
  }
  const tab = new URLSearchParams(location.search).get("tab") || "dashboard";
  main.innerHTML = `<div class="container page"><div class="section-heading"><div><h1>Админ-панель</h1><p>Управление площадкой «Место Бизнес»</p></div><a class="button secondary" href="/">На главную</a></div><nav class="tabs" aria-label="Разделы админ-панели">${Object.entries(
    {
      dashboard: "Дашборд",
      properties: "Объявления",
      users: "Пользователи",
      content: "Контент",
    },
  )
    .map(
      ([key, label]) =>
        `<a class="${key === tab ? "active" : ""}" href="/admin?tab=${key}">${label}</a>`,
    )
    .join("")}</nav><div id="admin-content"><div class="loading">Загрузка…</div></div></div>`;
  const content = document.querySelector("#admin-content");
  if (tab === "properties") await adminProperties(content);
  else if (tab === "users") await adminUsers(content);
  else if (tab === "content") await adminContent(content);
  else await adminDashboard(content);
}

async function adminDashboard(content) {
  const s = await api("/admin/stats");
  content.innerHTML = `<div class="admin-stats">${[
    ["users", "пользователей"],
    ["blockedUsers", "заблокировано"],
    ["properties", "объявлений"],
    ["published", "опубликовано"],
    ["drafts", "черновиков"],
    ["archived", "в архиве"],
    ["sale", "продажа"],
    ["rent", "аренда"],
  ]
    .map(
      ([key, label]) =>
        `<div class="admin-stat"><b>${Number(s[key]) || 0}</b><span>${label}</span></div>`,
    )
    .join("")}</div>`;
}

function adminQuery(extra = "") {
  const params = new URLSearchParams(location.search);
  params.set("tab", "properties");
  params.delete("page");
  for (const key of ["q", "status", "deal"])
    if (!params.get(key)) params.delete(key);
  return params.toString() + extra;
}

async function adminProperties(content) {
  const params = new URLSearchParams(location.search);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = params.get("q") || "";
  const status = params.get("status") || "";
  const deal = params.get("deal") || "";
  const data = await api(
    `/admin/properties?page=${page}&limit=12${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${encodeURIComponent(status)}` : ""}${deal ? `&deal=${encodeURIComponent(deal)}` : ""}`,
  );
  content.innerHTML = `<form class="admin-filters" action="/admin" method="get"><input type="hidden" name="tab" value="properties"><input name="q" value="${esc(q)}" placeholder="Заголовок, город или адрес" aria-label="Поиск объявлений"><select name="status" aria-label="Статус"><option value="">Любой статус</option>${Object.entries(statusLabels)
    .map(
      ([value, label]) =>
        `<option value="${value}"${status === value ? " selected" : ""}>${label}</option>`,
    )
    .join("")}</select><select name="deal" aria-label="Тип сделки"><option value="">Любая сделка</option><option value="sale"${deal === "sale" ? " selected" : ""}>Продажа</option><option value="rent"${deal === "rent" ? " selected" : ""}>Аренда</option></select><button class="button secondary" type="submit">Применить</button></form>${
    data.items.length
      ? `<div class="admin-list">${data.items
          .map(
            (p) =>
              `<article class="admin-item"><div><a href="/property/${encodeURIComponent(p.id)}"><strong>${esc(p.title)}</strong></a><p class="muted">${esc(p.city)} · ${p.deal === "sale" ? "Продажа" : "Аренда"} · ${money(p.price)} · ${esc(p.ownerName)}${p.ownerCompany ? `, ${esc(p.ownerCompany)}` : ""}</p></div><div class="admin-item-actions"><span class="admin-status ${esc(p.status)}">${statusLabels[p.status] || esc(p.status)}</span><a class="button secondary" href="/edit/${encodeURIComponent(p.id)}">Изменить</a>${
                p.status === "published"
                  ? `<button class="button secondary" data-status="archived" data-id="${encodeURIComponent(p.id)}">В архив</button>`
                  : `<button class="button secondary" data-status="published" data-id="${encodeURIComponent(p.id)}">Опубликовать</button>`
              }<button class="button danger" data-delete="${encodeURIComponent(p.id)}">Удалить</button></div></article>`,
          )
          .join("")}</div>`
      : empty("Ничего не найдено", "Измените фильтры или загляните позже.", "/admin?tab=properties", "Сбросить фильтры")
  }<nav class="pagination" aria-label="Страницы">${Array.from(
    { length: data.pages },
    (_, i) =>
      `<a class="${i + 1 === data.page ? "active" : ""}" href="/admin?${adminQuery(`&page=${i + 1}`)}">${i + 1}</a>`,
  ).join("")}</nav>`;
  content.querySelectorAll("[data-status]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        await api("/properties/" + button.dataset.id, {
          method: "PATCH",
          body: { status: button.dataset.status },
        });
        toast(
          button.dataset.status === "published"
            ? "Объявление опубликовано"
            : "Объявление отправлено в архив",
        );
        await adminPage();
      } catch (error) {
        toast(error.message);
        button.disabled = false;
      }
    };
  });
  content.querySelectorAll("[data-delete]").forEach((button) => {
    button.onclick = async () => {
      if (
        !confirm("Удалить объявление и все его фотографии? Это действие нельзя отменить.")
      )
        return;
      button.disabled = true;
      try {
        await api("/properties/" + button.dataset.delete, { method: "DELETE" });
        toast("Объявление удалено");
        await adminPage();
      } catch (error) {
        toast(error.message);
        button.disabled = false;
      }
    };
  });
}

async function adminUsers(content) {
  const params = new URLSearchParams(location.search);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const data = await api(`/admin/users?page=${page}&limit=12`);
  content.innerHTML = `<div class="admin-list">${data.items
    .map(
      (u) =>
        `<article class="admin-item"><div><strong>${esc(u.name)}</strong><p class="muted">${esc(u.email)}${u.company ? ` · ${esc(u.company)}` : ""} · объявлений: ${u.propertyCount} · регистрация ${new Date(u.createdAt).toLocaleDateString("ru-RU")}</p></div><div class="admin-item-actions">${
          u.blocked
            ? `<span class="admin-status archived">Заблокирован</span><button class="button secondary" data-unblock="${u.id}">Разблокировать</button>`
            : `<button class="button danger" data-block="${u.id}">Заблокировать</button>`
        }</div></article>`,
    )
    .join("")}</div><nav class="pagination" aria-label="Страницы">${Array.from(
    { length: data.pages },
    (_, i) =>
      `<a class="${i + 1 === data.page ? "active" : ""}" href="/admin?tab=users&page=${i + 1}">${i + 1}</a>`,
  ).join("")}</nav>`;
  const wire = (selector, blocked, confirmText) =>
    content.querySelectorAll(selector).forEach((button) => {
      button.onclick = async () => {
        if (confirmText && !confirm(confirmText)) return;
        button.disabled = true;
        try {
          await api("/admin/users/" + button.dataset[blocked ? "block" : "unblock"], {
            method: "PATCH",
            body: { blocked },
          });
          toast(blocked ? "Пользователь заблокирован" : "Пользователь разблокирован");
          await adminPage();
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      };
    });
  wire("[data-block]", true, "Заблокировать пользователя? Он потеряет доступ к аккаунту.");
  wire("[data-unblock]", false, "");
}

async function adminContent(content) {
  const c = await api("/admin/content");
  content.innerHTML = `<form id="content-form" class="form-sheet" novalidate><section class="form-section"><h2>Тексты главной страницы</h2><p class="form-help">Заголовок и подзаголовок первого экрана, название и текст блока «Как мы зарабатываем». Изменения появятся на главной сразу после сохранения.</p><div class="form-grid"><label class="field full">Заголовок (H1)<input name="heroTitle" value="${esc(c.heroTitle)}" required minlength="5" maxlength="300"><span class="field-error" data-error="heroTitle"></span></label><label class="field full">Подзаголовок hero<textarea name="heroText" rows="3" required minlength="10" maxlength="1000">${esc(c.heroText)}</textarea><span class="field-error" data-error="heroText"></span></label><label class="field full">Название блока комиссии<input name="commissionTitle" value="${esc(c.commissionTitle)}" required minlength="3" maxlength="300"><span class="field-error" data-error="commissionTitle"></span></label><label class="field full">Текст блока комиссии<textarea name="commissionText" rows="3" required minlength="10" maxlength="1000">${esc(c.commissionText)}</textarea><span class="field-error" data-error="commissionText"></span></label></div><p class="form-error" role="alert" tabindex="-1"></p><div class="form-actions"><button class="button" type="submit">Сохранить тексты</button></div></section></form>`;
  const form = document.querySelector("#content-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    busy(form, true);
    try {
      await api("/admin/content", {
        method: "PUT",
        body: Object.fromEntries(new FormData(form)),
      });
      toast("Тексты главной сохранены");
    } catch (error) {
      errors(form, error);
    } finally {
      busy(form, false);
    }
  };
}
```

Замечания исполнителю:

- Сигнатуры `empty(title, text, href, label)`, `errors(form, error)`,
  `busy(form, on)` сверить с `public/js/core.js` и использованием в
  `forms.js` (если `empty` принимает меньше аргументов — подставить по факту).
- Разметку `<p class="form-error" …>` сверить с формами в `forms.js`
  (атрибуты hidden/role скопировать оттуда же).

### Шаг 6.5 — Стили админки (`public/styles.css`)

Добавить:

```css
.admin-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.admin-stat {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.admin-stat b {
  display: block;
  font-size: 28px;
}
.admin-stat span {
  color: var(--muted);
  font-size: 13px;
}
.admin-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}
.admin-filters input,
.admin-filters select {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
.admin-list {
  display: grid;
  gap: 10px;
}
.admin-item {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.admin-item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.admin-status {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: var(--soft);
  color: var(--ink);
}
.admin-status.published {
  background: var(--ok-bg);
  color: var(--ok-fg);
}
.admin-status.archived {
  background: var(--danger-bg);
  color: var(--danger);
}
.button.danger {
  background: var(--danger);
  color: var(--on-accent);
}
@media (max-width: 720px) {
  .admin-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

Проверить, что `.tabs`, `.pagination`, `.form-sheet`, `.form-section`,
`.form-help`, `.field-error`, `.form-actions` уже существуют (используются
кабинетом) — да, из `forms.js`.

### Шаг 6.6 — Прогон, формат, коммит

Добавить `tests/admin-ui.test.js` в скрипт `test` в `package.json`.
`node --test tests/admin-ui.test.js tests/commission-ui.test.js` — зелёные.
`npm.cmd test` — зелёный.
`npx.cmd prettier --write public tests`
`git add -A -- public tests`
`git commit -m "feat: /admin panel UI, 4U hero and editable homepage content"`

---

## Задача 7. Документация и полная проверка («проверь чтобы все было ровно»)

**Файлы:** `README.md`, `.env.example` (проверка), весь проект.

### Шаг 7.1 — README.md

1. Найти упоминания подписок/тарифов
   (`Select-String -Path README.md -Pattern 'ариф|одписк|subscription'`) и
   удалить/заменить их описанием модели «комиссия 1% только с продажи,
   размещение и аренда бесплатны».
2. Добавить раздел «Админ-панель»:
   - доступ: аккаунт с email из переменной окружения `ADMIN_EMAIL`
     (регистр не важен; пусто — админов нет);
   - страница `/admin`: дашборд, объявления (публикация/архив/удаление/
     правка любого объекта), пользователи (блокировка), тексты главной;
   - API: `GET /api/content` (публично), `GET /api/admin/stats`,
     `GET /api/admin/properties`, `GET /api/admin/users`,
     `PATCH /api/admin/users/:id`, `GET|PUT /api/admin/content` — всё под
     `requireAdmin`.
3. Добавить раздел «Тёмная тема»: переключатель в шапке, cookie `theme`
   (`dark|light|auto`, 1 год), `auto` = системная тема.
4. Обновить структуру файлов (новые `server/admin.js`, `public/js/admin.js`,
   `public/js/theme.js`, `migrations/006_admin_content.sql`) и таблицу API,
   если она есть.

### Шаг 7.2 — Полные проверки

Последовательно (все должны быть зелёными):

```
docker compose up -d db
npm.cmd run db:migrate
npm.cmd test
npm.cmd run test:api
npm.cmd run test:browser
npm.cmd run format:check
```

Если `format:check` падает — `npx.cmd prettier --write <проблемные пути>` и
повтор.

### Шаг 7.3 — Визуальная проверка (локально)

`npm.cmd run dev` (фон) → скриптом Playwright или вручную проверить
`http://localhost:3000`:

1. Главная: hero с 4U-заголовком, секция «Как мы зарабатываем» вместо
   «Тарифов», на странице объекта `sale` — строка «Комиссия сервиса: 1% — …»,
   на `rent` её нет.
2. Переключатель темы: клик меняет тему на всех страницах (главная, каталог,
   карточка, кабинет, /admin), после перезагрузки тема сохраняется.
3. Задать в `.env` локально `ADMIN_EMAIL=<email тестового аккаунта>`, войти
   этим аккаунтом: в шапке появилась «Админ-панель», `/admin` работает
   (все 4 вкладки); под обычным аккаунтом `/admin` редиректит на главную.
4. Тёмная тема на `/admin` без белых пятен.

Сделать скриншоты (Playwright `page.screenshot`) главной в светлой/тёмной теме
и `/admin` — показать пользователю.

### Шаг 7.4 — Коммит

`git add -A -- README.md docs; git commit -m "docs: admin panel, commission model, dark theme"`

---

## Задача 8. Деплой: GitHub + Dockhost

**Только после того, как задача 7 полностью зелёная.**

### Шаг 8.1 — Спросить у пользователя

1. Значение `ADMIN_EMAIL` для продакшена (какой email получит доступ к
   `/admin` на живом сайте). Без ответа НЕ деплоить.
2. Подтверждение на push в `main` и деплой (пользователь уже просил —
   достаточно сообщить, что начинаем).

### Шаг 8.2 — GitHub

```
git status   # убедиться, что не осталось мусора (whoosh_case.txt не добавлять)
git push origin main
```

### Шаг 8.3 — Переменная окружения в Dockhost

Установить `ADMIN_EMAIL` в окружении проекта:

```
dockhost environment --help
dockhost environment list          # проект my-project (9e05bcc9-be39-4f6f-907b-58f75339f6f0), кластер ru-1a
```

Задать переменную способом, который покажет `--help` (set/create). Секреты
(`SESSION_SECRET` и пр.) не трогать.

### Шаг 8.4 — Сборка

Репозиторий Dockhost `techeco` (id `0cceb4b5-76ca-48f5-bc86-687d41a008ba`)
привязан к `github.com/gvibco/mesto-realty`, ветка `main`. Запустить сборку:

```
dockhost repository --help
dockhost repository build techeco   # точную команду взять из --help
```

Дождаться завершения сборки/деплоя (статус через
`dockhost repository list` — колонка LAST BUILD, и/или
`dockhost container list`).

### Шаг 8.5 — Проверка живого сайта

URL вида `https://477a-oc71-643k.gw-1a.dockhost.net/` (актуальный взять из
`dockhost application list` / панели). Проверить webfetch/браузером:

1. `GET /` — новый title и hero, секция комиссии, нет «Тарифов».
2. `GET /api/content` — JSON с текстами.
3. `GET /api/admin/stats` без сессии — 401.
4. Карточка объекта `sale` — строка 1%; cookie `theme=dark` — тёмная тема.
5. Миграция 006 применилась (лог контейнера `npm run db:migrate` при старте).

### Шаг 8.6 — Отчитаться пользователю

Сообщить: что задеплоено, живой URL, какой email назначен админом, как
зайти в `/admin`.

---

## Чек-лист самопроверки плана (перед выполнением)

- [ ] Спецификация покрыта: комиссия (главная + карточка sale), удаление
      кода подписок при сохранении таблицы, админ-панель (4 вкладки,
      блокировки, тексты), тёмная тема (cookie, toggle, все страницы),
      4U (title + hero, редактируемость), деплой.
- [ ] В каждом шаге есть конкретный файл и проверяемый результат.
- [ ] Типы согласованы: `isAdmin` (bool) в session/login/register;
      `price` — строка NUMERIC → `Number()` в расчёте 1%; `blocked` (bool)
      в API пользователей; ключи контента совпадают в миграции, `admin.js`,
      `home()` и тестах (`heroTitle`, `heroText`, `commissionTitle`,
      `commissionText`).
- [ ] Тесты: `npm test` (UI+юниты), `test:api` (БД), `format:check`.
- [ ] Нет плейсхолдеров «TODO» в коде плана.




