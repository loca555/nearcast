/**
 * Тест: сравнение DeepSeek V3.1 (NEAR AI) vs Claude Sonnet 4.5 (Venice AI)
 * для задачи оракула — определение результатов спортивных матчей
 *
 * Использование:
 *   NEARAI_KEY=... node tests/test-ai-compare.js
 *
 * Или только Venice:
 *   node tests/test-ai-compare.js --venice-only
 */

import dotenv from "dotenv";
dotenv.config();

// ── Конфигурация API ────────────────────────────────────────────

const VENICE_CONFIG = {
  name: "Claude Sonnet 4.5 (Venice)",
  baseUrl: "https://api.venice.ai/api/v1",
  apiKey: process.env.VENICE_API_KEY,
  model: "claude-sonnet-45",
};

const NEARAI_CONFIG = {
  name: "DeepSeek V3.1 (NEAR AI)",
  baseUrl: "https://cloud-api.near.ai/v1",
  apiKey: process.env.NEAR_AI_API_KEY || process.env.NEARAI_KEY,
  model: "deepseek-ai/DeepSeek-V3.1",
};

// ── Тестовые кейсы — матчи с известными результатами ────────────

const TEST_CASES = [
  {
    question: "UEFA Champions League 2024/25: Real Madrid vs Manchester City, February 11, 2025 — Who wins?",
    outcomes: ["Real Madrid", "Draw", "Manchester City"],
    category: "football",
    expectedOutcome: 0, // Real Madrid won 3-2
    expectedReasoning: "Real Madrid 3-2",
  },
  {
    question: "English Premier League: Liverpool vs Everton, February 12, 2025 — Match result",
    outcomes: ["Liverpool wins", "Draw", "Everton wins"],
    category: "football",
    expectedOutcome: 1, // 2-2 draw (Tarkowski 96')
    expectedReasoning: "2-2 Draw",
  },
  {
    question: "NBA 2024-25 Season: Los Angeles Lakers vs Golden State Warriors, February 6, 2025 — Who wins?",
    outcomes: ["Lakers", "Warriors"],
    category: "basketball",
    expectedOutcome: 0, // Lakers won 120-112
    expectedReasoning: "Lakers 120-112",
  },
  {
    question: "Australian Open 2025 Men's Final: Jannik Sinner vs Alexander Zverev, January 26, 2025 — Winner",
    outcomes: ["Sinner", "Zverev"],
    category: "tennis",
    expectedOutcome: 0, // Sinner won 3-0 (6-3, 7-6, 6-3)
    expectedReasoning: "Sinner 3-0",
  },
  {
    question: "Super Bowl LIX: Philadelphia Eagles vs Kansas City Chiefs, February 9, 2025 — Who wins?",
    outcomes: ["Eagles", "Chiefs"],
    category: "american_football",
    expectedOutcome: 0, // Eagles won 40-22
    expectedReasoning: "Eagles 40-22",
  },
];

// ── Формирование промпта (как в oracle.js) ──────────────────────

function buildPrompt(testCase) {
  const outcomesText = testCase.outcomes
    .map((o, i) => `  ${i}: "${o}"`)
    .join("\n");

  return `You are a sports oracle for a prediction market. Your task is to determine the result of this event.

EVENT: ${testCase.question}

POSSIBLE OUTCOMES:
${outcomesText}

CATEGORY: ${testCase.category}

INSTRUCTIONS:
1. Search for the actual result of this event
2. If the event has already happened and the result is known — pick the correct outcome
3. If the event was cancelled, postponed, or you cannot find any information about it — set winning_outcome to -1
4. If the result is ambiguous or the event hasn't happened yet — set confidence very low (below 0.3)
5. Respond STRICTLY in JSON format

RESPONSE FORMAT (JSON only, nothing else):
{
  "winning_outcome": <outcome number from 0 to ${testCase.outcomes.length - 1}, or -1 if event not found/cancelled>,
  "confidence": <confidence from 0.0 to 1.0>,
  "reasoning": "<explanation in Russian, 1-3 sentences>"
}`;
}

// ── Вызов API ───────────────────────────────────────────────────

async function callAPI(config, prompt) {
  const body = {
    model: config.model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  };

  // Venice-специфичные параметры
  if (config.baseUrl.includes("venice.ai")) {
    body.venice_parameters = {
      include_venice_system_prompt: false,
      disable_thinking: true,
      enable_web_search: "on",
    };
  }

  const start = Date.now();

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const elapsed = Date.now() - start;

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${config.name}: HTTP ${response.status} — ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content.trim();
  const usage = data.usage || {};

  return { content, elapsed, usage };
}

// ── Парсинг JSON из ответа AI ───────────────────────────────────

function parseAIJson(text) {
  // Убираем markdown code blocks
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  // Убираем возможный текст до/после JSON
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("JSON не найден в ответе");
  cleaned = jsonMatch[0];
  // Убираем trailing commas
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
  // Убираем однострочные комментарии
  cleaned = cleaned.replace(/\/\/[^\n]*/g, "");
  return JSON.parse(cleaned);
}

// ── Основной тест ───────────────────────────────────────────────

async function runTest() {
  const veniceOnly = process.argv.includes("--venice-only");
  const nearaiOnly = process.argv.includes("--nearai-only");

  const providers = [];
  if (!nearaiOnly) {
    if (!VENICE_CONFIG.apiKey) {
      console.log("⚠ VENICE_API_KEY не задан — пропускаю Venice");
    } else {
      providers.push(VENICE_CONFIG);
    }
  }
  if (!veniceOnly) {
    if (!NEARAI_CONFIG.apiKey) {
      console.log("⚠ NEARAI_KEY не задан — пропускаю NEAR AI");
    } else {
      providers.push(NEARAI_CONFIG);
    }
  }

  if (providers.length === 0) {
    console.error("Нет доступных провайдеров. Задайте VENICE_API_KEY и/или NEARAI_KEY");
    process.exit(1);
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ТЕСТ: Сравнение AI-моделей для спортивного оракула`);
  console.log(`  Провайдеры: ${providers.map((p) => p.name).join(" vs ")}`);
  console.log(`  Тестовых кейсов: ${TEST_CASES.length}`);
  console.log(`${"═".repeat(70)}\n`);

  const results = {};
  for (const provider of providers) {
    results[provider.name] = { correct: 0, wrong: 0, noAnswer: 0, errors: 0, totalTime: 0 };
  }

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    const prompt = buildPrompt(tc);

    console.log(`\n── Тест ${i + 1}/${TEST_CASES.length}: ${tc.question.slice(0, 60)}...`);
    console.log(`   Ожидаемый ответ: ${tc.expectedOutcome} ("${tc.outcomes[tc.expectedOutcome]}") — ${tc.expectedReasoning}`);

    for (const provider of providers) {
      try {
        const { content, elapsed, usage } = await callAPI(provider, prompt);
        const parsed = parseAIJson(content);

        const isCorrect = parsed.winning_outcome === tc.expectedOutcome;
        const icon = isCorrect ? "✓" : parsed.winning_outcome === -1 ? "?" : "✗";
        const statusColor = isCorrect ? "\x1b[32m" : "\x1b[31m";

        console.log(`\n   ${statusColor}${icon}\x1b[0m ${provider.name}:`);
        console.log(`     Ответ: ${parsed.winning_outcome} ("${tc.outcomes[parsed.winning_outcome] || "N/A"}")`);
        console.log(`     Уверенность: ${parsed.confidence}`);
        console.log(`     Reasoning: ${parsed.reasoning}`);
        console.log(`     Время: ${elapsed}ms | Токены: ${usage.prompt_tokens || "?"}→${usage.completion_tokens || "?"}`);

        if (isCorrect) results[provider.name].correct++;
        else if (parsed.winning_outcome === -1) results[provider.name].noAnswer++;
        else results[provider.name].wrong++;
        results[provider.name].totalTime += elapsed;
      } catch (err) {
        console.log(`\n   ✗ ${provider.name}: ОШИБКА — ${err.message}`);
        results[provider.name].errors++;
      }
    }
  }

  // ── Итоги ──────────────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(70)}`);
  console.log(`  ИТОГИ`);
  console.log(`${"═".repeat(70)}`);

  for (const provider of providers) {
    const r = results[provider.name];
    const total = TEST_CASES.length;
    const accuracy = ((r.correct / total) * 100).toFixed(0);
    const avgTime = (r.totalTime / Math.max(total - r.errors, 1)).toFixed(0);

    console.log(`\n  ${provider.name}:`);
    console.log(`    ✓ Правильно: ${r.correct}/${total} (${accuracy}%)`);
    console.log(`    ✗ Неправильно: ${r.wrong}`);
    console.log(`    ? Не найдено: ${r.noAnswer}`);
    console.log(`    ⚠ Ошибки: ${r.errors}`);
    console.log(`    ⏱ Среднее время: ${avgTime}ms`);
  }

  console.log(`\n${"═".repeat(70)}\n`);
}

runTest().catch((err) => {
  console.error("Фатальная ошибка:", err);
  process.exit(1);
});
