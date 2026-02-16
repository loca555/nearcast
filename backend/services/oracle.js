/**
 * AI-Оракул — разрешение рынков с помощью Venice AI
 *
 * Периодически проверяет рынки с истёкшей resolutionDate
 * и вызывает AI для определения победившего исхода.
 */

import Database from "better-sqlite3";
import config from "../config.js";
import { chatCompletion, getResponseText, getUsage } from "./ai-client.js";
import { getMarkets, getMarket, resolveMarket } from "./near.js";
import { checkBudget, trackUsage } from "./spending-tracker.js";

let db = null;
let intervalId = null;

// ── Инициализация ─────────────────────────────────────────────

function initDb() {
  if (db) return db;
  db = new Database("nearcast-oracle.db");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      outcomes TEXT NOT NULL,
      winning_outcome INTEGER NOT NULL,
      reasoning TEXT NOT NULL,
      ai_response TEXT NOT NULL,
      tx_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'pending'
    )
  `);
  return db;
}

// ── Запрос к AI ───────────────────────────────────────────────

async function askAI(market) {
  const outcomesText = market.outcomes
    .map((o, i) => `  ${i}: "${o}"`)
    .join("\n");

  const prompt = `Ты — AI-оракул для предсказательного рынка. Твоя задача — определить исход события на основе доступной информации.

ВОПРОС РЫНКА: "${market.question}"

ОПИСАНИЕ: "${market.description}"

ВАРИАНТЫ ИСХОДОВ:
${outcomesText}

КАТЕГОРИЯ: ${market.category}

ИНСТРУКЦИИ:
1. Проанализируй вопрос и определи, какой исход наиболее вероятно произошёл
2. Если событие уже произошло и результат известен — выбери правильный ответ
3. Если результат неоднозначен или событие не произошло — выбери наиболее вероятный вариант
4. Ответь СТРОГО в формате JSON

ФОРМАТ ОТВЕТА (только JSON, ничего больше):
{
  "winning_outcome": <номер исхода от 0 до ${market.outcomes.length - 1}>,
  "confidence": <уверенность от 0.0 до 1.0>,
  "reasoning": "<объяснение на русском, 1-3 предложения>"
}`;

  checkBudget();

  const response = await chatCompletion(prompt, 500, { webSearch: true });
  trackUsage("oracle", getUsage(response));

  const text = getResponseText(response);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`AI вернул невалидный ответ: ${text}`);
  }

  return JSON.parse(jsonMatch[0]);
}

// ── Разрешение одного рынка ───────────────────────────────────

async function resolveOneMarket(market) {
  const database = initDb();

  console.log(`[oracle] Разрешаю рынок #${market.id}: "${market.question}"`);

  try {
    // Спрашиваем AI
    const aiResult = await askAI(market);
    console.log(
      `[oracle] AI ответ для #${market.id}: исход=${aiResult.winning_outcome} ` +
      `(${market.outcomes[aiResult.winning_outcome]}), уверенность=${aiResult.confidence}`
    );

    // Проверяем что confidence достаточна
    if (aiResult.confidence < 0.3) {
      console.log(`[oracle] Уверенность слишком низкая (${aiResult.confidence}), пропускаю рынок #${market.id}`);
      return;
    }

    // Отправляем в контракт
    const txHash = await resolveMarket(
      market.id,
      aiResult.winning_outcome,
      aiResult.reasoning
    );

    // Сохраняем в лог
    database.prepare(`
      INSERT INTO resolutions (market_id, question, outcomes, winning_outcome, reasoning, ai_response, tx_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'resolved')
    `).run(
      market.id,
      market.question,
      JSON.stringify(market.outcomes),
      aiResult.winning_outcome,
      aiResult.reasoning,
      JSON.stringify(aiResult),
      txHash
    );

    console.log(`[oracle] ✓ Рынок #${market.id} разрешён! TX: ${txHash}`);
  } catch (err) {
    console.error(`[oracle] ✗ Ошибка разрешения рынка #${market.id}:`, err.message);

    // Логируем ошибку
    database.prepare(`
      INSERT INTO resolutions (market_id, question, outcomes, winning_outcome, reasoning, ai_response, status)
      VALUES (?, ?, ?, -1, ?, ?, 'error')
    `).run(
      market.id,
      market.question,
      JSON.stringify(market.outcomes),
      err.message,
      ""
    );
  }
}

// ── Проверка всех рынков ──────────────────────────────────────

async function checkMarkets() {
  try {
    // Получаем закрытые рынки (ставки закончились, но ещё не разрешены)
    const markets = await getMarkets({ status: "closed", limit: 50 });

    if (!markets || markets.length === 0) {
      return;
    }

    const now = BigInt(Date.now()) * BigInt(1_000_000); // в наносекунды

    for (const market of markets) {
      // Проверяем что resolutionDate наступило
      if (now >= BigInt(market.resolutionDate)) {
        await resolveOneMarket(market);
        // Пауза между разрешениями чтобы не перегружать API
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } catch (err) {
    console.error("[oracle] Ошибка при проверке рынков:", err.message);
  }
}

// ── Ручное разрешение (через API) ─────────────────────────────

export async function manualResolve(marketId) {
  const market = await getMarket(marketId);
  if (!market) throw new Error(`Рынок #${marketId} не найден`);
  if (market.status === "resolved") throw new Error("Рынок уже разрешён");

  await resolveOneMarket(market);
  return { success: true, marketId };
}

// ── Получение логов ───────────────────────────────────────────

export function getResolutionLogs(limit = 50) {
  const database = initDb();
  return database
    .prepare("SELECT * FROM resolutions ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}

// ── Запуск/остановка периодической проверки ───────────────────

export function startOracle() {
  if (intervalId) return;

  console.log(
    `[oracle] Запущен. Проверка каждые ${config.oracle.checkInterval / 1000}с`
  );

  // Первая проверка через 10 секунд
  setTimeout(checkMarkets, 10_000);

  // Затем по расписанию
  intervalId = setInterval(checkMarkets, config.oracle.checkInterval);
}

export function stopOracle() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[oracle] Остановлен");
  }
}
