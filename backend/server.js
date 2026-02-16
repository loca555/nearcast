/**
 * NearCast Server — Prediction Market Platform
 *
 * Предсказательные рынки на NEAR с AI-оракулом
 */

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import config from "./config.js";
import apiRoutes from "./routes/api.js";
import { startOracle, stopOracle } from "./services/oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ── Middleware ─────────────────────────────────────────────────
if (config.frontendUrl) {
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
}
app.use(express.json());

// Логирование запросов
app.use((req, _res, next) => {
  if (req.path !== "/api/health") {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ── Маршруты ──────────────────────────────────────────────────
app.use("/api", apiRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "nearcast",
    version: "1.0.0",
    oracle: config.ai.apiKey ? "configured" : "no API key",
    contract: config.near.contractId || "not set",
    time: new Date().toISOString(),
  });
});

app.get("/api/near-config", (_req, res) => {
  res.json({
    networkId: config.near.network,
    nodeUrl: config.near.nodeUrl,
    contractId: config.near.contractId,
  });
});

// ── Обработчик ошибок ─────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(`[ERROR] ${err.message}`);

  // AI API ошибки — показываем понятное сообщение
  if (err.message?.includes("Venice API") || err.message?.includes("AI ")) {
    return res.status(503).json({ error: err.message });
  }

  res.status(err.status || 500).json({ error: err.message });
});

// ── Статика (production) ──────────────────────────────────────
const publicDir = path.join(__dirname, "public");
import { existsSync } from "fs";
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

// ── Запуск ────────────────────────────────────────────────────
app.listen(config.port, () => {
  const contract = config.near.contractId || "НЕ УСТАНОВЛЕН";
  const oracleStatus = config.ai.apiKey ? "✓" : "✗ нет API ключа";

  console.log(`
  ╔══════════════════════════════════════════╗
  ║   ◈ NearCast — Prediction Markets       ║
  ║   Порт: ${String(config.port).padEnd(33)}║
  ║   Контракт: ${contract.padEnd(29)}║
  ║   Оракул: ${oracleStatus.padEnd(31)}║
  ║   Сеть: ${config.near.network.padEnd(33)}║
  ╚══════════════════════════════════════════╝
  `);

  // Запускаем AI-оракул
  if (config.ai.apiKey && config.near.contractId) {
    startOracle();
  } else {
    console.log("[oracle] Оракул не запущен — проверьте VENICE_API_KEY и NEARCAST_CONTRACT");
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nЗавершение работы...");
  stopOracle();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopOracle();
  process.exit(0);
});
