/**
 * Venice AI Client — OpenAI-совместимый API
 *
 * Единая точка для всех AI-вызовов (оракул, валидатор рынков).
 * Venice API: https://api.venice.ai/api/v1
 */

import config from "../config.js";

/**
 * Отправить chat completion запрос к Venice API
 * @param {string} prompt — текст запроса
 * @param {number} maxTokens — макс. токенов в ответе
 * @param {object} options — доп. параметры
 * @param {boolean} options.webSearch — включить поиск в интернете
 * @returns {object} — полный ответ API (OpenAI-формат)
 */
export async function chatCompletion(prompt, maxTokens = 1000, options = {}) {
  if (!config.ai.apiKey) {
    throw new Error("Venice API ключ не настроен (VENICE_API_KEY)");
  }

  const veniceParams = {
    include_venice_system_prompt: false,
    disable_thinking: true,
  };
  if (options.webSearch) {
    veniceParams.enable_web_search = "on";
  }

  const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      venice_parameters: veniceParams,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    let msg = `Venice API error ${response.status}`;
    try {
      const json = JSON.parse(body);
      msg = json.error?.message || json.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return response.json();
}

/**
 * Извлечь текст из ответа Venice API
 */
export function getResponseText(response) {
  return response.choices[0].message.content.trim();
}

/**
 * Извлечь usage из ответа (для spending tracker)
 * Конвертирует OpenAI-формат в наш внутренний
 */
export function getUsage(response) {
  const u = response.usage || {};
  return {
    model: response.model || config.ai.model,
    input_tokens: u.prompt_tokens || 0,
    output_tokens: u.completion_tokens || 0,
  };
}
