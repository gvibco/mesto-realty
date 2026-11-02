# План: hero, комиссия за аренду, ИИ, админы и тексты

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 7 правок: убрать спиннеры чисел, ввести 40% комиссии за аренду, вынести ИИ в hero и поиск, сократить заголовки, обновить иконку темы, дать админке назначение админов и редактирование маркетинговых текстов, затем проверить и задеплоить.

**Architecture:** Расширяем существующие слои: константы комиссии во фронтенде, реестр контента на сервере + `data-content` на фронтенде, флаг `users.is_admin` в БД, SVG-иконки вместо эмодзи. Новые модули: `server/content-fields.js`, `public/js/content.js`, миграция `007`.

**Tech Stack:** Node.js 22, Express 5, PostgreSQL, vanilla JS, Playwright, node:test.

## Global Constraints

- Комиссия: продажа 1%, аренда 40% месячной ставки, разово.
- Размещение объявлений бесплатно — сохраняется.
- Все пользовательские значения экранируются `esc()`, SQL параметризован.
- Стиль кода: Prettier, двойные кавычки, точки с запятой.
- Не менять функциональные подписи полей и ошибки валидации.

---

### Task 1: Спиннеры чисел

**Files:**

- Modify: `public/styles.css`
- Test: `tests/commission-ui.test.js`, `tests/ui-security.test.js`

- [ ] Добавить CSS:

```css
input[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
```

- [ ] Проверить `npm run format:check` и страницу каталога в браузере.

### Task 2: Комиссия 40% за аренду

**Files:**

- Modify: `public/js/core.js` (константы `COMMISSION`, `commissionFor`)
- Modify: `public/js/app.js` (hero, блок комиссии, карточка объекта)
- Modify: `server/admin.js` / `server/content-fields.js` (дефолтные тексты)
- Modify: `public/index.html` (title/description)
- Modify: `README.md`, `docs/superpowers/specs/2026-10-31-*.md` (актуальность)
- Test: `tests/commission-ui.test.js`

- [ ] RED: тест аренды ожидает `.commission-note` с «40%» и суммой `60 000 ₽` для ставки 150 000.
- [ ] GREEN: `COMMISSION.rent = 0.4`; карточка аренды выводит строку.
- [ ] Обновить тексты героя/комиссии/фактов.
- [ ] `npm test` — зелёный.

### Task 3: ИИ в поиске и hero

**Files:**

- Modify: `public/js/assistant.js` (открытие по `[data-assistant-open]`, скрытие плавающей кнопки на `/`)
- Modify: `public/js/app.js` (hero-кнопка, строка под поиском)
- Modify: `public/styles.css` (hero-actions, search-hint, `#assistant.home .assistant-launch`)
- Test: `tests/assistant-ui.test.js` (новый)

- [ ] RED: тест: на `/` есть `[data-assistant-open]` в hero, плавающая кнопка скрыта; клик открывает `#assistant-panel`.
- [ ] GREEN: реализовать делегирование и разметку.
- [ ] Тест на другой странице: плавающая кнопка видима.

### Task 4: Минималистичные заголовки 4U

**Files:**

- Modify: `public/js/app.js` (hero, секции, каталог)
- Modify: `public/styles.css` (размер H1)
- Modify: `public/index.html` (title/description)
- Test: `tests/commission-ui.test.js`; вёрстка H1 проверяется визуально на 1280px и 390px.

- [ ] RED: тест блока комиссии фиксирует новый текст; короткий H1 и отсутствие переносов проверяются визуально.
- [ ] GREEN: заменить тексты, уменьшить `clamp` H1.
- [ ] Проверить отсутствие переносов более 2 строк на 1280px.

### Task 5: SVG-иконка темы

**Files:**

- Modify: `public/index.html` (две SVG)
- Modify: `public/js/theme.js` (только aria-label)
- Modify: `public/styles.css` (показ по теме, hover)
- Test: `tests/theme-ui.test.js`

- [ ] RED: тест проверяет видимость `.theme-icon-moon` / `.theme-icon-sun` по теме.
- [ ] GREEN: реализовать.
- [ ] Тест переключения темы остаётся зелёным.

### Task 6: Админы в БД

**Files:**

- Create: `migrations/007_admins.sql`
- Modify: `server/security.js`, `server/auth.js`, `server/admin.js`
- Modify: `public/js/admin.js`
- Test: `tests/admin-api.test.js`, `tests/admin-ui.test.js`

- [ ] RED: API-тест: админ назначает пользователя админом; пользователь получает доступ к `/api/admin/stats`; самоснятие 422; снятие с `ADMIN_EMAIL` 422.
- [ ] GREEN: миграция + проверки + UI-кнопки.
- [ ] `npm run test:api` — зелёный.

### Task 7: Редактор маркетинговых текстов

**Files:**

- Create: `server/content-fields.js`, `public/js/content.js`
- Modify: `server/admin.js`, `public/js/admin.js`, `public/js/app.js`,
  `public/js/forms.js`, `public/index.html`, `public/styles.css`
- Test: `tests/commission-ui.test.js`, `tests/ui-security.test.js`

- [ ] RED: тест подстановки `data-content` из `/api/content`; тест автоформы по группам.
- [ ] GREEN: реестр, публичный контент, `applyContent`, разметка.
- [ ] Проверить, что PUT без ключей → 422, с полным набором → 200.

### Task 8: Документация и проверка

**Files:**

- Modify: `README.md`, `.env.example` (если нужно)
- Test: все прогоны

- [ ] `npm test`, `npm run test:api`, `npm run test:browser`, `npm run format:check`.
- [ ] `quality-reviewer` аудит; исправить находки.
- [ ] `npm run preflight`.
- [ ] `git push origin main`, сборка Dockhost, `npm run verify:live`.
- [ ] Повторный `quality-reviewer`.
