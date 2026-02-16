/**
 * Трекер расходов на Venice AI API
 *
 * Отслеживает каждый вызов API, считает стоимость по токенам,
 * блокирует запросы при превышении бюджета ($5 по умолчанию).
 */

import Database from "better-sqlite3";
import config from "../config.js";

let db = null;

// Цены Venice AI ($ за 1M токенов) — актуальные на февраль 2026
const MODEL_PRICING = {
  "qwen3-235b-a22b-instruct-2507": { input: 0.15, output: 0.75 },
  "qwen3-235b-a22b-thinking-2507": { input: 0.45, output: 3.50 },
  "deepseek-v3.2":    { input: 0.40, output: 1.00 },
  "llama-3.3-70b":    { input: 0.70, output: 2.80 },
  "google-gemma-3-27b-it": { input: 0.12, output: 0.20 },
  "grok-41-fast":     { input: 0.50, output: 1.25 },
};

// Цена по умолчанию
const DEFAULT_PRICING = { input: 0.50, output: 1.00 };

function initDb() {
  if (db) return db;
  db = new Database("nearcast-oracle.db");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

/**
 * Рассчитать стоимость вызова
 */
function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Записать использование после вызова API
 * @param {string} service — "oracle" или "validator"
 * @param {object} usage — { model, input_tokens, output_tokens }
 */
export function trackUsage(service, usage) {
  const database = initDb();
  const { model, input_tokens, output_tokens } = usage;
  const cost = calculateCost(model, input_tokens, output_tokens);

  database.prepare(`
    INSERT INTO api_usage (service, model, input_tokens, output_tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?)
  `).run(service, model, input_tokens, output_tokens, cost);

  console.log(
    `[budget] ${service}: ${input_tokens}in + ${output_tokens}out = $${cost.toFixed(4)}`
  );

  return cost;
}

/**
 * Получить общую сумму расходов
 */
export function getTotalSpent() {
  const database = initDb();
  const row = database
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_usage")
    .get();
  return row.total;
}

/**
 * Проверить бюджет перед вызовом API
 * Бросает ошибку если лимит исчерпан
 */
export function checkBudget() {
  const spent = getTotalSpent();
  const limit = config.oracle.budgetLimit;
  const remaining = limit - spent;

  if (remaining <= 0) {
    throw new Error(
      `Бюджет API исчерпан: потрачено $${spent.toFixed(4)} из $${limit.toFixed(2)}. ` +
      `Увеличьте API_BUDGET_LIMIT в .env`
    );
  }

  // Предупреждение когда осталось менее 10%
  if (remaining < limit * 0.1) {
    console.warn(
      `[budget] ⚠ Осталось $${remaining.toFixed(4)} из $${limit.toFixed(2)}`
    );
  }

  return { spent, limit, remaining };
}

/**
 * Полная сводка по расходам (для API)
 */
export function getSpendingSummary() {
  const database = initDb();
  const limit = config.oracle.budgetLimit;
  const spent = getTotalSpent();

  const byService = database
    .prepare(`
      SELECT service,
             COUNT(*) as calls,
             SUM(input_tokens) as total_input,
             SUM(output_tokens) as total_output,
             SUM(cost_usd) as total_cost
      FROM api_usage GROUP BY service
    `)
    .all();

  const recent = database
    .prepare(
      "SELECT * FROM api_usage ORDER BY created_at DESC LIMIT 10"
    )
    .all();

  return {
    budget: limit,
    spent: Math.round(spent * 10000) / 10000,
    remaining: Math.round((limit - spent) * 10000) / 10000,
    percentUsed: Math.round((spent / limit) * 10000) / 100,
    byService,
    recentCalls: recent,
  };
}
