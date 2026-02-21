/**
 * API маршруты NearCast
 */

import { Router } from "express";
import Database from "better-sqlite3";
import {
  getMarkets,
  getMarket,
  getOdds,
  getMarketBets,
  getUserBets,
  getStats,
  getBalance,
  seedLiquidity,
} from "../services/near.js";
import { getResolutionLogs } from "../services/oracle.js";
import {
  SPORTS_CONFIG,
  MARKET_TYPES,
  getUpcomingMatches,
  generateMarket,
} from "../services/market-validator.js";
import { getSpendingSummary } from "../services/spending-tracker.js";

const router = Router();

// ── Pending Resolution tracking (cross-device) ──────────────────

let pendingDb = null;
function getPendingDb() {
  if (pendingDb) return pendingDb;
  pendingDb = new Database("nearcast-oracle.db");
  pendingDb.pragma("journal_mode = WAL");
  pendingDb.exec(`
    CREATE TABLE IF NOT EXISTS pending_resolutions (
      market_id INTEGER PRIMARY KEY,
      method TEXT NOT NULL DEFAULT 'outlayer',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return pendingDb;
}

// ── Рынки ─────────────────────────────────────────────────────

// Список рынков (с pending resolution статусами)
router.get("/markets", async (req, res, next) => {
  try {
    const { from_index, limit, category, status } = req.query;
    const markets = await getMarkets({
      from_index: from_index ? parseInt(from_index) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      category: category || undefined,
      status: status || undefined,
    });
    // Добавляем pendingResolution к рынкам
    try {
      const db = getPendingDb();
      const pendings = db.prepare("SELECT market_id, method, created_at FROM pending_resolutions").all();
      const pendingMap = {};
      const now = Date.now();
      for (const p of pendings) {
        const age = now - new Date(p.created_at + "Z").getTime();
        if (age < 10 * 60 * 1000) pendingMap[p.market_id] = p.method;
      }
      for (const m of markets) {
        if (pendingMap[m.id]) m.pendingResolution = pendingMap[m.id];
      }
    } catch { /* не критично */ }
    res.json(markets);
  } catch (err) {
    next(err);
  }
});

// Детали рынка
router.get("/markets/:id", async (req, res, next) => {
  try {
    const market = await getMarket(parseInt(req.params.id));
    if (!market) return res.status(404).json({ error: "Рынок не найден" });
    res.json(market);
  } catch (err) {
    next(err);
  }
});

// Коэффициенты рынка
router.get("/markets/:id/odds", async (req, res, next) => {
  try {
    const odds = await getOdds(parseInt(req.params.id));
    if (!odds) return res.status(404).json({ error: "Рынок не найден" });
    res.json(odds);
  } catch (err) {
    next(err);
  }
});

// Ставки на рынке
router.get("/markets/:id/bets", async (req, res, next) => {
  try {
    const bets = await getMarketBets(parseInt(req.params.id));
    res.json(bets);
  } catch (err) {
    next(err);
  }
});

// ── Чат рынка ─────────────────────────────────────────────────

import { getMessages, getReplies, addMessage } from "../services/chat.js";

// Сообщения чата рынка
router.get("/markets/:id/chat", (req, res, next) => {
  try {
    const marketId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 50;
    const afterId = parseInt(req.query.after) || 0;
    const messages = getMessages(marketId, limit, afterId);
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// Ответы на сообщение (тред)
router.get("/markets/:id/chat/:messageId/replies", (req, res, next) => {
  try {
    const messageId = parseInt(req.params.messageId);
    const replies = getReplies(messageId);
    res.json(replies);
  } catch (err) {
    next(err);
  }
});

// Отправка сообщения в чат (с поддержкой replyTo)
router.post("/markets/:id/chat", (req, res, next) => {
  try {
    const marketId = parseInt(req.params.id);
    const { accountId, message, replyTo } = req.body;
    const result = addMessage(marketId, accountId, message, replyTo || null);
    res.json(result);
  } catch (err) {
    if (err.message.includes("required") || err.message.includes("empty") || err.message.includes("too long") || err.message.includes("not found")) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ── Пользователь ──────────────────────────────────────────────

// Ставки пользователя
router.get("/user/:accountId/bets", async (req, res, next) => {
  try {
    const bets = await getUserBets(req.params.accountId);
    res.json(bets);
  } catch (err) {
    next(err);
  }
});

// Внутренний баланс пользователя
router.get("/balance/:accountId", async (req, res, next) => {
  try {
    const balance = await getBalance(req.params.accountId);
    res.json({ balance });
  } catch (err) {
    next(err);
  }
});

// ── Статистика ────────────────────────────────────────────────

router.get("/stats", async (_req, res, next) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// ── Создание рынка — конфигурация и AI-валидация ──────────────

// Конфигурация доступных видов спорта, стран, лиг
router.get("/sports-config", (_req, res) => {
  res.json({ sports: SPORTS_CONFIG, marketTypes: MARKET_TYPES });
});

// AI: ближайшие матчи лиги (на 2 недели вперёд)
router.post("/upcoming-matches", async (req, res, next) => {
  try {
    const { sport, country, league } = req.body;

    if (!sport || !country || !league) {
      return res.status(400).json({ error: "Укажите спорт, страну и лигу" });
    }

    const result = await getUpcomingMatches({ sport, country, league });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// AI: сгенерировать рынок для выбранного матча + типа
router.post("/generate-market", async (req, res, next) => {
  try {
    const { sport, country, league, teamA, teamB, matchDate, marketType, lang } = req.body;

    if (!sport || !country || !league || !teamA || !teamB || !matchDate || !marketType) {
      return res.status(400).json({ error: "Заполните все обязательные поля" });
    }

    const result = await generateMarket({
      sport, country, league, teamA, teamB, matchDate, marketType,
      espnEventId: req.body.espnEventId, lang: lang || "ru",
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Оракул (логи и бюджет) ───────────────────────────────────

// Бюджет API
router.get("/oracle/budget", (_req, res, next) => {
  try {
    const summary = getSpendingSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Логи оракула
router.get("/oracle/logs", async (req, res, next) => {
  try {
    const logs = getResolutionLogs(parseInt(req.query.limit) || 50);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// ── Pending Resolution (cross-device tracking) ──────────────────

// Отметить что отправлен запрос на разрешение (после on-chain TX)
router.post("/markets/:id/pending-resolution", (req, res) => {
  try {
    const db = getPendingDb();
    const marketId = parseInt(req.params.id);
    const method = req.body.method || "outlayer";
    db.prepare("INSERT OR REPLACE INTO pending_resolutions (market_id, method) VALUES (?, ?)").run(marketId, method);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Проверить статус pending resolution (для cross-device)
router.get("/markets/:id/pending-resolution", (req, res) => {
  try {
    const db = getPendingDb();
    const marketId = parseInt(req.params.id);
    const row = db.prepare("SELECT * FROM pending_resolutions WHERE market_id = ?").get(marketId);
    if (!row) return res.json({ pending: false });
    // Авто-истечение через 10 минут
    const createdAt = new Date(row.created_at + "Z").getTime();
    if (Date.now() - createdAt > 10 * 60 * 1000) {
      db.prepare("DELETE FROM pending_resolutions WHERE market_id = ?").run(marketId);
      return res.json({ pending: false });
    }
    res.json({ pending: true, method: row.method, createdAt: row.created_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить pending (вызывается когда рынок resolved)
router.delete("/markets/:id/pending-resolution", (req, res) => {
  try {
    const db = getPendingDb();
    db.prepare("DELETE FROM pending_resolutions WHERE market_id = ?").run(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ESPN Oracle — permissionless trigger ─────────────────────────

// Триггер разрешения рынка через OutLayer (кто угодно может вызвать)
router.post("/trigger-espn-resolution/:id", async (req, res, next) => {
  try {
    const { triggerResolution } = await import("../services/outlayer-relayer.js");
    const result = await triggerResolution(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Триггер разрешения рынка через TLS Oracle (MPC-TLS + ZK proof) — серверный кошелёк
router.post("/trigger-tls-resolution/:id", async (req, res, next) => {
  try {
    const { triggerTlsResolution } = await import("../services/tls-relayer.js");
    const result = await triggerTlsResolution(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Получить ESPN proof для клиентского TLS resolve (без submit — пользователь отправляет сам)
router.post("/tls-proof/:id", async (req, res, next) => {
  try {
    const market = await getMarket(parseInt(req.params.id));
    if (!market) return res.status(404).json({ error: "Рынок не найден" });

    const espnId = market.espn_event_id || market.espnEventId;
    if (!espnId) return res.status(400).json({ error: "Рынок не спортивный (нет ESPN ID)" });

    const status = market.status;
    if (status === "resolved" || status === "voided") {
      return res.status(400).json({ error: `Рынок уже ${status}` });
    }

    const sport = market.sport || "soccer";
    const league = market.league || "eng.1";

    // Запрашиваем proof у TLS Oracle backend
    const { default: config } = await import("../config.js");
    const url = `${config.tlsOracle.backendUrl}/api/prove-espn`;
    const headers = { "Content-Type": "application/json" };
    if (config.tlsOracle.apiKey) headers["X-API-Key"] = config.tlsOracle.apiKey;

    const proveResp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ espnEventId: espnId, sport, league }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!proveResp.ok) {
      const text = await proveResp.text();
      return res.status(502).json({ error: `TLS Oracle: ${text}` });
    }

    const proofData = await proveResp.json();

    // Возвращаем proof + данные для контрактов
    res.json({
      proofData,
      tlsOracleContract: config.tlsOracle.contractId,
      marketId: market.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── Seed Liquidity — авто-ставки на все исходы ──────────────────

// Вызывается после создания рынка для seed ликвидности
router.post("/seed-liquidity/:id", async (req, res, next) => {
  try {
    const result = await seedLiquidity(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
