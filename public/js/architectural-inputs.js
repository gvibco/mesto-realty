import { api } from "./core.js";

export function mountArchitecturalInputs(form, propertyId) {
  const section = document.createElement("section");
  section.className = "form-section architectural-inputs";
  section.innerHTML =
    '<h2>План и размеры помещения</h2><p class="form-help">Загрузите план этажа и укажите общие размеры. После сохранения планировка в 3D создаётся автоматически по плану и размерам. Фотографии необязательны: они только уточняют типы мебели. Мебель без замеров будет приблизительной.</p><div class="form-grid"><label class="field">Ширина, м<input name="architectureWidth" type="number" min="0.1" max="200" step="0.01"></label><label class="field">Глубина, м<input name="architectureDepth" type="number" min="0.1" max="200" step="0.01"></label><label class="field">Высота, м<input name="architectureHeight" type="number" min="0.5" max="50" step="0.01"></label><label class="field full">План этажа<input name="architecturePlan" type="file" accept="image/jpeg,image/png,image/webp"><span class="muted">JPEG, PNG или WebP, до 8 МБ. План загружается отдельно от фотографий.</span></label></div><div class="architectural-plan-preview" hidden><img alt="План этажа"><button type="button" class="button secondary" data-plan-remove>Удалить план</button></div><p class="form-error" role="alert" data-plan-error></p><p class="muted" role="status" aria-live="polite" data-plan-status></p>';
  form
    .querySelector("#room-photo-guidance")
    ?.closest(".form-section")
    ?.after(section);
  if (!section.isConnected) form.append(section);
  const fields = ["width", "depth", "height"].map((name) =>
    section.querySelector(
      '[name="architecture' + name[0].toUpperCase() + name.slice(1) + '"]',
    ),
  );
  const fileInput = section.querySelector('[name="architecturePlan"]'),
    preview = section.querySelector(".architectural-plan-preview"),
    error = section.querySelector("[data-plan-error]"),
    status = section.querySelector("[data-plan-status]");
  let disposed = false,
    file = null,
    remove = false,
    hasPlan = false,
    planUrl = null,
    localUrl = null,
    savedDimensions = null,
    loadError = false,
    retryFailedModel = false;
  const controller = new AbortController();
  fields[2].value = form.elements.ceilingHeight?.value || "";
  const endpoint = (id) =>
    "/properties/" + encodeURIComponent(id) + "/architecture";
  function showPlan() {
    if (localUrl) {
      URL.revokeObjectURL(localUrl);
      localUrl = null;
    }
    if (file) localUrl = URL.createObjectURL(file);
    const url = localUrl || planUrl;
    preview.hidden = !url || remove;
    preview.querySelector("img").src = url || "";
  }
  function visibility() {
    const land = form.elements.category?.value === "commercial_land";
    section.hidden = land;
    for (const field of fields) field.disabled = land;
    fileInput.disabled = land;
  }
  const onFile = () => {
    const next = fileInput.files?.[0];
    fileInput.value = "";
    error.textContent = "";
    if (!next) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(next.type) ||
      next.size > 8 * 1024 * 1024
    ) {
      error.textContent = "Выберите JPEG, PNG или WebP размером до 8 МБ.";
      return;
    }
    file = next;
    remove = false;
    showPlan();
    status.textContent = "План будет загружен при сохранении объявления.";
  };
  const onRemove = () => {
    file = null;
    remove = hasPlan;
    showPlan();
    status.textContent = remove
      ? "План будет удалён при сохранении объявления."
      : "";
  };
  const onCeiling = () => {
    if (!fields[2].value) fields[2].value = form.elements.ceilingHeight.value;
  };
  fileInput.addEventListener("change", onFile);
  section
    .querySelector("[data-plan-remove]")
    .addEventListener("click", onRemove);
  form.elements.category?.addEventListener("change", visibility);
  form.elements.ceilingHeight?.addEventListener("change", onCeiling);
  visibility();
  const initialValues = fields.map((field) => field.value);
  const ready = propertyId
    ? api(endpoint(propertyId), { signal: controller.signal })
        .then(({ inputs, model }) => {
          if (disposed || !inputs) return;
          retryFailedModel = model?.state === "failed";
          savedDimensions =
            inputs.width && inputs.depth && inputs.height
              ? JSON.stringify({
                  width: inputs.width,
                  depth: inputs.depth,
                  height: inputs.height,
                })
              : null;
          fields.forEach((field, index) => {
            if (
              field.value === initialValues[index] &&
              inputs[["width", "depth", "height"][index]] != null
            )
              field.value = inputs[["width", "depth", "height"][index]];
          });
          hasPlan = !!inputs.hasPlan;
          planUrl =
            typeof inputs.planUrl === "string" &&
            /^\/property-plans\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.webp$/.test(
              inputs.planUrl,
            )
              ? inputs.planUrl
              : null;
          showPlan();
        })
        .catch(() => {
          if (!disposed) {
            loadError = true;
            status.textContent =
              "Не удалось загрузить сохранённые размеры. Проверьте значения перед сохранением.";
          }
        })
    : Promise.resolve();
  async function save(id) {
    await ready;
    if (disposed || form.elements.category?.value === "commercial_land") return;
    error.textContent = "";
    const values = fields.map((field) => field.value.trim());
    // A seeded ceiling alone does not opt the owner into model generation.
    if (!values[0] && !values[1] && !file && !hasPlan) return;
    if (values.some((value) => value === ""))
      throw new Error(
        "Укажите ширину, глубину и высоту помещения для 3D-планировки.",
      );
    const dimensions = Object.fromEntries(
      ["width", "depth", "height"].map((name, index) => [
        name,
        Number(values[index]),
      ]),
    );
    if (
      Object.values(dimensions).some((value) => !Number.isFinite(value)) ||
      dimensions.width < 0.1 ||
      dimensions.depth < 0.1 ||
      dimensions.height < 0.5 ||
      dimensions.width > 200 ||
      dimensions.depth > 200 ||
      dimensions.height > 50
    )
      throw new Error(
        "Проверьте размеры: ширина и глубина от 0,1 до 200 м, высота от 0,5 до 50 м.",
      );
    const serialized = JSON.stringify(dimensions);
    if (serialized !== savedDimensions || loadError || retryFailedModel) {
      await api(endpoint(id) + "/input", { method: "PUT", body: dimensions });
      savedDimensions = serialized;
      loadError = false;
      retryFailedModel = false;
    }
    if (remove) {
      await api(endpoint(id) + "/plan", { method: "DELETE" });
      remove = false;
      hasPlan = false;
      planUrl = null;
      showPlan();
    }
    if (file) {
      const uploading = file;
      const data = new FormData();
      data.append("plan", uploading);
      const result = await api(endpoint(id) + "/plan", {
        method: "POST",
        body: data,
      });
      if (file === uploading) file = null;
      hasPlan = true;
      planUrl = result.inputs?.planUrl || planUrl;
      showPlan();
    }
    status.textContent =
      "План и размеры сохранены. Планировка создаётся автоматически.";
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    if (localUrl) URL.revokeObjectURL(localUrl);
    fileInput.removeEventListener("change", onFile);
    section
      .querySelector("[data-plan-remove]")
      .removeEventListener("click", onRemove);
    form.elements.category?.removeEventListener("change", visibility);
    form.elements.ceilingHeight?.removeEventListener("change", onCeiling);
    observer.disconnect();
  }
  const observer = new MutationObserver(() => {
    if (!form.isConnected) dispose();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  return { save, dispose };
}
