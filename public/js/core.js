export const state = { user: null, csrfToken: "" };
export function safeReturnPath(next, origin = location.origin) {
  if (typeof next !== "string" || !next.startsWith("/") || next.includes("\\"))
    return "/account";
  try {
    const url = new URL(next, origin);
    return url.origin === origin
      ? url.pathname + url.search + url.hash
      : "/account";
  } catch {
    return "/account";
  }
}
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const safeImage = (u) =>
  typeof u === "string" &&
  /^\/(assets|media)\/[a-zA-Z0-9_./-]+$/.test(u) &&
  !u.includes("..")
    ? u
    : "/assets/placeholder.svg";
export const money = (v) =>
  new Intl.NumberFormat("ru-RU").format(Number(v) || 0) + " ₽";
export const categories = {
  office: "Офисы",
  retail: "Торговые помещения",
  warehouse: "Склады",
  industrial: "Производство",
  free_purpose: "Свободное назначение",
  commercial_land: "Коммерческая земля",
};
export const businessRoles = {
  owner: "Собственник",
  broker: "Брокер",
  tenant: "Арендатор",
};
export const taxLabels = {
  included: "НДС включён",
  excluded: "НДС сверху",
  no_vat: "Без НДС",
  unspecified: "Не указан",
};
export const rate = (p) =>
  money(Math.round(p.price / p.area)) +
  (p.deal === "rent" ? " / м² / мес." : " / м²");
export function propertyFacts(p) {
  const facts = [
    [p.area + " м²", "Площадь"],
    [categories[p.category], "Назначение"],
  ];
  if (p.category !== "commercial_land") {
    if (p.buildingClass)
      facts.push(["Класс " + p.buildingClass, "Класс здания"]);
    if (p.floor !== null && p.floor !== undefined)
      facts.push([p.floor, "Этаж"]);
    if (p.ceilingHeight)
      facts.push([p.ceilingHeight + " м", "Высота потолков"]);
  }
  if (p.powerKw) facts.push([p.powerKw + " кВт", "Мощность"]);
  if (p.parking) facts.push(["Есть", "Парковка"]);
  return facts
    .map(
      ([v, l]) =>
        `<div><strong>${esc(v)}</strong><span class="muted">${l}</span></div>`,
    )
    .join("");
}
export const statuses = {
  draft: "Черновик",
  published: "Опубликовано",
  archived: "В архиве",
};
// When running inside a Vibly preview sandbox, use the real backend URL directly.
const API_BASE =
  typeof location !== "undefined" &&
  location.hostname.endsWith(".vaibly.dev")
    ? "https://477a-oc71-643k.gw-1a.dockhost.net"
    : "";

export async function api(path, options = {}) {
  const onVibly = Boolean(API_BASE);
  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(!onVibly && options.method && options.method !== "GET"
      ? { "X-CSRF-Token": state.csrfToken }
      : {}),
    ...options.headers,
  };
  let response;
  try {
    response = await fetch(API_BASE + "/api" + path, {
      credentials: onVibly ? "omit" : "same-origin",
      ...options,
      headers,
      body:
        options.body && !(options.body instanceof FormData)
          ? JSON.stringify(options.body)
          : options.body,
    });
  } catch {
    throw new Error(
      "Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.",
    );
  }
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Не удалось выполнить действие");
    error.fields = data.fields;
    error.status = response.status;
    throw error;
  }
  if (data.csrfToken) state.csrfToken = data.csrfToken;
  return data;
}
export function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 4500);
}
let navigationTimer;
export function navigate(url) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    location.assign(url);
    return;
  }
  document.body.classList.add("is-leaving");
  clearTimeout(navigationTimer);
  navigationTimer = setTimeout(() => location.assign(url), 130);
}
export function authRequired() {
  if (state.user) return true;
  navigate(
    "/login?next=" + encodeURIComponent(location.pathname + location.search),
  );
  return false;
}
export const field = (name, label, value = "", attrs = "") =>
  `<label class="field">${label}<input name="${name}" value="${esc(value)}" ${attrs}><span class="field-error" data-error="${name}"></span></label>`;
export const select = (name, label, options, value = "") =>
  `<label class="field">${label}<select name="${name}" aria-label="${esc(label)}">${Object.entries(
    options,
  )
    .map(
      ([k, v]) =>
        `<option value="${esc(k)}" ${String(value ?? "") === k ? "selected" : ""}>${esc(v)}</option>`,
    )
    .join(
      "",
    )}</select><span class="field-error" data-error="${name}"></span></label>`;
export function errors(form, error) {
  const box =
    form.querySelector(":scope > .form-error") ||
    form.querySelector(".form-error");
  if (box) {
    box.textContent = error.message;
    box.focus();
  }
  form.querySelectorAll("[data-error]").forEach((el) => {
    const message = error.fields?.[el.dataset.error];
    el.textContent = Array.isArray(message)
      ? message.join(", ")
      : message || "";
  });
}
export function busy(form, on) {
  form
    .querySelectorAll('button[type="submit"]')
    .forEach((b) => (b.disabled = on));
  form.setAttribute("aria-busy", String(on));
}
export function card(p, manage = false) {
  return `<article class="property-card"><div class="card-photo"><a href="/property/${encodeURIComponent(p.id)}"><img src="${safeImage(p.cover)}" alt="${esc(p.title)}" loading="lazy" width="600" height="420"></a><button class="heart ${p.isFavorite ? "active" : ""}" data-favorite="${esc(p.id)}" data-active="${!!p.isFavorite}" aria-label="${p.isFavorite ? "Убрать из избранного" : "Добавить в избранное"}" aria-pressed="${!!p.isFavorite}">${p.isFavorite ? "♥" : "♡"}</button></div><div class="card-body"><div class="card-kind">${p.deal === "rent" ? "Аренда" : "Продажа"} · ${esc(categories[p.category])}</div><div class="card-price">${money(p.price)}${p.deal === "rent" ? "<small> / месяц</small>" : ""}</div><p class="card-rate">${rate(p)}</p><a class="card-title" href="/property/${encodeURIComponent(p.id)}">${esc(p.title)}</a><p class="card-address">${esc(p.city)} · ${esc(p.address)}</p><div class="card-meta"><span>${esc(p.area)} м²</span>${p.buildingClass && p.category !== "commercial_land" ? `<span>Класс ${esc(p.buildingClass)}</span>` : ""}${p.floor !== null && p.floor !== undefined && p.category !== "commercial_land" ? `<span>Этаж ${esc(p.floor)}</span>` : ""}${p.ceilingHeight && ["warehouse", "industrial"].includes(p.category) ? `<span>Потолки ${esc(p.ceilingHeight)} м</span>` : ""}</div>${manage ? `<div class="manage"><span class="status">${esc(statuses[p.status])}</span><a href="/edit/${encodeURIComponent(p.id)}">Изменить</a>${p.status === "published" ? `<button data-archive="${esc(p.id)}">В архив</button>` : ""}<button class="danger-link" data-delete="${esc(p.id)}">Удалить</button></div>` : ""}</div></article>`;
}
export const empty = (
  title,
  body,
  href = "/catalog",
  label = "Открыть каталог",
) =>
  `<div class="empty"><span class="empty-mark">место.</span><h2>${esc(title)}</h2><p>${esc(body)}</p><a class="button" href="${href}">${label}</a></div>`;
export function wireFavorites(root = document) {
  root.querySelectorAll("[data-favorite]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!authRequired()) return;
      b.disabled = true;
      try {
        const active = b.dataset.active === "true";
        await api("/favorites/" + encodeURIComponent(b.dataset.favorite), {
          method: active ? "DELETE" : "POST",
        });
        b.dataset.active = String(!active);
        b.classList.toggle("active", !active);
        b.textContent = active ? "♡" : "♥";
        b.setAttribute("aria-pressed", String(!active));
        b.setAttribute(
          "aria-label",
          active ? "Добавить в избранное" : "Убрать из избранного",
        );
        toast(active ? "Удалено из избранного" : "Сохранено в избранное");
      } catch (e) {
        toast(e.message);
      } finally {
        b.disabled = false;
      }
    }),
  );
}
