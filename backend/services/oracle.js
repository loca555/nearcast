/**
 * AI-Оракул — ОТКЛЮЧЁН
 *
 * resolve_market и void_market удалены из контракта.
 * Все рынки разрешаются через OutLayer TEE (ESPN Oracle).
 * Логи и бюджет AI остаются для справки.
 */

import Database from "better-sqlite3";

let db = null;

// ── Инициализация БД (только для логов) ───────────────────────

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

// ── Получение логов ───────────────────────────────────────────

export function getResolutionLogs(limit = 50) {
  const database = initDb();
  return database
    .prepare("SELECT * FROM resolutions ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}

// ── Заглушки (AI Oracle отключён) ────────────────────────────

export function startOracle() {
  console.log("[oracle] AI Oracle отключён — рынки разрешаются через OutLayer TEE");
}

export function stopOracle() {
  // ничего не делаем
}
