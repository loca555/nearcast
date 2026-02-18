/**
 * Сервис чата — сообщения привязаны к рынкам
 *
 * SQLite (better-sqlite3), синхронные запросы.
 * Каждый рынок имеет свой чат с поддержкой тредов (reply_to).
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
      reply_to INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_market ON chat_messages(market_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_reply ON chat_messages(reply_to);
  `);

  // Миграция: добавляем reply_to если таблица уже существовала без него
  try {
    db.exec("ALTER TABLE chat_messages ADD COLUMN reply_to INTEGER DEFAULT NULL");
  } catch { /* колонка уже существует */ }

  return db;
}

/**
 * Получить сообщения чата для рынка (с количеством ответов для каждого)
 */
export function getMessages(marketId, limit = 50, afterId = 0) {
  const database = initDb();

  if (afterId > 0) {
    return database
      .prepare(`
        SELECT m.id, m.market_id, m.account_id, m.message, m.reply_to, m.created_at,
          (SELECT COUNT(*) FROM chat_messages r WHERE r.reply_to = m.id) as reply_count
        FROM chat_messages m
        WHERE m.market_id = ? AND m.id > ?
        ORDER BY m.created_at ASC LIMIT ?
      `)
      .all(marketId, afterId, limit);
  }

  return database
    .prepare(`
      SELECT m.id, m.market_id, m.account_id, m.message, m.reply_to, m.created_at,
        (SELECT COUNT(*) FROM chat_messages r WHERE r.reply_to = m.id) as reply_count
      FROM chat_messages m
      WHERE m.market_id = ?
      ORDER BY m.created_at DESC LIMIT ?
    `)
    .all(marketId, limit)
    .reverse();
}

/**
 * Получить ответы на конкретное сообщение (тред)
 */
export function getReplies(messageId, limit = 50) {
  const database = initDb();
  return database
    .prepare(`
      SELECT id, market_id, account_id, message, reply_to, created_at
      FROM chat_messages
      WHERE reply_to = ?
      ORDER BY created_at ASC LIMIT ?
    `)
    .all(messageId, limit);
}

/**
 * Добавить сообщение в чат
 * @param {number} marketId
 * @param {string} accountId
 * @param {string} message — max 500 символов
 * @param {number|null} replyTo — id родительского сообщения (для тредов)
 */
export function addMessage(marketId, accountId, message, replyTo = null) {
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

  // Проверяем что parent существует и принадлежит тому же рынку
  if (replyTo) {
    const parent = database
      .prepare("SELECT id, market_id FROM chat_messages WHERE id = ?")
      .get(replyTo);
    if (!parent) throw new Error("parent message not found");
    if (parent.market_id !== marketId) throw new Error("parent message belongs to another market");
  }

  const result = database
    .prepare(
      "INSERT INTO chat_messages (market_id, account_id, message, reply_to) VALUES (?, ?, ?, ?)"
    )
    .run(marketId, accountId.trim(), trimmed, replyTo || null);

  return {
    id: Number(result.lastInsertRowid),
    market_id: marketId,
    account_id: accountId.trim(),
    message: trimmed,
    reply_to: replyTo || null,
    reply_count: 0,
    created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
}
