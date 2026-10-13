# План: 3D по чертежу без фото + тестовый импорт с Циана

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Архитектурная 3D-модель генерируется по плану этажа и габаритам без обязательных фотографий; цепочка проверяется на реальном объявлении с Циана, импортированном на сайт.

**Architecture:** Минимальные правки существующего конвейера (вариант A из спеки): убрать требование фото из условия постановки в очередь и из обоих путей анализа. Воркер уже поддерживает пустой список фото. Импорт — разовый скрипт через публичный REST API.

**Tech Stack:** Node.js 22 (ESM), Express 5, PostgreSQL, supertest/node:test, PowerShell, браузерные инструменты для Циана.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-10-13-plan-only-architecture-design.md`.
- Не менять Gaussian-splat конвейер (`room-models.js`) и требование ≥1 фото для публикации объявления.
- Миграций БД нет.
- В PowerShell с запретом `.ps1` использовать `npm.cmd`/`npx.cmd`.
- **Без `git commit`** — коммиты только по явному запросу пользователя.
- Тесты API требуют `TEST_DATABASE_URL` на базу с суффиксом `_test`.

---

### Task 1: Сервер — очередь и анализ без фотографий

**Files:**
- Modify: `server/architectural-store.js:46-52`
- Modify: `server/architectural-models.js:513-518`
- Modify: `server/architectural-analysis.js:90-100`
- Test: `tests/architectural-api.test.js`

**Interfaces:**
- Consumes: существующие `queueArchitecturalModel(client, propertyId)`, роут `/internal/architectural-models/:id/analyze`, `analyzeFloorPlan({plan, photos, dimensions}, config)`.
- Produces: состояние `queued` при плане+габаритах без фото; `photos` может быть `[]` в обоих путях анализа.

- [ ] **Step 1: Обновить тест — план+размеры без фото дают `queued` и рабочий `/analyze`**

В `tests/architectural-api.test.js`:

1. В секции создания stub-анализа (строки 50-59) добавить запись последних фото:

```js
const instance = createApp({
    architecture: {
      analyze: async ({ photos }) => {
        lastPhotos = photos;
        analyses++;
        analysisStarted?.();
        if (analysisGate) await analysisGate;
        return scene;
      },
    },
  }),
```

и в объявлении переменных (строка 23) добавить `lastPhotos`:

```js
let analyses = 0,
  analysisGate,
  analysisStarted,
  lastPhotos;
```

2. После загрузки плана (после строки 123, `.expect(200)` роута `base + "/plan"`) вставить plan-only прогон:

```js
  assert.equal(
    (await owner.get(base)).body.model.state,
    "queued",
    "plan and dimensions without photos must queue the model",
  );
  const planOnly = (await worker("/claim").send({}).expect(200)).body.job;
  assert.deepEqual(planOnly.images, []);
  await worker("/" + propertyId + "/analyze").send(planOnly).expect(200);
  assert.deepEqual(lastPhotos, []);
  assert.equal((await owner.get(base)).body.model.state, "ready");
```

3. Существующее утверждение после загрузки фото (строка 130) оставить — состояние снова `queued` после ревизии. Счётчик на строке 150 изменить с `assert.equal(analyses, 1)` на `assert.equal(analyses, 2)` (plan-only прогон — первый анализ).

- [ ] **Step 2: Запустить тест, убедиться в падении**

Run: `node --test tests/architectural-api.test.js`
Expected: FAIL — состояние `needs_inputs` вместо `queued` после загрузки плана.

- [ ] **Step 3: Убрать требование фото из условия очереди**

В `server/architectural-store.js` заменить:

```js
  const ready =
    p?.category !== "commercial_land" &&
    images.length > 0 &&
    input?.plan_filename &&
    input.width &&
    input.depth &&
    input.height;
```

на:

```js
  const ready =
    p?.category !== "commercial_land" &&
    input?.plan_filename &&
    input.width &&
    input.depth &&
    input.height;
```

- [ ] **Step 4: Разрешить пустые фото в `/analyze`**

В `server/architectural-models.js` заменить:

```js
          if (
            !planPattern.test(row.plan_filename) ||
            images.length !== row.image_ids.length ||
            !images.length
          )
```

на:

```js
          if (
            !planPattern.test(row.plan_filename) ||
            images.length !== row.image_ids.length
          )
```

- [ ] **Step 5: Разрешить пустые фото в облачном анализе**

В `server/architectural-analysis.js` заменить:

```js
  if (
    !plan ||
    photos.length < 1 ||
    images.some(
```

на:

```js
  if (
    !plan ||
    images.some(
```

- [ ] **Step 6: Прогнать тесты**

Run: `node --test tests/architectural-api.test.js` затем `npm test`
Expected: PASS.

---

### Task 2: Тексты UI и документация

**Files:**
- Modify: `public/js/architectural-inputs.js:7`
- Modify: `public/js/architectural-model.js:16,25`
- Modify: `public/js/forms.js:201-202`
- Modify: `docs/architectural-models.md:5`

**Interfaces:**
- Consumes: Task 1 (фото необязательны).
- Produces: нет кода для других задач.

- [ ] **Step 1: `architectural-inputs.js` — help-текст**

Заменить в строке шаблона фрагмент:

`После сохранения планировка в 3D создаётся автоматически по плану и фотографиям.`

на:

`После сохранения планировка в 3D создаётся автоматически по плану и размерам. Фотографии необязательны: они только уточняют типы мебели.`

- [ ] **Step 2: `architectural-model.js` — сообщения состояний**

`processing`: `Создаём архитектурную модель по плану, фотографиям и размерам.` → `Создаём архитектурную модель по плану и размерам помещения.`

`none`: `Добавьте план, размеры и фотографии: 3D-планировка создаётся автоматически.` → `Добавьте план и размеры помещения: 3D-планировка создаётся автоматически.`

Состояние `needs_photos` сервер не возвращает — не трогаем.

- [ ] **Step 3: `forms.js` — подсказка редактора (строка 202)**

Заменить на:

```js
    "Для архитектурной 3D-планировки добавьте план этажа и общие размеры помещения. Модель создаётся автоматически после сохранения; фотографии уточняют мебель, но не обязательны.";
```

- [ ] **Step 4: `docs/architectural-models.md`**

Заменить предложение `At least one photograph is needed.` на `Photographs are optional: when present they refine furniture types, but the plan and dimensions alone are enough to queue generation.`

- [ ] **Step 5: Прогнать UI-тесты и форматирование**

Run: `node --test tests/room-model-ui.test.js tests/navigation-ui.test.js` и `npm run format:check`
Expected: PASS (строки длинные — при замечании prettier прогнать `npx.cmd prettier --write public/js`).

---

### Task 3: Скрипт импорта `scripts/import-listing.js`

**Files:**
- Create: `scripts/import-listing.js`

**Interfaces:**
- Consumes: REST API сайта (`/api/auth/session`, `/api/auth/register`, `/api/auth/login`, `/api/properties`, `/api/properties/:id/images`, `/api/properties/:id/architecture/plan`, `/api/properties/:id/architecture/input`, PATCH `/api/properties/:id`).
- Produces: опубликованное объявление; выводит в stdout `PROPERTY_ID=<id>`.

- [ ] **Step 1: Написать скрипт**

CLI: `node scripts/import-listing.js <manifest.json> [baseUrl]` (baseUrl по умолчанию `http://localhost:3000`). Манифест:

```json
{
  "title": "...", "deal": "sale", "category": "office",
  "city": "...", "district": "...", "address": "...",
  "price": 12300000, "area": 45.6, "description": "...",
  "contactName": "...", "contactPhone": "+79990001122",
  "buildingClass": "B", "floor": 3, "ceilingHeight": 3.2,
  "powerKw": 15, "parking": true, "tax": "included",
  "dimensions": { "width": 8.2, "depth": 5.6, "height": 3.2 },
  "photos": ["photo1.jpg"], "plan": "plan.jpg"
}
```

Пути изображений — относительно каталога манифеста. Логика: cookie-jar вручную (заголовок `set-cookie`), CSRF из `/api/auth/session`; `register` (email `import.demo@example.com`, пароль из `IMPORT_DEMO_PASSWORD`, по умолчанию `Import-demo-` + 16 hex от `crypto.randomBytes(8)`); при ответе 4xx — `login`. Создать черновик (в описание дописать `\n\nТестовый импорт с Циана, данные демонстрационные.`), загрузить фото, план, PUT габаритов, PATCH `{"status":"published"}`. Тип поля файлов: фото — повторяющееся поле `images`, план — поле `plan`. FormData/Blob из Node 22, `mime` по расширению (jpg→image/jpeg, png→image/png, webp→image/webp).

- [ ] **Step 2: Проверка синтаксиса**

Run: `node --check scripts/import-listing.js`
Expected: без вывода.

(Живой прогон — в Task 5, когда есть данные Циана и запущенный сайт.)

---

### Task 4: Сбор данных с Циана

**Files:**
- Create: `output/cian-import/manifest.json` + изображения (каталог не коммитится)

- [ ] **Step 1: Через `tools.browser.tabs.open` открыть поиск Циана `https://www.cian.ru/cat.php?deal_type=sale&engine_version=2&offer_type=offices` (продажа помещений), при капче/блокировке — решить в открытой вкладке или сменить регион.**
- [ ] **Step 2: Выбрать случайное объявление, у которого среди фотографий есть планировка. Извлечь: заголовок, цену, площадь, город/район/адрес, описание, этаж, высоту потолков, класс здания, парковку, НДС, телефон/имя (если видимы без звонка).**
- [ ] **Step 3: Скачать до 8 фотографий и изображение планировки в `output/cian-import/` (curl с Referer `https://www.cian.ru/`).**
- [ ] **Step 4: Заполнить `manifest.json`. Габариты: высота = потолки объявления (или 3.0); width/depth — из площади и пропорций плана (width = round(sqrt(area*ratio),1), depth = round(area/width,1)).**

---

### Task 5: Живая проверка

**Files:** нет (только запуск и проверки)

- [ ] **Step 1: Окружение:** `docker compose up -d db`, `npm run db:migrate`; убедиться, что в `.env` задан `ROOM_MODEL_WORKER_TOKEN` (≥32 символов; если нет — сгенерировать и дописать в `.env`, перезапустить сервер). Запустить `npm start` в фоне, проверить `GET /api/health`.
- [ ] **Step 2: Импорт:** `node scripts/import-listing.js output/cian-import/manifest.json` → записать `PROPERTY_ID`. Открыть `/property/<id>` в браузере: поля, фото, галерея.
- [ ] **Step 3: Stub-прогон:** забрать задание `POST /internal/architectural-models/claim` (Bearer токен), отправить в `/complete` валидную сцену-прямоугольник под габариты манифеста (форма — как `scene` в `tests/architectural-api.test.js`, с width/depth/height из манифеста). Открыть страницу объекта — 3D-планировка отображается (кнопка «Открыть 3D-планировку»).
- [ ] **Step 4: Реальная генерация:** `docker compose --project-directory worker -f worker/compose.yaml ps`. Если `room-model-worker` и `room-model-vision` запущены — повторно загрузить план через API (ревизия → новая очередь), дождаться `state=ready` (опрос `GET /api/properties/<id>/architecture` под сессией импорт-аккаунта, тайм-аут 30 минут), проверить модель в браузере. Если контейнеры не запущены — зафиксировать в отчёте.
- [ ] **Step 5: Финальные проверки:** `npm test`, `npm run test:api`. Отчёт в `docs/plan-only-verification.md`: что проверено, скриншоты/статусы, ограничения.

---

## Self-Review

- Покрытие спеки: раздел 1 → Task 1-2; раздел 2 → Task 3-4; раздел 3 → Task 5. Критерии приёмки → Task 5 Step 5.
- Placeholders: нет; единственные неизвестные заранее — данные Циана (Task 4, по своей природе собираются вручную).
- Согласованность типов: `analyze({plan, photos, dimensions}, config)` совпадает с сигнатурой в `architectural-models.js:544`; поля манифеста совпадают с полями `POST /api/properties` из README.
