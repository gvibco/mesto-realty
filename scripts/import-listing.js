// One-off import of a listing (e.g. collected from Cian) through the public
// REST API. Usage: node scripts/import-listing.js <manifest.json> [baseUrl]
// Image paths in the manifest are relative to the manifest directory.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const manifestPath = process.argv[2];
const baseUrl = (process.argv[3] || "http://localhost:3000").replace(/\/$/, "");
if (!manifestPath) {
  console.error(
    "Usage: node scripts/import-listing.js <manifest.json> [baseUrl]",
  );
  process.exit(1);
}
const directory = path.dirname(path.resolve(manifestPath));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const email = "import.demo@example.com";
const password =
  process.env.IMPORT_DEMO_PASSWORD ||
  "Import-demo-" + randomBytes(8).toString("hex");

let cookie = "";
let csrf = "";
async function call(method, route, { json, form } = {}) {
  const headers = { cookie };
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let body;
  if (json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const response = await fetch(baseUrl + route, {
    method,
    headers,
    body,
    redirect: "manual",
  });
  for (const setCookie of response.headers.getSetCookie?.() || []) {
    const pair = setCookie.split(";")[0];
    if (pair.startsWith("mesto.sid=")) cookie = pair;
  }
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status, data, text };
}
async function mutate(method, route, payload) {
  const result = await call(method, route, payload);
  if (result.status >= 400)
    throw new Error(
      `${method} ${route} -> ${result.status}: ${result.text.slice(0, 300)}`,
    );
  return result.data;
}
const mime = (bytes) =>
  bytes[0] === 0xff && bytes[1] === 0xd8
    ? "image/jpeg"
    : bytes[0] === 0x89 && bytes[1] === 0x50
      ? "image/png"
      : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP"
        ? "image/webp"
        : null;
async function fileField(name, file) {
  const bytes = await readFile(path.join(directory, file));
  const type = mime(bytes);
  if (!type) throw new Error("Неподдерживаемый формат файла: " + file);
  return [name, new Blob([bytes], { type }), path.basename(file)];
}

csrf = (await call("GET", "/api/auth/session")).data.csrfToken;
const registered = await call("POST", "/api/auth/register", {
  json: {
    name: manifest.contactName || "Импорт Циан",
    email,
    password,
    company: "Тестовый импорт",
    businessRole: "broker",
  },
});
if (registered.status === 201) {
  csrf = registered.data.csrfToken;
} else {
  const logged = await call("POST", "/api/auth/login", {
    json: { email, password: process.env.IMPORT_DEMO_PASSWORD || password },
  });
  if (logged.status !== 200)
    throw new Error(
      "Аккаунт импорта существует с другим паролем: задайте IMPORT_DEMO_PASSWORD",
    );
  csrf = logged.data.csrfToken;
}

const { property } = await mutate("POST", "/api/properties", {
  json: {
    title: manifest.title,
    deal: manifest.deal || "sale",
    category: manifest.category,
    city: manifest.city,
    district: manifest.district || "",
    address: manifest.address,
    price: manifest.price,
    area: manifest.area,
    description:
      manifest.description +
      "\n\nТестовый импорт с Циана, данные демонстрационные.",
    contactName: manifest.contactName || "Импорт Циан",
    contactPhone: manifest.contactPhone || "+79990000000",
    status: "draft",
    ...(manifest.buildingClass
      ? { buildingClass: manifest.buildingClass }
      : {}),
    ...(manifest.floor != null ? { floor: manifest.floor } : {}),
    ...(manifest.ceilingHeight != null
      ? { ceilingHeight: manifest.ceilingHeight }
      : {}),
    ...(manifest.powerKw != null ? { powerKw: manifest.powerKw } : {}),
    parking: !!manifest.parking,
    tax: manifest.tax || "unspecified",
  },
});
const propertyId = property.id;

for (const photo of manifest.photos || []) {
  const form = new FormData();
  form.append(...(await fileField("images", photo)));
  await mutate("POST", `/api/properties/${propertyId}/images`, { form });
}
if (manifest.plan) {
  const form = new FormData();
  form.append(...(await fileField("plan", manifest.plan)));
  await mutate("POST", `/api/properties/${propertyId}/architecture/plan`, {
    form,
  });
}
if (manifest.dimensions)
  await mutate("PUT", `/api/properties/${propertyId}/architecture/input`, {
    json: manifest.dimensions,
  });
await mutate("PATCH", `/api/properties/${propertyId}`, {
  json: { status: "published" },
});
console.log("PROPERTY_ID=" + propertyId);
console.log("URL=" + baseUrl + "/property/" + propertyId);
