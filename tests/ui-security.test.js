import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  safeReturnPath,
  esc,
  safeImage,
  select,
  empty,
} from "../public/js/core.js";

test("number inputs hide native spinner arrows", async () => {
  const css = await readFile(
    new URL("../public/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /input\[type="number"\]\s*\{[^}]*appearance:\s*textfield/s);
  assert.match(
    css,
    /::-webkit-inner-spin-button[\s\S]*?-webkit-appearance:\s*none/,
  );
});

test("empty-state label and link come from content and are escaped", () => {
  const html = empty(
    "Ничего нет",
    "Текст",
    "/catalog",
    "<img src=x onerror=alert(1)>",
  );
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("empty filters stay unselected when option keys are numeric", () => {
  assert.match(
    select(
      "rooms",
      "Комнаты",
      { "": "Не важно", 0: "Студия", 1: "1 комната" },
      null,
    ),
    /value="" selected/,
  );
});

test("authentication return URLs cannot leave the site after URL normalization", () => {
  const origin = "https://mesto.example";
  for (const next of [
    "//evil.example",
    "/\n/evil.example",
    "/\t/evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    null,
  ]) {
    assert.equal(safeReturnPath(next, origin), "/account");
  }
  assert.equal(
    safeReturnPath("/account?tab=favorites", origin),
    "/account?tab=favorites",
  );
  assert.equal(safeReturnPath("/publish", origin), "/publish");
});
test("user text escapes HTML and quoted attributes", () => {
  assert.equal(
    esc("<img src=\"x\" onerror='alert(1)'>&"),
    "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
  );
});
test("images use only local validated media and assets paths", () => {
  for (const url of [
    "javascript:alert(1)",
    "//evil.example/x.png",
    "/media/../.env",
    '/assets/x" onerror="alert(1)',
  ])
    assert.equal(safeImage(url), "/assets/placeholder.svg");
  assert.equal(safeImage("/media/aabb.webp"), "/media/aabb.webp");
});
