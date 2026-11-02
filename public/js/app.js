import {
  state,
  api,
  esc,
  money,
  safeImage,
  categories,
  businessRoles,
  taxLabels,
  propertyFacts,
  rate,
  card,
  empty,
  wireFavorites,
  field,
  select,
  toast,
  authRequired,
  navigate,
  errors,
  busy,
  commissionFor,
  commissionPercent,
} from "./core.js";
import { initAssistant } from "./assistant.js";
import {
  applyContent,
  applyContentFromServer,
  contentValue,
} from "./content.js";
const main = document.querySelector("#main");
const contentReady = applyContentFromServer();
initAssistant();
const refreshContent = () => contentReady.then(() => applyContent(main));
// Session loads in parallel with the first render so LCP content does not
// wait for the network. Pages await sessionReady before user-specific API
// calls (favorites, account data).
const sessionReady = api("/auth/session")
  .then((session) => {
    Object.assign(state, session);
    header();
  })
  .catch(() => {
    /* Рендерим страницу даже без сессии */
  });
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
const options = { "": "Все назначения", ...categories };

/* ── Pages ── */
async function home() {
  const purpose = {
    office: "Для команды и встреч",
    retail: "Для торговли и сервиса",
    warehouse: "Для хранения и логистики",
    industrial: "Для выпуска продукции",
    free_purpose: "Для вашего формата",
    commercial_land: "Для развития проекта",
  };
  main.innerHTML = `<div class="container hero-wrap"><section class="hero"><div class="hero-content"><div class="eyebrow" data-content="heroEyebrow">Коммерческая недвижимость для бизнеса</div><h1 id="hero-title" data-content="heroTitle">Помещение для бизнеса — за 48 часов</h1><p id="hero-text" data-content="heroText">Офисы, склады и торговые площади от собственников. Комиссия только при сделке: 1% с покупки, 40% месячной аренды.</p><div class="hero-actions"><button class="button hero-ai" type="button" data-assistant-open><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z"/><path d="M19 16.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z"/></svg><span data-content="heroAssistantCta">Подобрать с ИИ</span></button><a class="hero-link arrow-link" href="/catalog" data-content="heroCatalogCta">Открыть каталог</a></div></div><img class="hero-image" src="/assets/hero.webp" srcset="/assets/hero-800.webp 800w, /assets/hero-1200.webp 1200w, /assets/hero-1600.webp 1600w" sizes="(max-width: 800px) 100vw, 50vw" alt="Архитектура современного делового центра" width="1600" height="1067" fetchpriority="high"></section><form class="search-panel" action="/catalog"><div class="deal-tabs"><label><input type="radio" name="deal" value="rent" checked>Аренда</label><label><input type="radio" name="deal" value="sale">Покупка</label></div><div class="search-row">${field("q", "Город или район", "", 'placeholder="Например, Москва"')}${select("category", "Назначение объекта", options)}${field("maxPrice", "Бюджет до, ₽", "", 'type="number" min="1" step="0.01" placeholder="Не ограничен"')}<button class="button arrow-link" type="submit">Найти объект</button></div><p class="search-hint"><span data-content="searchHint">ИИ-помощник подберёт лучшие объекты под ваш запрос — город, бюджет, площадь и назначение</span><button type="button" class="link-button" data-assistant-open data-content="searchHintCta">Подобрать с ИИ</button></p></form><section class="category-section"><div class="section-heading"><h2 data-content="categoriesTitle">Под задачу бизнеса</h2></div><nav class="categories" aria-label="Назначение объекта">${Object.entries(
    categories,
  )
    .map(
      ([key, label]) =>
        `<a class="category-link arrow-link" href="/catalog?category=${key}"><strong>${label}</strong><span class="category-purpose">${purpose[key]}</span></a>`,
    )
    .join(
      "",
    )}</nav></section><section class="listing-section"><div class="section-heading"><div><h2 data-content="listingsTitle">Новые объекты</h2><p data-content="listingsText">Свежие предложения с ценой и площадью</p></div><a class="arrow-link" href="/catalog" data-content="listingsLink">Весь каталог</a></div><div id="home-listings" class="grid"><div class="loading">Загружаем объекты…</div></div></section><section class="city-section"><div class="section-heading"><div><h2 data-content="citiesTitle">Выберите город</h2><p data-content="citiesText">Объекты с ценой и площадью в вашем городе</p></div></div><div class="city-grid">${["Москва", "Санкт-Петербург", "Казань", "Сочи"].map((city) => `<a class="city-link arrow-link" href="/catalog?q=${encodeURIComponent(city)}">${city}</a>`).join("")}</div></section><section class="commission-section"><div class="section-heading"><div><h2 id="commission-title" data-content="commissionTitle">Как мы зарабатываем</h2><p id="commission-text" data-content="commissionText">Комиссия только при сделке: 1% с покупки, 40% месячной аренды. Размещение объявлений бесплатно.</p></div></div><div class="commission-facts"><div class="commission-fact"><b>0 ₽</b><span data-content="commissionFactListings">размещение объявлений</span></div><div class="commission-fact"><b>${commissionPercent("rent")}%</b><span data-content="commissionFactRent">месячной аренды</span></div><div class="commission-fact"><b>${commissionPercent("sale")}%</b><span data-content="commissionFactSale">с покупки</span></div></div></section><section class="publish-banner"><div><span class="banner-label" data-content="bannerLabel">Собственникам и брокерам</span><h2 data-content="bannerTitle">Разместите объект бесплатно</h2><p data-content="bannerText">Получайте обращения от компаний. Добавьте параметры, условия сделки и фотографии.</p></div><a class="button arrow-link" href="/publish" data-content="bannerCta">Разместить объект</a></section></div>`;

  try {
    await sessionReady;
    const data = await api("/properties?sort=newest&limit=6");
    document.querySelector("#home-listings").innerHTML = data.items.length
      ? data.items.map((p) => card(p)).join("")
      : empty(
          "Каталог открыт для ваших объектов",
          "Предложите офис, торговую площадь или склад для бизнеса.",
          "/publish",
          "Разместить объявление",
        );
    wireFavorites();
  } catch (e) {
    document.querySelector("#home-listings").innerHTML =
      `<div class="error-panel full"><p>${esc(e.message)}</p><a class="button secondary" href="/">Повторить</a></div>`;
  }
  // Тексты редактируются в админ-панели: дефолты уже в разметке (нет скачков
  // LCP), при отличии заменяем из /api/content.
  await refreshContent();
}
async function catalog() {
  const q = new URLSearchParams(location.search);
  for (const [key, value] of [...q]) if (!value) q.delete(key);
  q.delete("rooms");
  if (q.has("category") && !Object.hasOwn(categories, q.get("category")))
    q.delete("category");
  history.replaceState({}, "", "/catalog" + (q.size ? "?" + q : ""));
  main.innerHTML = `<div class="container page"><div class="breadcrumb"><a href="/">Главная</a> / Каталог</div><div class="page-intro"><h1 data-content="catalogTitle">Коммерческая недвижимость</h1><p data-content="catalogText">Офисы, склады и торговые площади — фильтры по цене и площади</p></div><div class="catalog-layout"><form class="filters" action="/catalog"><h3 class="full" data-content="catalogFiltersTitle">Параметры поиска</h3>${field("q", "Город, район или адрес", q.get("q"), 'placeholder="Например, Москва"')}${select("deal", "Сделка", { "": "Любая", sale: "Покупка", rent: "Аренда" }, q.get("deal"))}${select("category", "Назначение объекта", options, q.get("category"))}<div class="pair">${field("minPrice", "Цена от, ₽", q.get("minPrice"), 'type="number" min="0" step="0.01"')}${field("maxPrice", "Цена до, ₽", q.get("maxPrice"), 'type="number" min="0" step="0.01"')}</div><div class="pair">${field("minArea", "Площадь от, м²", q.get("minArea"), 'type="number" min="0" step="0.01"')}${field("maxArea", "До, м²", q.get("maxArea"), 'type="number" min="0" step="0.01"')}</div>${select("buildingClass", "Класс здания", { "": "Любой", A: "A", B: "B", C: "C" }, q.get("buildingClass"))}${field("minCeilingHeight", "Потолки от, м", q.get("minCeilingHeight"), 'type="number" min="0.01" max="50" step="0.01"')}${field("minPowerKw", "Мощность от, кВт", q.get("minPowerKw"), 'type="number" min="0.01" max="100000" step="0.01"')}${select("parking", "Парковка", { "": "Не важно", true: "Есть", false: "Нет" }, q.get("parking"))}<input type="hidden" name="sort" value="${esc(q.get("sort") || "newest")}">${q.get("owner") ? `<input type="hidden" name="owner" value="${esc(q.get("owner"))}">` : ""}<button class="button" type="submit" data-content="catalogSubmit">Показать объявления</button><a class="muted" href="/catalog" data-content="catalogReset">Сбросить фильтры</a></form><section class="catalog-content"><div class="result-bar"><span id="result-count">Ищем объявления…</span><label> <span class="sr-only">Сортировка</span><select id="sort" aria-label="Сортировка"><option value="newest">Сначала новые</option><option value="price_asc">Сначала дешевле</option><option value="price_desc">Сначала дороже</option></select></label></div><div id="results" class="grid"><div class="loading">Загрузка…</div></div><nav class="pagination" aria-label="Страницы"></nav></section></div></div>`;
  document.querySelector("#sort").value = q.get("sort") || "newest";
  document.querySelector("#sort").onchange = (e) => {
    q.set("sort", e.target.value);
    q.delete("page");
    navigate("/catalog?" + q);
  };
  await sessionReady;
  await refreshContent();
  const data = await api("/properties?" + q);
  document.querySelector("#result-count").textContent =
    `Найдено объявлений: ${data.total}`;
  const results = document.querySelector("#results");
  results.innerHTML = data.items.length
    ? data.items.map((p) => card(p)).join("")
    : empty(
        contentValue("catalogEmptyTitle", "Пока ничего не нашлось"),
        contentValue(
          "catalogEmptyText",
          "Попробуйте увеличить бюджет или выбрать другой район.",
        ),
        "/catalog",
        contentValue("catalogReset", "Сбросить фильтры"),
      );
  for (let p = 1; p <= data.pages; p++) {
    if (
      data.pages > 9 &&
      Math.abs(p - data.page) > 2 &&
      p !== 1 &&
      p !== data.pages
    )
      continue;
    const params = new URLSearchParams(q);
    params.set("page", p);
    document
      .querySelector(".pagination")
      .insertAdjacentHTML(
        "beforeend",
        `<a class="${p === data.page ? "active" : ""}" ${p === data.page ? 'aria-current="page"' : ""} href="/catalog?${esc(params.toString())}">${p}</a>`,
      );
  }
  wireFavorites();
}
async function detail(id) {
  const requestedPath = location.pathname;
  await sessionReady;
  const {
    property: p,
    owner,
    images,
    otherProperties,
  } = await api("/properties/" + encodeURIComponent(id));
  if (location.pathname !== requestedPath) return;
  document.title = p.title + " | Место Бизнес";
  main.innerHTML = `<div class="container page"><div class="breadcrumb"><a href="/">Главная</a> / <a href="/catalog">Каталог</a> / ${esc(p.city)}</div><h1>${esc(p.title)}</h1><p class="muted detail-address">${esc(p.city)}, ${esc(p.district ? p.district + ", " : "")}${esc(p.address)}</p><div class="detail-layout"><div><img class="gallery-main" src="${safeImage(images[0]?.url)}" alt="${esc(p.title)}" width="900" height="620">${images.length > 1 ? `<div class="thumbnails" aria-label="Фотографии">${images.map((im, i) => `<button class="${i === 0 ? "selected" : ""}" data-photo="${safeImage(im.url)}" aria-label="Фото ${i + 1}"><img src="${safeImage(im.url)}" alt="Фото ${i + 1}" width="100" height="72"></button>`).join("")}</div>` : ""}<div class="detail-facts">${propertyFacts(p)}</div><h2 data-content="detailAboutTitle">Об объекте</h2><p class="description">${esc(p.description)}</p><div id="room-model-host" hidden></div></div><aside class="contact-panel"><div class="detail-price">${money(p.price)}${p.deal === "rent" ? '<span class="muted"> / месяц</span>' : ""}</div><p class="muted">${rate(p)}</p><p class="muted">${p.tax && p.tax !== "unspecified" ? taxLabels[p.tax] : "НДС: не указан"}</p>${p.deal === "rent" ? `<p class="commission-note">Комиссия сервиса: ${commissionPercent("rent")}% месячной аренды — ${money(commissionFor(p))}</p>` : `<p class="commission-note">Комиссия сервиса: ${commissionPercent("sale")}% — ${money(commissionFor(p))}</p>`}${p.status !== "published" ? `<p class="muted">${p.status === "draft" ? "Черновик" : "Объявление в архиве"}</p>` : ""}<button id="reveal" class="button">Показать телефон</button><button class="button secondary" id="detail-favorite">${p.isFavorite ? "Убрать из избранного" : "♡ Сохранить в избранное"}</button><div class="owner">${owner.avatar ? `<img class="avatar" src="${safeImage(owner.avatar)}" alt="${esc(owner.name)}">` : `<span class="avatar">${esc(owner.name?.[0] || "М")}</span>`}<div><strong>${esc(owner.company || owner.name)}</strong><p>${esc(businessRoles[owner.businessRole] || "Собственник")}</p>${owner.company || (p.contactName && p.contactName !== owner.name) ? `<p>${esc(p.contactName || owner.name)}</p>` : ""}</div></div>${owner.bio ? `<p class="muted owner-bio">${esc(owner.bio)}</p>` : ""}<a class="button secondary" href="/catalog?owner=${encodeURIComponent(owner.id)}">Объявления автора ↗</a>${state.user?.id === p.ownerId ? `<a class="button secondary" href="/edit/${encodeURIComponent(p.id)}">Редактировать</a>` : ""}</aside></div>${otherProperties?.length ? `<section class="detail-more"><div class="section-heading"><h2>Другие объявления автора</h2></div><div class="grid">${otherProperties.map((item) => card(item)).join("")}</div></section>` : ""}</div>`;
  if (p.category !== "commercial_land") {
    const { mountRoomModel } = await import("./room-model.js");
    mountRoomModel(
      document.querySelector("#room-model-host"),
      id,
      String(state.user?.id) === String(p.ownerId),
      api,
    );
  }
  document.querySelectorAll("[data-photo]").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelector(".gallery-main").src = b.dataset.photo;
        document
          .querySelectorAll("[data-photo]")
          .forEach((x) => x.classList.toggle("selected", x === b));
      }),
  );
  document.querySelector("#reveal").onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const data = await api(
        "/properties/" + encodeURIComponent(id) + "/contact",
      );
      const link = document.createElement("a");
      link.className = "button";
      link.href = "tel:" + String(data.phone).replace(/[^+\d]/g, "");
      link.textContent = data.phone;
      b.replaceWith(link);
    } catch (error) {
      toast(error.message);
      b.disabled = false;
    }
  };
  document.querySelector("#detail-favorite").onclick = async (e) => {
    if (!authRequired()) return;
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await api("/favorites/" + encodeURIComponent(id), {
        method: p.isFavorite ? "DELETE" : "POST",
      });
      p.isFavorite = !p.isFavorite;
      b.textContent = p.isFavorite
        ? "Убрать из избранного"
        : "♡ Сохранить в избранное";
    } catch (error) {
      toast(error.message);
    } finally {
      b.disabled = false;
    }
  };
  wireFavorites();
  await refreshContent();
}
document.addEventListener("submit", (e) => {
  if (e.target.matches('form[action="/catalog"]')) {
    e.preventDefault();
    const params = new URLSearchParams(new FormData(e.target));
    for (const [key, value] of [...params]) if (!value) params.delete(key);
    navigate("/catalog?" + params);
  }
});
document.addEventListener("click", (event) => {
  const link =
    event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (
    !link ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.hasAttribute("download") ||
    (link.target && link.target !== "_self")
  )
    return;
  const destination = new URL(link.href);
  if (
    destination.origin !== location.origin ||
    (destination.pathname === location.pathname &&
      destination.search === location.search &&
      destination.hash)
  )
    return;
  event.preventDefault();
  navigate(destination.href);
});
try {
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (path === "/") await home();
  else if (path === "/catalog") await catalog();
  else if (/^\/property\/[^/]+$/.test(path)) await detail(path.split("/")[2]);
  else if (path === "/login" || path === "/register") {
    const { authPage } = await import("./forms.js");
    authPage(path.slice(1));
  } else if (path === "/account") {
    await sessionReady;
    const { accountPage } = await import("./forms.js");
    await accountPage();
  } else if (path === "/admin") {
    await sessionReady;
    const { adminPage } = await import("./admin.js");
    await adminPage();
  } else if (path === "/publish" || /^\/edit\/[^/]+$/.test(path)) {
    await sessionReady;
    const { editorPage } = await import("./forms.js");
    await editorPage(path.startsWith("/edit/") ? path.split("/")[2] : null);
  } else
    main.innerHTML = `<div class="container page">${empty("Страница не найдена", "Вернитесь в каталог коммерческой недвижимости.")}</div>`;
  await sessionReady;
} catch (error) {
  header();
  main.innerHTML = `<div class="container page"><div class="error-panel"><h1>Не удалось открыть страницу</h1><p>${esc(error.message)}</p><a class="button" href="${esc(location.pathname + location.search)}">Попробовать ещё раз</a> <a class="button secondary" href="/catalog">В каталог</a></div></div>`;
}
