// Post-deploy control of the live site. Also checks that AI assistant answers
// only reference real published properties with matching catalog data and do
// not leak contacts. Usage: npm run verify:live [https://site]
const base = (
  process.argv[2] ||
  process.env.LIVE_URL ||
  "https://477a-oc71-643k.gw-1a.dockhost.net"
).replace(/\/$/, "");

let failures = 0;
let warnings = 0;
function pass(name) {
  console.log(`PASS ${name}`);
}
function fail(name, detail = "") {
  failures += 1;
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
}
function warn(name, detail = "") {
  warnings += 1;
  console.log(`WARN ${name}${detail ? `: ${detail}` : ""}`);
}
function check(name, condition, detail) {
  if (condition) pass(name);
  else fail(name, detail);
}

async function request(path, init = {}) {
  // Brief retries cover container restarts during a Dockhost deployment.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(base + path, init);
      if ([502, 503, 504].includes(response.status) && attempt < 3) {
        await new Promise((done) => setTimeout(done, 2000));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((done) => setTimeout(done, 2000));
    }
  }
  throw lastError;
}

async function json(path, init) {
  const response = await request(path, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* Reported by the caller through status checks. */
  }
  return { response, body };
}

const PHONE = /(?:\+7|8)[\s(]*\d{3}[\s)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/;
const EMAIL = /\S+@\S+\.\S+/;

async function checkAssistant() {
  const info = await json("/api/assistant");
  check(
    "assistant endpoint",
    info.response.status === 200 && typeof info.body?.mode === "string",
    JSON.stringify(info.body),
  );

  const session = await request("/api/auth/session");
  const csrf = (await session.json())?.csrfToken;
  const cookie = (session.headers.getSetCookie?.() || [])
    .map((value) => value.split(";")[0])
    .join("; ");
  check("session and CSRF token", session.status === 200 && Boolean(csrf));

  const withoutToken = await request("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Офис" }] }),
  });
  check(
    "assistant rejects POST without CSRF",
    withoutToken.status === 403,
    String(withoutToken.status),
  );

  const queries = ["Офис в Москве в аренду", "Склад в Москве"];
  let checked = 0;
  for (const query of queries) {
    const answer = await json("/api/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        Cookie: cookie,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: query }] }),
    });
    if (answer.response.status === 429) {
      warn(`assistant query "${query}"`, "rate limited, skipped");
      continue;
    }
    check(
      `assistant query "${query}"`,
      answer.response.status === 200 && typeof answer.body?.reply === "string",
      String(answer.response.status),
    );
    const properties = Array.isArray(answer.body?.properties)
      ? answer.body.properties
      : [];
    if (!properties.length) {
      warn(`assistant query "${query}"`, "no properties returned");
      continue;
    }
    checked += properties.length;
    const raw = JSON.stringify(answer.body);
    check(
      `assistant "${query}" leaks no contacts`,
      !PHONE.test(raw) && !EMAIL.test(raw),
    );
    for (const item of properties) {
      const detail = await json(`/api/properties/${item.id}`);
      const property = detail.body?.property;
      const matches =
        detail.response.status === 200 &&
        property?.status === "published" &&
        property.id === item.id &&
        property.title === item.title &&
        property.city === item.city &&
        property.deal === item.deal &&
        property.category === item.category &&
        Number(property.price) === Number(item.price) &&
        Number(property.area) === Number(item.area);
      check(`assistant property ${item.id} matches catalog`, matches);
    }
  }
  check(
    "assistant returns catalog matches",
    checked > 0,
    "no properties for any query",
  );
}

async function main() {
  const health = await json("/api/health");
  check(
    "health",
    health.response.status === 200 && health.body?.status === "ok",
    JSON.stringify(health.body),
  );

  const home = await request("/");
  check(
    "home page",
    home.status === 200 &&
      (home.headers.get("content-type") || "").includes("text/html"),
    String(home.status),
  );
  check("home marker", (await home.text()).includes("Место Бизнес"));

  const content = await json("/api/content");
  check(
    "editable home content",
    content.response.status === 200 &&
      ["heroTitle", "heroText", "commissionTitle", "commissionText"].every(
        (key) => typeof content.body?.[key] === "string",
      ),
  );

  for (const asset of [
    "/styles.css",
    "/js/assistant.js",
    "/assets/vendor/architectural-viewer.js",
  ]) {
    const response = await request(asset);
    check(`asset ${asset}`, response.status === 200, String(response.status));
  }

  await checkAssistant();

  console.log(
    `\nverify:live ${base}: ${failures} failure(s), ${warnings} warning(s)`,
  );
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
