import { randomUUID } from "node:crypto";
import { parse, searchSchema } from "./validation.js";
import {
  historySchema,
  prompt,
  publicProperty,
  toolProperties,
  unavailable,
} from "./assistant-service.js";

const functions = [
  {
    name: "search_properties",
    description:
      "Поиск реально опубликованной коммерческой недвижимости. Цена аренды всего объекта в месяц, площадь в м². Вернёт до 6 объектов и общее число совпадений.",
    parameters: {
      type: "object",
      properties: toolProperties,
    },
  },
];

function providerReason(status, data) {
  const message = String(data?.message || "");
  if (status === 401) return "invalid_api_key";
  if (status === 403)
    return /token|quota|limit|balance|токен|баланс|лимит/i.test(message)
      ? "quota_exceeded"
      : "access_denied";
  if (status === 429)
    return /token|quota|limit|balance|токен|баланс|лимит/i.test(message)
      ? "quota_exceeded"
      : "rate_limited";
  if (status === 404) return "model_unavailable";
  if (status === 400 || status === 422) return "invalid_request";
  return "provider_error";
}

export function createGigaChatAssistant({
  apiKey,
  model,
  baseUrl,
  oauthUrl,
  scope = "GIGACHAT_API_PERS",
  search,
  fetchImpl = fetch,
}) {
  const authorizationKey =
    apiKey && apiKey.includes(":")
      ? Buffer.from(apiKey).toString("base64")
      : apiKey;
  const chatUrl = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  let token;
  let pendingToken;

  async function accessToken(signal) {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    if (!pendingToken) {
      pendingToken = (async () => {
        const response = await fetchImpl(oauthUrl, {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            RqUID: randomUUID(),
            Authorization: `Basic ${authorizationKey}`,
          },
          body: new URLSearchParams({ scope }).toString(),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
          throw unavailable(providerReason(response.status, data));
        if (!data.access_token) throw unavailable();
        const expiresAt =
          Number(data.expires_at) || Date.now() + 25 * 60 * 1000;
        token = {
          value: data.access_token,
          expiresAt: expiresAt < 1e12 ? expiresAt * 1000 : expiresAt,
        };
        return token.value;
      })().finally(() => {
        pendingToken = undefined;
      });
    }
    return pendingToken;
  }

  return async (history) => {
    if (!apiKey || !model)
      throw Object.assign(
        new Error(
          "ИИ-помощник ещё не подключён. Пока используйте поиск в каталоге.",
        ),
        { status: 503 },
      );
    const messages = [
      { role: "system", content: prompt },
      ...parse(historySchema, history),
    ];
    const signal = AbortSignal.timeout(25000);
    let properties = [];
    let phase = "provider";
    try {
      for (let step = 0; step < 4; step++) {
        phase = "network";
        const accessTokenValue = await accessToken(signal);
        const response = await fetchImpl(chatUrl, {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${accessTokenValue}`,
          },
          body: JSON.stringify({
            model,
            messages,
            functions,
            function_call: step === 3 ? "none" : "auto",
            max_tokens: 1000,
            temperature: 0.3,
          }),
        });
        phase = "provider";
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw unavailable(providerReason(response.status, data));
        }
        const message = (await response.json()).choices?.[0]?.message;
        if (!message) throw unavailable();
        if (!message.function_call) {
          if (typeof message.content !== "string" || !message.content.trim())
            throw unavailable();
          return { reply: message.content.trim().slice(0, 2000), properties };
        }
        if (step === 3) throw unavailable();
        const call = message.function_call;
        if (
          call.name !== "search_properties" ||
          !call.arguments ||
          typeof call.arguments !== "object" ||
          Array.isArray(call.arguments)
        )
          throw unavailable();
        messages.push({
          role: "assistant",
          content: "",
          function_call: call,
          ...(message.functions_state_id
            ? { functions_state_id: message.functions_state_id }
            : {}),
        });
        let filters;
        try {
          if (
            Object.keys(call.arguments).some(
              (key) => !Object.hasOwn(toolProperties, key),
            )
          )
            throw new Error("Invalid filters");
          filters = parse(searchSchema, {
            ...call.arguments,
            page: 1,
            limit: 6,
            sort: "price_asc",
          });
        } catch {
          messages.push({
            role: "function",
            name: "search_properties",
            content: JSON.stringify({
              error:
                "Некорректные параметры поиска. Уточни условия и используй только разрешённые фильтры.",
            }),
          });
          continue;
        }
        phase = "search";
        const result = await search(filters, null, "public");
        phase = "provider";
        properties = result.items
          .slice(0, 6)
          .map(publicProperty)
          .filter(Boolean);
        messages.push({
          role: "function",
          name: "search_properties",
          content: JSON.stringify({ total: result.total, properties }),
        });
      }
    } catch (error) {
      if (error?.status === 503) throw error;
      throw unavailable(
        signal.aborted
          ? "timeout"
          : phase === "network"
            ? "network_error"
            : phase === "search"
              ? "search_failed"
              : "provider_error",
      );
    }
    throw unavailable();
  };
}
