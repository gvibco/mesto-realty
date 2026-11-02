import {
  state,
  api,
  esc,
  money,
  toast,
  empty,
  errors,
  busy,
  authRequired,
} from "./core.js";
const main = document.querySelector("#main");
const statusLabels = {
  draft: "Черновик",
  published: "Опубликовано",
  archived: "Архив",
};

export async function adminPage() {
  if (!authRequired()) return;
  if (!state.isAdmin) {
    toast("Недостаточно прав");
    location.assign("/");
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
    .join(
      "",
    )}</nav><div id="admin-content"><div class="loading">Загрузка…</div></div></div>`;
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

async function adminProperties(content) {
  const params = new URLSearchParams(location.search);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = params.get("q") || "";
  const status = params.get("status") || "";
  const deal = params.get("deal") || "";
  const data = await api(
    `/admin/properties?page=${page}&limit=12${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${encodeURIComponent(status)}` : ""}${deal ? `&deal=${encodeURIComponent(deal)}` : ""}`,
  );
  const pageHref = (n) => {
    const p = new URLSearchParams({ tab: "properties", page: String(n) });
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (deal) p.set("deal", deal);
    return "/admin?" + p.toString();
  };
  content.innerHTML = `<form class="admin-filters" action="/admin" method="get"><input type="hidden" name="tab" value="properties"><input name="q" value="${esc(q)}" placeholder="Заголовок, город или адрес" aria-label="Поиск объявлений"><select name="status" aria-label="Статус"><option value="">Любой статус</option>${Object.entries(
    statusLabels,
  )
    .map(
      ([value, label]) =>
        `<option value="${value}"${status === value ? " selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select><select name="deal" aria-label="Тип сделки"><option value="">Любая сделка</option><option value="sale"${deal === "sale" ? " selected" : ""}>Продажа</option><option value="rent"${deal === "rent" ? " selected" : ""}>Аренда</option></select><button class="button secondary" type="submit">Применить</button></form>${
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
      : empty(
          "Ничего не найдено",
          "Измените фильтры или загляните позже.",
          "/admin?tab=properties",
          "Сбросить фильтры",
        )
  }<nav class="pagination" aria-label="Страницы">${Array.from(
    { length: data.pages },
    (_, i) =>
      `<a class="${i + 1 === data.page ? "active" : ""}" href="${pageHref(i + 1)}">${i + 1}</a>`,
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
        !confirm(
          "Удалить объявление и все его фотографии? Это действие нельзя отменить.",
        )
      )
        return;
      button.disabled = true;
      try {
        await api("/properties/" + button.dataset.delete, {
          method: "DELETE",
        });
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
        `<article class="admin-item"><div><strong>${esc(u.name)}</strong>${u.admin ? ' <span class="admin-status published">Админ</span>' : ""}<p class="muted">${esc(u.email)}${u.company ? ` · ${esc(u.company)}` : ""} · объявлений: ${u.propertyCount} · регистрация ${new Date(u.createdAt).toLocaleDateString("ru-RU")}</p></div><div class="admin-item-actions">${
          u.bootstrap
            ? '<span class="admin-status published">Основной админ</span>'
            : `${
                String(u.id) === String(state.user.id)
                  ? ""
                  : u.admin
                    ? `<button class="button secondary" data-demote="${u.id}">Снять права</button>`
                    : `<button class="button secondary" data-promote="${u.id}">Назначить админом</button>`
              }${
                u.blocked
                  ? `<span class="admin-status archived">Заблокирован</span><button class="button secondary" data-unblock="${u.id}">Разблокировать</button>`
                  : `<button class="button danger" data-block="${u.id}">Заблокировать</button>`
              }`
        }</div></article>`,
    )
    .join("")}</div><nav class="pagination" aria-label="Страницы">${Array.from(
    { length: data.pages },
    (_, i) =>
      `<a class="${i + 1 === data.page ? "active" : ""}" href="/admin?tab=users&page=${i + 1}">${i + 1}</a>`,
  ).join("")}</nav>`;
  const wire = (selector, key, body, message, confirmText) =>
    content.querySelectorAll(selector).forEach((button) => {
      button.onclick = async () => {
        if (confirmText && !confirm(confirmText)) return;
        button.disabled = true;
        try {
          await api("/admin/users/" + button.dataset[key], {
            method: "PATCH",
            body,
          });
          toast(message);
          await adminPage();
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      };
    });
  wire(
    "[data-block]",
    "block",
    { blocked: true },
    "Пользователь заблокирован",
    "Заблокировать пользователя? Он потеряет доступ к аккаунту.",
  );
  wire(
    "[data-unblock]",
    "unblock",
    { blocked: false },
    "Пользователь разблокирован",
  );
  wire("[data-promote]", "promote", { admin: true }, "Права админа выданы");
  wire(
    "[data-demote]",
    "demote",
    { admin: false },
    "Права админа сняты",
    "Снять права администратора? Он потеряет доступ к админ-панели.",
  );
}

async function adminContent(content) {
  const [values, fields] = await Promise.all([
    api("/admin/content"),
    api("/admin/content-fields"),
  ]);
  const groups = new Map();
  for (const field of fields) {
    if (!groups.has(field.group)) groups.set(field.group, []);
    groups.get(field.group).push(field);
  }
  content.innerHTML = `<form id="content-form" class="form-sheet" novalidate>${[
    ...groups,
  ]
    .map(
      ([group, items]) =>
        `<section class="form-section"><h2>${esc(group)}</h2><p class="form-help">Изменения появятся на сайте сразу после сохранения.</p><div class="form-grid">${items
          .map((field) => {
            const value = esc(values[field.key] ?? "");
            const control = field.multiline
              ? `<textarea name="${esc(field.key)}" rows="3" required minlength="${field.min}" maxlength="${field.max}">${value}</textarea>`
              : `<input name="${esc(field.key)}" value="${value}" required minlength="${field.min}" maxlength="${field.max}">`;
            return `<label class="field full">${esc(field.label)}${control}<span class="field-error" data-error="${esc(field.key)}"></span></label>`;
          })
          .join("")}</div></section>`,
    )
    .join(
      "",
    )}<div class="form-error" role="alert" tabindex="-1"></div><div class="form-actions"><button class="button" type="submit">Сохранить тексты</button></div></form>`;
  const form = document.querySelector("#content-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    busy(form, true);
    try {
      await api("/admin/content", {
        method: "PUT",
        body: Object.fromEntries(new FormData(form)),
      });
      toast("Тексты сайта сохранены");
    } catch (error) {
      errors(form, error);
    } finally {
      busy(form, false);
    }
  };
}
