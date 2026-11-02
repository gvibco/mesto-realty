import { api } from "./core.js";

let cache;
let pending;

// Тексты грузятся один раз за сессию страницы. При ошибке кеш сбрасывается,
// чтобы следующая навигация попробовала снова.
export function loadContent() {
  pending ||= api("/content").then(
    (data) => {
      cache = data;
      return data;
    },
    (error) => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}

export function contentValue(key, fallback = "") {
  return cache?.[key] || fallback;
}

export function applyContent(root = document) {
  if (!cache) return;
  root.querySelectorAll("[data-content]").forEach((element) => {
    const value = cache[element.dataset.content];
    if (value) element.textContent = value;
  });
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (cache.metaTitle && (path === "/" || path === "/catalog"))
    document.title = cache.metaTitle;
  const description = document.querySelector('meta[name="description"]');
  if (description && cache.metaDescription)
    description.content = cache.metaDescription;
}

export async function applyContentFromServer() {
  try {
    await loadContent();
    applyContent();
  } catch {
    /* остаются тексты по умолчанию из разметки */
  }
}
