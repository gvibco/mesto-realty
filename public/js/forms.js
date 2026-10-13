import {
  state,
  api,
  esc,
  safeImage,
  categories,
  businessRoles,
  taxLabels,
  card,
  empty,
  wireFavorites,
  field,
  select,
  toast,
  authRequired,
  errors,
  busy,
  safeReturnPath,
  navigate,
} from "./core.js";
import { uploadPhotoBatches } from "./room-model.js";
import { mountArchitecturalInputs } from "./architectural-inputs.js";
const main = document.querySelector("#main");
export function authPage(mode) {
  const register = mode === "register";
  main.innerHTML = `<div class="auth-wrap"><div class="eyebrow">Место Бизнес</div><h1>${register ? "Аккаунт для бизнеса" : "С возвращением"}</h1><p>${register ? "Создайте аккаунт, чтобы сохранять и публиковать объявления." : "Войдите, чтобы вернуться к вашим объявлениям."}</p><form id="auth-form" class="stack">${register ? field("name", "Ваше имя", "", 'required minlength="2" maxlength="80" autocomplete="name"') : ""}${register ? field("company", "Компания", "", 'maxlength="120" autocomplete="organization" placeholder="Необязательно"') + select("businessRole", "Ваша роль", businessRoles, "owner") : ""}${field("email", "Электронная почта", "", 'required type="email" autocomplete="email" maxlength="254" placeholder="you@example.ru"')}${field("password", "Пароль", "", 'required type="password" minlength="10" maxlength="72" autocomplete="' + (register ? "new-password" : "current-password") + '"' + (register ? ' placeholder="Не менее 10 символов"' : ""))}${register ? field("confirmPassword", "Повторите пароль", "", 'required type="password" minlength="10" autocomplete="new-password"') : ""}<div class="form-error" tabindex="-1" role="alert"></div><button class="button" type="submit">${register ? "Создать аккаунт" : "Войти"}</button><p class="form-note">${register ? "Уже есть аккаунт?" : "Ещё нет аккаунта?"} <a href="/${register ? "login" : "register"}${location.search}">${register ? "Войти" : "Зарегистрироваться"}</a></p></form></div>`;
  document.querySelector("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (register && values.password !== values.confirmPassword) {
      errors(form, new Error("Пароли не совпадают. Проверьте повторный ввод."));
      return;
    }
    delete values.confirmPassword;
    busy(form, true);
    try {
      const data = await api("/auth/" + mode, { method: "POST", body: values });
      state.user = data.user;
      const next = new URLSearchParams(location.search).get("next");
      navigate(safeReturnPath(next));
    } catch (error) {
      errors(form, error);
      busy(form, false);
    }
  };
}
export async function accountPage() {
  if (!authRequired()) return;
  const tab = new URLSearchParams(location.search).get("tab") || "properties";
  main.innerHTML = `<div class="container page"><div class="section-heading"><div><h1>Кабинет компании</h1><p>Здравствуйте, ${esc(state.user.name)}</p></div><button id="logout" class="button secondary">Выйти</button></div><nav class="tabs" aria-label="Разделы кабинета">${Object.entries(
    {
      properties: "Мои объявления",
      favorites: "Избранное",
      profile: "Профиль",
    },
  )
    .map(
      ([key, label]) =>
        `<a class="${key === tab ? "active" : ""}" href="/account?tab=${key}">${label}</a>`,
    )
    .join(
      "",
    )}</nav><div id="account-content"><div class="loading">Загрузка…</div></div></div>`;
  document.querySelector("#logout").onclick = async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await api("/auth/logout", { method: "POST" });
      navigate("/");
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  };
  const content = document.querySelector("#account-content");
  if (tab === "profile") {
    await profile(content);
    return;
  }
  const mine = tab !== "favorites";
  const params = new URLSearchParams(location.search);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const data = await api(
    (mine ? "/me/properties" : "/favorites") + "?limit=12&page=" + page,
  );
  content.innerHTML = `<div class="section-heading"><p>${mine ? "Ваши объявления" : "Сохранённые объекты"}: ${data.total}</p>${mine ? '<a class="button" href="/publish">+ Новое объявление</a>' : ""}</div>${data.items.length ? `<div class="grid">${data.items.map((p) => card(p, mine)).join("")}</div>` : empty(mine ? "Разместите первый объект" : "Соберите подходящие объекты", mine ? "Укажите назначение, параметры и условия сделки для будущего покупателя или арендатора." : "Нажимайте на сердечко в каталоге, чтобы вернуться к объявлению позже.", mine ? "/publish" : "/catalog", mine ? "Разместить объявление" : "Найти объект")}<nav class="pagination" aria-label="Страницы">${Array.from({ length: data.pages }, (_, i) => `<a class="${i + 1 === data.page ? "active" : ""}" href="/account?tab=${mine ? "properties" : "favorites"}&page=${i + 1}">${i + 1}</a>`).join("")}</nav>`;
  wireFavorites(content);
  content.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          !confirm(
            "Удалить объявление и все его фотографии? Это действие нельзя отменить.",
          )
        )
          return;
        b.disabled = true;
        try {
          await api("/properties/" + encodeURIComponent(b.dataset.delete), {
            method: "DELETE",
          });
          await accountPage();
          toast("Объявление удалено");
        } catch (error) {
          toast(error.message);
          b.disabled = false;
        }
      }),
  );
  content.querySelectorAll("[data-archive]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await api("/properties/" + encodeURIComponent(b.dataset.archive), {
            method: "PATCH",
            body: { status: "archived" },
          });
          await accountPage();
          toast("Объявление перенесено в архив");
        } catch (error) {
          toast(error.message);
          b.disabled = false;
        }
      }),
  );
}
async function profile(content) {
  const { user } = await api("/profile");
  content.innerHTML = `<div class="form-sheet profile-layout"><form id="avatar-form" class="profile-avatar">${user.avatar ? `<img class="avatar" src="${safeImage(user.avatar)}" alt="Фото профиля">` : `<span class="avatar">${esc(user.name[0])}</span>`}<label class="field">Фото профиля<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" required></label><p class="muted">JPEG, PNG или WebP, до 8 МБ.</p><div class="form-error" role="alert" tabindex="-1"></div><button class="button secondary" type="submit">Загрузить фото</button></form><form id="profile-form" class="stack"><h2>Деловой профиль</h2>${field("name", "Имя", user.name, 'required minlength="2" maxlength="80" autocomplete="name"')}${field("company", "Компания", user.company, 'maxlength="120" autocomplete="organization"')}${select("businessRole", "Ваша роль", businessRoles, user.businessRole)}${field("phone", "Телефон", user.phone, 'type="tel" autocomplete="tel" placeholder="+7 900 000-00-00"')}<label class="field">Электронная почта<input value="${esc(user.email)}" disabled></label><label class="field">О компании и вашей работе<textarea name="bio" maxlength="1000" placeholder="Специализация, услуги и опыт">${esc(user.bio)}</textarea><span class="field-error" data-error="bio"></span></label><div class="form-error" role="alert" tabindex="-1"></div><button class="button" type="submit">Сохранить изменения</button></form></div>`;
  document.querySelector("#profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, true);
    try {
      const data = await api("/profile", {
        method: "PATCH",
        body: Object.fromEntries(new FormData(form)),
      });
      state.user = data.user;
      toast("Изменения сохранены");
      errors(form, { message: "" });
    } catch (error) {
      errors(form, error);
    } finally {
      busy(form, false);
    }
  };
  document.querySelector("#avatar-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, true);
    try {
      validateFiles([...form.elements.avatar.files], 1);
      await api("/profile/avatar", {
        method: "POST",
        body: new FormData(form),
      });
      await profile(content);
      toast("Фото профиля обновлено");
    } catch (error) {
      errors(form, error);
      busy(form, false);
    }
  };
}
function validateFiles(files, max) {
  if (files.length > max)
    throw new Error(`Можно добавить не больше ${max} фото.`);
  for (const f of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type))
      throw new Error("Выберите фотографии JPEG, PNG или WebP.");
    if (f.size > 8 * 1024 * 1024)
      throw new Error(`Файл «${f.name}» больше 8 МБ.`);
  }
}
export async function editorPage(id) {
  if (!authRequired()) return;
  let p = {
    deal: "rent",
    category: "office",
    contactName: state.user.name,
    contactPhone: state.user.phone,
    status: "draft",
  };
  let images = [];
  if (id) {
    const data = await api("/properties/" + encodeURIComponent(id));
    p = data.property;
    images = data.images;
    if (String(p.ownerId) !== String(state.user.id))
      throw new Error("Вы можете редактировать только свои объявления.");
  }
  let propertyId = id;
  let createOutcomeUnknown = false;
  let pending = [];
  let urls = [];
  main.innerHTML = `<div class="container page"><div class="breadcrumb"><a href="/account">Кабинет компании</a> / ${id ? "Редактирование" : "Новое объявление"}</div><div class="page-intro"><h1>${id ? "Редактирование объекта" : "Разместить коммерческий объект"}</h1><p>${id ? "Обновите информацию и фотографии объявления." : "Предложите помещение или участок для бизнеса."}</p></div><form id="editor" class="form-sheet"><section class="form-section"><h2>Основное</h2><div class="form-grid">${select("deal", "Тип сделки", { sale: "Продажа", rent: "Аренда" }, p.deal)}${select("category", "Тип недвижимости", categories, p.category)}<div class="full">${field("title", "Заголовок объявления", p.title, 'required minlength="5" maxlength="120" placeholder="Офис 120 м² в деловом центре"')}</div>${field("price", "Цена, ₽", p.price, 'required type="number" min="1" max="999999999999" step="0.01"')}${field("area", "Площадь, м²", p.area, 'required type="number" min="0.01" max="99999999" step="0.01"')}${select("tax", "НДС", taxLabels, p.tax || "unspecified")}${select("parking", "Парковка", { false: "Нет", true: "Есть" }, String(!!p.parking))}</div></section><section class="form-section"><h2>Характеристики объекта</h2><p class="form-help">Необязательные параметры помогут компаниям оценить помещение.</p><div class="form-grid">${select("buildingClass", "Класс здания", { "": "Не указан", A: "A", B: "B", C: "C" }, p.buildingClass)}${field("floor", "Этаж", p.floor, 'type="number" min="-5" max="150" step="1"')}${field("ceilingHeight", "Высота потолков, м", p.ceilingHeight, 'type="number" min="0.01" max="50" step="0.01"')}${field("powerKw", "Мощность, кВт", p.powerKw, 'type="number" min="0.01" max="100000" step="0.01"')}</div></section><section class="form-section"><h2>Расположение</h2><div class="form-grid">${field("city", "Город", p.city, 'required minlength="2" maxlength="80" placeholder="Москва"')}${field("district", "Район", p.district, 'maxlength="100" placeholder="Необязательно"')}<div class="full">${field("address", "Адрес", p.address, 'required minlength="5" maxlength="200" placeholder="Улица, номер дома"')}</div></div></section><section class="form-section"><h2>Фотографии</h2><div class="upload"><label class="field">Добавьте до 200 фотографий<input id="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="muted">JPEG, PNG или WebP, до 8 МБ каждое. Первое фото станет обложкой. Для публикации нужно хотя бы одно фото.</p></div><p id="room-photo-guidance" class="form-help"></p><div id="photo-previews" class="preview-grid"></div><p id="photo-error" class="form-error" role="alert"></p></section><section class="form-section"><h2>О недвижимости</h2><label class="field">Описание<textarea name="description" required minlength="20" maxlength="10000" placeholder="Укажите планировку, доступ, инженерные системы и условия сделки. Не менее 20 символов.">${esc(p.description)}</textarea><span class="field-error" data-error="description"></span></label></section><section class="form-section"><h2>Контакты</h2><div class="form-grid">${field("contactName", "Контактное лицо", p.contactName, 'required minlength="2" maxlength="80" autocomplete="name"')}${field("contactPhone", "Телефон", p.contactPhone, 'required type="tel" autocomplete="tel" placeholder="+7 900 000-00-00"')}</div></section><div class="form-error" tabindex="-1" role="alert"></div><p id="save-progress" class="muted" aria-live="polite"></p><div class="form-actions"><button type="submit" class="button" name="intent" value="published">${p.status === "published" ? "Сохранить и опубликовать" : "Опубликовать"}</button><button type="submit" class="button secondary" name="intent" value="draft">Сохранить черновик</button><a class="button secondary" href="/account">В кабинет</a></div></form></div>`;
  const form = document.querySelector("#editor");
  form.querySelector("#room-photo-guidance").textContent =
    "Для архитектурной 3D-планировки добавьте план этажа и общие размеры помещения. Модель создаётся автоматически после сохранения; фотографии уточняют мебель, но не обязательны.";
  const architectureInputs = mountArchitecturalInputs(form, id);
  const category = form.elements.category;
  const updateCharacteristics = () => {
    const land = category.value === "commercial_land";
    form.querySelector("#room-photo-guidance").hidden = land;
    const logistics = ["warehouse", "industrial"].includes(category.value);
    for (const name of ["buildingClass", "floor", "ceilingHeight"]) {
      const input = form.elements[name];
      input.closest(".field").hidden =
        land || (logistics && ["buildingClass", "floor"].includes(name));
      input.disabled = input.closest(".field").hidden;
      // Values stay in the DOM when the user changes the category back.
    }
  };
  category.onchange = updateCharacteristics;
  updateCharacteristics();
  const renderPhotos = () => {
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    document.querySelector("#photo-previews").innerHTML =
      images
        .map(
          (im) =>
            `<div class="photo-preview"><img src="${safeImage(im.url)}" alt="Фото недвижимости"><button type="button" data-remove-image="${esc(im.id)}">Удалить фото</button></div>`,
        )
        .join("") +
      pending
        .map((file, i) => {
          const url = URL.createObjectURL(file);
          urls.push(url);
          return `<div class="photo-preview"><img src="${url}" alt="${esc(file.name)}"><button type="button" data-remove-pending="${i}">Убрать фото</button></div>`;
        })
        .join("");
    form
      .querySelectorAll("[data-remove-image], [data-remove-pending]")
      .forEach((button) => {
        button.disabled = form.getAttribute("aria-busy") === "true";
      });
    document.querySelectorAll("[data-remove-pending]").forEach(
      (b) =>
        (b.onclick = () => {
          if (form.getAttribute("aria-busy") === "true") return;
          pending.splice(Number(b.dataset.removePending), 1);
          renderPhotos();
        }),
    );
    document.querySelectorAll("[data-remove-image]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (form.getAttribute("aria-busy") === "true") return;
          if (!confirm("Удалить эту фотографию?")) return;
          b.disabled = true;
          try {
            await api(
              "/properties/" +
                encodeURIComponent(propertyId) +
                "/images/" +
                encodeURIComponent(b.dataset.removeImage),
              { method: "DELETE" },
            );
            images = images.filter(
              (im) => String(im.id) !== b.dataset.removeImage,
            );
            renderPhotos();
          } catch (error) {
            document.querySelector("#photo-error").textContent = error.message;
            b.disabled = form.getAttribute("aria-busy") === "true";
          }
        }),
    );
  };
  renderPhotos();
  document.querySelector("#photos").onchange = (e) => {
    if (form.getAttribute("aria-busy") === "true") return;
    try {
      const files = [...e.target.files];
      validateFiles([...pending, ...files], 200 - images.length);
      pending.push(...files);
      renderPhotos();
      document.querySelector("#photo-error").textContent = "";
    } catch (error) {
      document.querySelector("#photo-error").textContent = error.message;
    }
    e.target.value = "";
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (createOutcomeUnknown || form.getAttribute("aria-busy") === "true")
      return;
    const targetStatus = e.submitter?.value || "draft";
    const body = Object.fromEntries(new FormData(form));
    delete body.intent;
    for (const name of [
      "architectureWidth",
      "architectureDepth",
      "architectureHeight",
      "architecturePlan",
    ])
      delete body[name];
    if (
      !/^\+?[\d\s()\-]{7,25}$/.test(body.contactPhone) ||
      body.contactPhone.replace(/\D/g, "").length < 7 ||
      body.contactPhone.replace(/\D/g, "").length > 15
    ) {
      errors(
        form,
        new Error("Проверьте телефон: он должен содержать от 7 до 15 цифр."),
      );
      return;
    }
    if (targetStatus === "published" && !images.length && !pending.length) {
      errors(
        form,
        new Error("Добавьте хотя бы одну фотографию для публикации."),
      );
      return;
    }
    body.price = Number(body.price);
    body.area = Number(body.area);
    for (const name of ["floor", "ceilingHeight", "powerKw"]) {
      if (Object.hasOwn(body, name))
        body[name] = body[name] === "" ? null : Number(body[name]);
    }
    body.parking = body.parking === "true";
    body.status = "draft";
    busy(form, true);
    form
      .querySelectorAll('input,select,textarea,button[type="button"]')
      .forEach((el) => (el.disabled = true));
    const progress = document.querySelector("#save-progress");
    let uploadStarted = false;
    let savedThisAttempt = false;
    try {
      errors(form, { message: "" });
      progress.textContent = "Сохраняем объявление…";
      const saved = await api(
        "/properties" +
          (propertyId ? "/" + encodeURIComponent(propertyId) : ""),
        { method: propertyId ? "PATCH" : "POST", body },
      );
      savedThisAttempt = true;
      propertyId = saved.property.id;
      history.replaceState({}, "", "/edit/" + encodeURIComponent(propertyId));
      if (pending.length) {
        progress.textContent = "Загружаем фотографии…";
        uploadStarted = true;
        await uploadPhotoBatches(
          pending,
          (data) =>
            api("/properties/" + encodeURIComponent(propertyId) + "/images", {
              method: "POST",
              body: data,
            }),
          (uploaded) => {
            images = uploaded.images;
            renderPhotos();
            progress.textContent = `Сохранено фотографий: ${images.length}. Осталось загрузить: ${pending.length}.`;
          },
        );
        uploadStarted = false;
      }
      progress.textContent = "Сохраняем план и размеры помещения…";
      await architectureInputs.save(propertyId);
      progress.textContent =
        targetStatus === "published"
          ? "Публикуем объявление…"
          : "Сохраняем черновик…";
      await api("/properties/" + encodeURIComponent(propertyId), {
        method: "PATCH",
        body: { status: targetStatus },
      });
      navigate(
        targetStatus === "published"
          ? "/property/" + encodeURIComponent(propertyId)
          : "/account",
      );
    } catch (error) {
      if (!propertyId && !error.status) {
        createOutcomeUnknown = true;
        error.message =
          "Связь прервалась при создании объявления. Возможно, черновик уже сохранён. Откройте кабинет и проверьте свои объявления перед созданием нового. Повторное сохранение здесь отключено, чтобы не создать копию.";
      }
      if (uploadStarted) {
        if (!error.status) {
          pending = [];
          error.message =
            "Соединение прервалось при загрузке фото. Черновик сохранён. Откройте его заново из кабинета и проверьте фотографии перед повторной публикацией.";
        }
        try {
          const refreshed = await api(
            "/properties/" + encodeURIComponent(propertyId),
          );
          images = refreshed.images;
          renderPhotos();
        } catch {
          renderPhotos();
        }
      }
      progress.textContent = savedThisAttempt
        ? "Объявление сохранено как черновик. Исправьте ошибку и повторите сохранение."
        : "";
      errors(form, error);
      busy(form, false);
      if (createOutcomeUnknown) {
        form
          .querySelectorAll('button[type="submit"]')
          .forEach((button) => (button.disabled = true));
        return;
      }
      form
        .querySelectorAll('input,select,textarea,button[type="button"]')
        .forEach((el) => (el.disabled = false));
      updateCharacteristics();
    }
  };
}
