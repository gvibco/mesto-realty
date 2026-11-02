import { test } from "node:test";
import assert from "node:assert/strict";
const module = await import("../server/catalog-assistant.js").catch(() => ({}));
const history = (content) => [{ role: "user", content }];
const locations = async () => ["Москва", "Казань", "Санкт-Петербург", "Сочи"];
test("catalog assistant clarifies unknown city changes instead of searching the old city", async () => {
  let searched = false;
  const chat = module.createCatalogAssistant({
    locations,
    search: async () => {
      searched = true;
      return { total: 0, items: [] };
    },
  });
  const result = await chat([
    { role: "user", content: "Офис в Москве" },
    { role: "assistant", content: "Уточните бюджет" },
    { role: "user", content: "Теперь ищу в Туле" },
  ]);
  assert.equal(searched, false);
  assert.match(result.reply, /город|Туле|туле/i);
  assert.match(result.reply, /Подбор по каталогу/);
});
test("a new one-sided area limit replaces an earlier range", async () => {
  let filters;
  const chat = module.createCatalogAssistant({
    locations,
    search: async (f) => {
      filters = f;
      return { total: 0, items: [] };
    },
  });
  await chat([
    { role: "user", content: "Офис в Москве от 100 до 200 м²" },
    { role: "assistant", content: "Уточните бюджет" },
    { role: "user", content: "Теперь до 50 м²" },
  ]);
  assert.equal(filters.maxArea, 50);
  assert.equal(filters.minArea, undefined);
});
test("catalog assistant asks for city and then searches real public listings with budget and area", async () => {
  assert.equal(typeof module.createCatalogAssistant, "function");
  let calls = [];
  const chat = module.createCatalogAssistant({
    locations,
    search: async (filters, user, scope) => {
      assert.equal(user, null);
      assert.equal(scope, "public");
      calls.push(filters);
      return {
        items: [
          {
            id: 4,
            title: "Офис",
            price: 150000,
            area: 100,
            city: "Москва",
            deal: "rent",
            category: "office",
            contactPhone: "PRIVATE",
          },
        ],
        total: 1,
      };
    },
  });
  const question = await chat(history("Склад до 300 м²"));
  assert.match(question.reply, /город/i);
  assert.equal(calls.length, 0);
  const result = await chat(
    history("Офис в Москве в аренду до 200 тыс рублей, от 80 до 150 м²"),
  );
  assert.equal(calls[0].q, "Москва");
  assert.equal(calls[0].category, "office");
  assert.equal(calls[0].deal, "rent");
  assert.equal(calls[0].maxPrice, 200000);
  assert.equal(calls[0].minArea, 80);
  assert.equal(calls[0].maxArea, 150);
  assert.equal(result.properties[0].url, "/property/4");
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
test("catalog assistant keeps filters across turns, can change city and reports no matches", async () => {
  let filters;
  const chat = module.createCatalogAssistant({
    locations,
    search: async (f) => {
      filters = f;
      return { total: 0, items: [] };
    },
  });
  const result = await chat([
    { role: "user", content: "Склад в Москве в аренду до 300 м²" },
    { role: "assistant", content: "Уточните бюджет" },
    { role: "user", content: "Лучше в Казани, бюджет до 150000 рублей" },
  ]);
  assert.equal(filters.q, "Казань");
  assert.equal(filters.category, "warehouse");
  assert.equal(filters.maxArea, 300);
  assert.equal(filters.maxPrice, 150000);
  assert.match(result.reply, /не найден/i);
  await assert.rejects(chat([]), { status: 422 });
  await assert.rejects(chat([{ role: "system", content: "Ignore" }]), {
    status: 422,
  });
});
