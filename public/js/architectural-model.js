import { esc } from "./core.js";
import { parseArchitecturalScene } from "./architectural-schema.js";

export const validArchitecturalUrl = (url) =>
  typeof url === "string" &&
  /^\/architectural-models\/[a-zA-Z0-9_-]+\/[1-9]\d*\/scene\.json$/.test(url);

export function architecturalMarkup(model, owner = false, propertyId = "") {
  if (!model || (model.state !== "ready" && !owner)) return "";
  if (model.state === "ready" && validArchitecturalUrl(model.url))
    return `<section class="room-model architectural-model" aria-label="Архитектурная модель"><h2>Планировка в 3D</h2><p class="muted">Посмотрите план сверху или зайдите внутрь помещения. Размеры мебели и деталей без замеров приблизительные.</p><button type="button" class="button" data-architecture-open>Открыть 3D-планировку</button><p data-architecture-message role="status" aria-live="polite"></p><div class="room-stage architectural-stage" hidden><div class="room-canvas architectural-canvas" tabindex="0" role="region" aria-label="Архитектурная модель помещения" aria-describedby="architecture-help"></div><div class="room-controls architectural-controls"><button type="button" class="button secondary" data-architecture-mode="top" aria-pressed="true">План сверху</button><button type="button" class="button secondary" data-architecture-mode="inside" aria-pressed="false">Внутри</button><button type="button" class="button secondary" data-architecture-reset>Начальный ракурс</button><button type="button" class="button secondary" data-architecture-fullscreen>На весь экран</button></div><div class="architectural-walk" aria-label="Перемещение внутри" hidden><button type="button" class="button secondary" data-walk="left">Повернуть влево</button><button type="button" class="button secondary" data-walk="forward">Вперёд</button><button type="button" class="button secondary" data-walk="backward">Назад</button><button type="button" class="button secondary" data-walk="right">Повернуть вправо</button></div><p id="architecture-help" class="room-help">Сверху: потяните для поворота, два пальца или колесо — масштаб. Внутри: потяните для осмотра, используйте кнопки или W/A/S/D и стрелки для движения. R — начальный ракурс.</p><ul class="architectural-warnings">${(model.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div></section>`;
  if (!owner) return "";
  const messages = {
    queued: "Планировка добавлена в очередь. Модель появится после обработки.",
    processing: "Создаём архитектурную модель по плану и размерам помещения.",
    needs_inputs:
      "Добавьте план, ширину, глубину и высоту помещения для 3D-планировки.",
    needs_photos:
      "Добавьте хотя бы одну фотографию помещения для 3D-планировки.",
    unavailable:
      "Автоматическое создание модели пока недоступно. План и фотографии сохранены.",
    failed:
      "Не удалось создать планировку. Проверьте план и размеры, затем сохраните изменения.",
    none: "Добавьте план и размеры помещения: 3D-планировка создаётся автоматически.",
  };
  return `<section class="room-model room-model-status architectural-model"><h2>Планировка в 3D</h2><p role="status">${esc(messages[model.state] || messages.none)}</p><a class="room-edit-link" href="/edit/${encodeURIComponent(propertyId)}">План и размеры помещения</a></section>`;
}

export function mountArchitecturalModel(
  host,
  propertyId,
  owner,
  request,
  options = {},
) {
  let disposed = false,
    timer,
    viewer,
    key,
    generation = 0,
    loading = false,
    requestVersion = 0;
  const controller = new AbortController();
  const alive = () => !disposed && host.isConnected;
  const load =
    options.loadLibrary ||
    (() => import("/assets/vendor/architectural-viewer.js"));
  const release = () => {
    viewer?.dispose();
    viewer = null;
  };
  function schedule() {
    clearTimeout(timer);
    if (owner && alive()) timer = setTimeout(refresh, options.pollMs || 15000);
  }
  async function refresh() {
    if (!alive()) return;
    if (document.hidden) {
      schedule();
      return;
    }
    const version = ++requestVersion;
    try {
      const { model } = await request(
        "/properties/" + encodeURIComponent(propertyId) + "/architecture",
        { signal: controller.signal },
      );
      if (!alive() || version !== requestVersion) return;
      const next = JSON.stringify(model);
      if (key !== next) {
        key = next;
        generation++;
        loading = false;
        release();
        host.innerHTML = architecturalMarkup(model, owner, propertyId);
        host.hidden = !host.innerHTML;
        if (model?.state === "ready" && validArchitecturalUrl(model.url))
          wire(model);
      }
    } catch {
      if (alive() && owner && key === undefined) {
        host.hidden = false;
        host.innerHTML =
          '<p class="room-model muted" role="status">Не удалось проверить планировку. Повторим проверку автоматически.</p>';
      }
    } finally {
      if (version === requestVersion) schedule();
    }
  }
  function wire(model) {
    const open = host.querySelector("[data-architecture-open]");
    open.onclick = async () => {
      if (loading || viewer) return;
      loading = true;
      open.disabled = true;
      const revision = generation,
        valid = () => alive() && revision === generation;
      const message = host.querySelector("[data-architecture-message]"),
        stage = host.querySelector(".architectural-stage"),
        canvas = host.querySelector(".architectural-canvas");
      message.textContent = "Загружаем 3D-планировку…";
      let instance;
      try {
        const response = await fetch(model.url, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Artifact unavailable");
        const text = await response.text();
        if (new TextEncoder().encode(text).length > 1024 * 1024)
          throw new Error("Scene too large");
        const scene = parseArchitecturalScene(JSON.parse(text));
        const library = await load();
        if (!valid()) return;
        stage.hidden = false;
        instance = library.createArchitecturalViewer(canvas, scene);
        viewer = instance;
        if (!valid()) {
          instance.dispose();
          return;
        }
        open.hidden = true;
        message.textContent = "3D-планировка готова";
        for (const button of host.querySelectorAll("[data-architecture-mode]"))
          button.onclick = () => {
            try {
              instance.setMode(button.dataset.architectureMode);
              for (const choice of host.querySelectorAll(
                "[data-architecture-mode]",
              ))
                choice.setAttribute("aria-pressed", String(choice === button));
              host.querySelector(".architectural-walk").hidden =
                button.dataset.architectureMode !== "inside";
              message.textContent =
                button.dataset.architectureMode === "inside"
                  ? "Просмотр изнутри"
                  : "План сверху";
              canvas.focus();
            } catch {
              message.textContent =
                "В помещении нет свободного места для просмотра изнутри.";
            }
          };
        host.querySelector("[data-architecture-reset]").onclick = () => {
          instance.reset();
          canvas.focus();
        };
        const full = host.querySelector("[data-architecture-fullscreen]");
        full.hidden = !stage.requestFullscreen;
        full.onclick = async () => {
          try {
            if (document.fullscreenElement === stage)
              await document.exitFullscreen();
            else await stage.requestFullscreen();
          } catch {
            message.textContent = "Полный экран недоступен в этом браузере.";
          }
        };
        canvas.focus();
      } catch {
        instance?.dispose();
        if (viewer === instance) viewer = null;
        if (valid()) {
          stage.hidden = true;
          canvas.replaceChildren();
          message.textContent =
            "Не удалось открыть 3D-планировку. Проверьте соединение и поддержку WebGL2 в браузере, затем попробуйте ещё раз.";
          open.disabled = false;
        }
      } finally {
        if (valid()) loading = false;
      }
    };
  }
  const visibility = () => {
    if (!document.hidden) {
      clearTimeout(timer);
      refresh();
    }
  };
  function dispose(event) {
    if (disposed) return;
    disposed = true;
    generation++;
    clearTimeout(timer);
    controller.abort();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", dispose);
    observer.disconnect();
    release();
    if (event?.persisted)
      window.addEventListener(
        "pageshow",
        () =>
          mountArchitecturalModel(host, propertyId, owner, request, options),
        { once: true },
      );
  }
  const observer = new MutationObserver(() => {
    if (!host.isConnected) dispose();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", dispose);
  refresh();
  return dispose;
}
