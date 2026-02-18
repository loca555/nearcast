/**
 * Сервис чата — сообщения привязаны к рынкам
 *
 * SQLite (better-sqlite3), синхронные запросы.
 * Каждый рынок имеет свой чат.
 */

import Database from "better-sqlite3";

let db = null;

function initDb() {
  if (db) return db;
  db = new Database("nearcast-oracle.db");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id INTEGER NOT NULL,
      account_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_market ON chat_messages(market_id, created_at);
  `);
  return db;
}

/**
 * Получить сообщения чата для рынка
 * @param {number} marketId
 * @param {number} limit — максимум сообщений (по умолчанию 50)
 * @param {number} afterId — вернуть только сообщения с id > afterId (для polling)
 */
export function getMessages(marketId, limit = 50, afterId = 0) {
  const database = initDb();
  if (afterId > 0) {
    return database
      .prepare(
        "SELECT id, market_id, account_id, message, created_at FROM chat_messages WHERE market_id = ? AND id > ? ORDER BY created_at ASC LIMIT ?"
      )
      .all(marketId, afterId, limit);
  }
  return database
    .prepare(
      "SELECT id, market_id, account_id, message, created_at FROM chat_messages WHERE market_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(marketId, limit)
    .reverse(); // Последние N, но в хронологическом порядке
}

/**
 * Добавить сообщение в чат
 * @param {number} marketId
 * @param {string} accountId — NEAR аккаунт отправителя
 * @param {string} message — текст сообщения (max 500 символов)
 */
export function addMessage(marketId, accountId, message) {
  if (!accountId || typeof accountId !== "string") {
    throw new Error("accountId is required");
  }
  if (!message || typeof message !== "string") {
    throw new Error("message is required");
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) throw new Error("message is empty");
  if (trimmed.length > 500) throw new Error("message too long (max 500 chars)");

  const database = initDb();
  const result = database
    .prepare(
      "INSERT INTO chat_messages (market_id, account_id, message) VALUES (?, ?, ?)"
    )
    .run(marketId, accountId.trim(), trimmed);

  return {
    id: result.lastInsertRowid,
    market_id: marketId,
    account_id: accountId.trim(),
    message: trimmed,
    created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
}
