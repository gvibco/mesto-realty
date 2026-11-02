import { api, categories, money } from "./core.js";

export function initAssistant() {
  const root = document.querySelector("#assistant");
  if (!root) return;
  root.innerHTML = `<button class="assistant-launch" type="button" aria-controls="assistant-panel" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/></svg><span>Подобрать с ИИ</span></button>
    <section id="assistant-panel" class="assistant-panel" role="dialog" aria-modal="true" aria-labelledby="assistant-title" hidden>
      <header class="assistant-header"><div><h2 id="assistant-title">Помощник по подбору</h2><p>Коммерческая недвижимость</p></div><button type="button" class="assistant-close" aria-label="Закрыть помощника">×</button></header>
      <div class="assistant-log" role="log" aria-label="Диалог с помощником" aria-live="polite" aria-relevant="additions"><div class="assistant-message">Расскажите, какое помещение ищете: город, назначение, аренда или покупка, бюджет и площадь.</div></div>
      <div class="assistant-examples"><button type="button">Офис в Москве в аренду</button><button type="button">Склад до 300 м²</button></div>
      <p class="assistant-notice">Ответы создаёт ИИ. Проверяйте условия в карточке объекта. Не отправляйте личные данные.</p>
      <p class="assistant-error" role="alert" hidden></p>
      <form class="assistant-form"><label for="assistant-input">Ваш запрос</label><div><textarea id="assistant-input" rows="2" maxlength="2000" required placeholder="Например, офис до 200 000 ₽ в месяц"></textarea><button type="submit" class="button">Отправить</button></div></form>
      <a class="assistant-catalog" href="/catalog">Искать самостоятельно в каталоге ↗</a>
    </section>`;
  const launch = root.querySelector(".assistant-launch");
  const panel = root.querySelector(".assistant-panel");
  const input = root.querySelector("textarea");
  const form = root.querySelector("form");
  const log = root.querySelector(".assistant-log");
  const errorBox = root.querySelector(".assistant-error");
  const send = form.querySelector('button[type="submit"]');
  // На главной кнопка живёт в hero, плавающая не нужна.
  if ((location.pathname.replace(/\/$/, "") || "/") === "/")
    root.classList.add("home");
  let history = [];
  let pending = false;
  let previousFocus;
  let checked = false;
  const triggers = () => [
    launch,
    ...document.querySelectorAll("[data-assistant-open]"),
  ];
  const setExpanded = (value) =>
    triggers().forEach((element) => {
      element.setAttribute("aria-controls", "assistant-panel");
      element.setAttribute("aria-expanded", String(value));
    });
  const close = () => {
    panel.hidden = true;
    setExpanded(false);
    const target = previousFocus?.isConnected ? previousFocus : launch;
    if (target.getClientRects().length) target.focus();
  };
  const open = async (trigger) => {
    if (!panel.hidden) {
      input.focus();
      return;
    }
    previousFocus = trigger || document.activeElement;
    panel.hidden = false;
    setExpanded(true);
    input.focus();
    if (!checked) {
      send.disabled = true;
      try {
        const { enabled, mode } = await api("/assistant");
        checked = true;
        send.disabled = !enabled || pending;
        if (mode === "catalog") {
          launch.lastElementChild.textContent = "Подобрать объект";
          root.querySelector(".assistant-header p").textContent =
            "Подбор по каталогу";
          root.querySelector(".assistant-notice").textContent =
            "Подбор по каталогу: город, назначение, бюджет и площадь. Проверяйте условия в карточке объекта.";
        }
        if (!enabled) {
          errorBox.textContent =
            "ИИ-помощник ещё не подключён. Пока используйте каталог объектов.";
          errorBox.hidden = false;
          send.disabled = true;
        }
      } catch (error) {
        errorBox.textContent =
          error instanceof SyntaxError
            ? "Помощник пока недоступен. Попробуйте открыть чат позже."
            : error.message;
        errorBox.hidden = false;
      }
    }
  };
  launch.onclick = () => {
    if (!panel.hidden) return close();
    open(launch);
  };
  document.addEventListener("click", (event) => {
    const trigger =
      event.target instanceof Element
        ? event.target.closest("[data-assistant-open]")
        : null;
    if (!trigger) return;
    event.preventDefault();
    open(trigger);
  });
  root.querySelector(".assistant-close").onclick = close;
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Tab") {
      const controls = [
        ...panel.querySelectorAll("button:not(:disabled),textarea,a[href]"),
      ].filter((el) => !el.hidden);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  root.querySelectorAll(".assistant-examples button").forEach((button) => {
    button.onclick = () => {
      input.value = button.textContent;
      input.focus();
    };
  });
  function addMessage(content, user = false) {
    const node = document.createElement("div");
    node.className = "assistant-message" + (user ? " assistant-user" : "");
    node.textContent = content;
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }
  function addProperties(properties) {
    const group = document.createElement("div");
    group.className = "assistant-properties";
    for (const p of properties.slice(0, 6)) {
      if (!Number.isInteger(p.id) || p.id < 1) continue;
      const link = document.createElement("a");
      link.href = `/property/${p.id}`;
      link.className = "assistant-property";
      const title = document.createElement("strong");
      title.textContent = p.title;
      const facts = document.createElement("span");
      facts.textContent = `${p.city} · ${categories[p.category] || "Помещение"} · ${p.area} м²`;
      const price = document.createElement("b");
      price.textContent =
        money(p.price) + (p.deal === "rent" ? " / месяц" : "");
      link.append(title, facts, price);
      group.append(link);
    }
    if (group.childElementCount) log.append(group);
    log.scrollTop = log.scrollHeight;
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    const content = input.value.trim();
    if (pending || send.disabled || !content) return;
    pending = true;
    send.disabled = true;
    form.setAttribute("aria-busy", "true");
    errorBox.hidden = true;
    const userMessage = addMessage(content, true);
    const loading = addMessage("Подбираю варианты…");
    input.value = "";
    try {
      // Keep complete pairs; the server accepts at most 20 messages.
      const messages = [...history.slice(-18), { role: "user", content }];
      const result = await api("/assistant", {
        method: "POST",
        body: { messages },
      });
      loading.remove();
      addMessage(result.reply);
      addProperties(result.properties || []);
      history = [...messages, { role: "assistant", content: result.reply }];
      root.querySelector(".assistant-examples").hidden = true;
    } catch (error) {
      loading.remove();
      userMessage.remove();
      input.value = content;
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      pending = false;
      send.disabled = false;
      form.removeAttribute("aria-busy");
      if (!panel.hidden) input.focus();
    }
  };
}
