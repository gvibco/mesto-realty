# Mobile Arrow & Tariff Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the mobile appearance of arrow links near "Открыть каталог" and similar text, and make pricing cards selectable with a smooth animation.

**Architecture:** Use CSS pseudo-elements for arrows instead of inline characters; add click handlers on `.pricing-card` elements that toggle a `selected` class; use CSS transitions and a keyframe pulse for animation. Keep the existing subscription form button behavior unchanged.

**Tech Stack:** HTML generated in `public/js/app.js`, styles in `public/styles.css`, no frontend frameworks.

## Global Constraints

- Keep changes minimal and scoped to the two UI improvements.
- Follow existing CSS variable naming and color palette.
- No new dependencies.
- Run `npm test` before pushing.
- Push to GitHub after tests pass.

---

### Task 1: Replace inline arrows with pseudo-elements

**Files:**
- Modify: `public/js/app.js:126`
- Modify: `public/js/app.js:131` (category links)
- Modify: `public/js/app.js:131` (city links)
- Modify: `public/index.html:60` (header catalog link)

**Interfaces:**
- Consumes: existing `.hero-link`, `.category-link`, `.city-link` markup.
- Produces: links without inline `↗` spans, styled by a shared `.arrow-link` class or equivalent CSS.

- [ ] **Step 1: Update `hero-link` markup**

In `public/js/app.js` around line 126, change:
```js
<a class="hero-link" href="/catalog">Открыть каталог <span aria-hidden="true">↗</span></a>
```
to:
```js
<a class="hero-link arrow-link" href="/catalog">Открыть каталог</a>
```

- [ ] **Step 2: Update category links**

In the `category-link` template in `public/js/app.js`:
```js
`<a class="category-link arrow-link" href="/catalog?category=${key}"><strong>${label}</strong><span class="category-purpose">${purpose[key]}</span></a>`,
```
Remove the `<span class="category-arrow">↗</span>`.

- [ ] **Step 3: Update city links**

In the `city-link` template:
```js
`<a class="city-link arrow-link" href="/catalog?q=${encodeURIComponent(city)}">${city}</a>`
```

- [ ] **Step 4: Update header catalog link**

In `public/index.html` around line 60, change:
```html
<a href="/catalog">Каталог объектов ↗</a>
```
to:
```html
<a class="arrow-link" href="/catalog">Каталог объектов</a>
```

---

### Task 2: Add arrow-link styles

**Files:**
- Modify: `public/styles.css` after `.hero-link` styles and after `.category-arrow` styles

**Interfaces:**
- Consumes: `.arrow-link` class added in Task 1.
- Produces: visually consistent arrows across desktop and mobile.

- [ ] **Step 1: Add base `.arrow-link` rule**

Add after `.hero-link span` (line 473):
```css
.arrow-link::after {
  content: "↗";
  display: inline-block;
  margin-left: 0.45em;
  font-size: 0.95em;
  line-height: 1;
  vertical-align: middle;
  color: var(--blue);
  transition: transform 0.2s ease;
}
.arrow-link:hover::after {
  transform: translate(2px, -2px);
}
```

- [ ] **Step 2: Add mobile arrow sizing**

In the mobile media query (`@media (max-width: 540px)`), add:
```css
.arrow-link::after {
  font-size: 0.8em;
}
```

- [ ] **Step 3: Remove obsolete `.hero-link span` and `.category-arrow` rules**

Remove or comment out:
```css
.hero-link span { ... }
.category-arrow { ... }
```

---

### Task 3: Add tariff card selection logic

**Files:**
- Modify: `public/js/app.js` around line 135 where pricing cards are rendered

**Interfaces:**
- Consumes: existing `.pricing-card`, `.pricing-grid` markup.
- Produces: click handlers that toggle `selected` class on cards.

- [ ] **Step 1: Add click handlers after rendering**

After the existing line:
```js
document.querySelectorAll('.pricing-card').forEach(card => {
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    document.querySelectorAll('.pricing-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
  });
});
```

- [ ] **Step 2: Ensure existing button behavior is preserved**

The existing code in `app.js`:
```js
btn.onclick = () => openSubModal(btn.dataset.tariff);
```
remains unchanged.

---

### Task 4: Add tariff card selection animation CSS

**Files:**
- Modify: `public/styles.css` in the pricing section

**Interfaces:**
- Consumes: `.pricing-card.selected` set by Task 3.
- Produces: animated visual feedback for selection.

- [ ] **Step 1: Add selected styles**

Add after `.pricing-card:hover` (around line 1817):
```css
.pricing-card.selected {
  border-color: var(--blue);
  box-shadow: 0 12px 36px #235ee826;
  transform: translateY(-4px);
}
.pricing-card.selected.featured {
  animation: selectPulse 0.5s ease;
}
```

- [ ] **Step 2: Add keyframes**

Add near the end of the pricing section:
```css
@keyframes selectPulse {
  0% { transform: translateY(-4px) scale(1); }
  40% { transform: translateY(-6px) scale(1.02); }
  100% { transform: translateY(-4px) scale(1); }
}
```

- [ ] **Step 3: Ensure transition includes transform**

Confirm `.pricing-card` already has:
```css
transition: border-color 0.2s, box-shadow 0.2s;
```
If not, add `transform 0.2s`.

---

### Task 5: Run tests and push to GitHub

**Files:**
- No file changes; verification step.

- [ ] **Step 1: Run tests**

Run:
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 2: Stage and commit**

Run:
```bash
git add public/js/app.js public/styles.css public/index.html docs/superpowers/specs/2026-10-12-mobile-arrow-tariff-selection-design.md docs/superpowers/plans/2026-10-12-mobile-arrow-tariff-selection.md
git commit -m "ui: improve mobile arrows and add tariff card selection"
```

- [ ] **Step 3: Push to GitHub**

Run:
```bash
git push
```

---

## Self-Review

- **Spec coverage:** Arrow redesign covered in Tasks 1–2; tariff selection and animation covered in Tasks 3–4; testing and GitHub push covered in Task 5.
- **Placeholder scan:** No TBD/TODO.
- **Type consistency:** Class names `.arrow-link` and `.pricing-card.selected` are consistent across JS and CSS.
