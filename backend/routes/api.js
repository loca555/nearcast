/**
 * API маршруты NearCast
 */

import { Router } from "express";
import {
  getMarkets,
  getMarket,
  getOdds,
  getMarketBets,
  getUserBets,
  getStats,
  getBalance,
} from "../services/near.js";
import { manualResolve, getResolutionLogs } from "../services/oracle.js";
import {
  SPORTS_CONFIG,
  MARKET_TYPES,
  getUpcomingMatches,
  generateMarket,
} from "../services/market-validator.js";
import { getSpendingSummary } from "../services/spending-tracker.js";
import config from "../config.js";

const router = Router();

// ── Рынки ─────────────────────────────────────────────────────

// Список рынков
router.get("/markets", async (req, res, next) => {
  try {
    const { from_index, limit, category, status } = req.query;
    const markets = await getMarkets({
      from_index: from_index ? parseInt(from_index) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      category: category || undefined,
      status: status || undefined,
    });
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
      sport, country, league, teamA, teamB, matchDate, marketType, lang: lang || "ru",
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Оракул (admin) ────────────────────────────────────────────

// Ручное разрешение рынка
router.post("/oracle/resolve/:id", async (req, res, next) => {
  try {
    // Простая проверка — в продакшене нужна полноценная авторизация
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== config.oracle.privateKey?.slice(0, 16)) {
      return res.status(403).json({ error: "Доступ запрещён" });
    }

    const result = await manualResolve(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

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

export default router;
