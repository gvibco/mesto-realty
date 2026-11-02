import { parse, searchSchema } from "./validation.js";
import { historySchema, publicProperty } from "./assistant-service.js";

const number = "(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)";
const amount = (value) =>
  Number(value.replace(/[ \u00a0]/g, "").replace(",", "."));
const normalize = (value) =>
  value.toLowerCase().replace(/ё/g, "е").replace(/-/g, " ");
const kinds = [
  ["commercial_land", /участ|земл/],
  ["warehouse", /склад/],
  ["industrial", /производ|цех/],
  ["retail", /торгов|магазин|витрин|шоурум/],
  ["free_purpose", /свободн[а-я]*\s+назнач|студи/],
  ["office", /офис/],
];
function extract(text, cities) {
  const value = normalize(text);
  const filters = {};
  const city = cities.find((name) => {
    const stem = normalize(name).replace(/[аеуыояиюь]$/, "");
    return new RegExp(
      `(?:^|[^а-я])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[а-я]*(?:$|[^а-я])`,
    ).test(value);
  });
  if (city) filters.q = city;
  else {
    const cityRequest = [
      ...value.matchAll(/(?:^|\s)(?:в|город(?:е)?)[\s:]+([а-я-]+)/g),
    ]
      .map((match) => match[1])
      .find(
        (word) =>
          !/^(аренд|месяц|год|каталог|центр|бюджет|район|покуп|продаж|налич|рубл|метр|здан|офис|склад|бизнес|кредит|рассрочк)/.test(
            word,
          ),
      );
    if (cityRequest) filters.q = undefined;
  }
  const kind = kinds.find(([, pattern]) => pattern.test(value));
  if (kind) filters.category = kind[0];
  if (/аренд|снять|сним|сда[ею]/.test(value)) filters.deal = "rent";
  if (/куп|покуп|продаж/.test(value)) filters.deal = "sale";
  const areaRange = value.match(
    new RegExp(`от\\s*${number}\\s*до\\s*${number}\\s*(?:м²|м2|кв\\.?\\s*м)`),
  );
  if (areaRange) {
    filters.minArea = amount(areaRange[1]);
    filters.maxArea = amount(areaRange[2]);
  } else {
    const area = value.match(
      new RegExp(`(до|от|площадь(?:ю)?)\\s*${number}\\s*(?:м²|м2|кв\\.?\\s*м)`),
    );
    if (area) {
      filters.minArea = undefined;
      filters.maxArea = undefined;
      filters[area[1] === "от" ? "minArea" : "maxArea"] = amount(area[2]);
    }
  }
  const budget = value.match(
    new RegExp(
      `(?:до|бюджет(?:ом)?(?:\\s+до)?|не дороже)\\s*${number}\\s*(тыс(?:яч)?\\.?|млн\\.?|миллион(?:а|ов)?|млрд\\.?|миллиард(?:а|ов)?)?\\s*(?:руб|₽)`,
    ),
  );
  if (budget) {
    const unit = budget[2] || "";
    const multiplier = /млрд|миллиард/.test(unit)
      ? 1e9
      : /млн|миллион/.test(unit)
        ? 1e6
        : /тыс/.test(unit)
          ? 1e3
          : 1;
    filters.maxPrice = amount(budget[1]) * multiplier;
  }
  return filters;
}

export function createCatalogAssistant({ search, locations }) {
  return async (history) => {
    const messages = parse(historySchema, history);
    const cities = await locations();
    let filters = {};
    for (const message of messages) {
      if (message.role === "user")
        filters = { ...filters, ...extract(message.content, cities) };
    }
    if (!filters.q)
      return {
        reply: `Подбор по каталогу. В каком городе ищете помещение? В каталоге есть объекты: ${cities.join(", ") || "уточните город"}. Затем можно указать назначение, бюджет в рублях и площадь в м².`,
        properties: [],
        mode: "catalog",
      };
    const valid = parse(searchSchema, {
      ...filters,
      page: 1,
      limit: 6,
      sort: "price_asc",
    });
    const result = await search(valid, null, "public");
    const properties = result.items.map(publicProperty).filter(Boolean);
    const criteria = [
      valid.q,
      valid.deal === "rent"
        ? "аренда"
        : valid.deal === "sale"
          ? "покупка"
          : "любая сделка",
      valid.maxPrice !== undefined
        ? `до ${valid.maxPrice.toLocaleString("ru-RU")} ₽`
        : "без ограничения бюджета",
      valid.maxArea !== undefined
        ? `до ${valid.maxArea} м²`
        : "без ограничения площади",
    ].join(" · ");
    return {
      reply: result.total
        ? `Подбор по каталогу: по условиям «${criteria}» найдено объектов: ${result.total}. Показываю ${properties.length} из них. Уточните бюджет или площадь, чтобы сузить подбор. Проверьте условия в карточке объекта.`
        : `Подбор по каталогу: по условиям «${criteria}» объекты не найдены. Попробуйте другой город, бюджет или площадь.`,
      properties,
      mode: "catalog",
    };
  };
}
