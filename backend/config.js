/**
 * Конфигурация NearCast
 */

import dotenv from "dotenv";
dotenv.config();

export default {
  port: process.env.PORT || 4001,
  frontendUrl: process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001"),

  near: {
    network: process.env.NEAR_NETWORK || "testnet",
    nodeUrl:
      process.env.NEAR_NODE_URL ||
      (process.env.NEAR_NETWORK === "mainnet"
        ? "https://free.rpc.fastnear.com"
        : "https://test.rpc.fastnear.com"),
    contractId: process.env.NEARCAST_CONTRACT || "",
  },

  oracle: {
    // Серверный аккаунт оракула (приватный ключ для подписи resolve_market)
    accountId: process.env.ORACLE_ACCOUNT_ID || "",
    privateKey: process.env.ORACLE_PRIVATE_KEY || "",
    // Интервал проверки рынков (мс)
    checkInterval: parseInt(process.env.ORACLE_CHECK_INTERVAL || "300000"), // 5 минут
    // Лимит расходов на API ($)
    budgetLimit: parseFloat(process.env.API_BUDGET_LIMIT || "5"),
  },

  // TLS Oracle — альтернативный oracle-провайдер (MPC-TLS + ZK proof)
  tlsOracle: {
    backendUrl: process.env.TLS_ORACLE_BACKEND_URL || "http://127.0.0.1:4001",
    contractId:
      process.env.TLS_ORACLE_CONTRACT ||
      "tls-oracle-v2.nearcast-oracle.testnet",
    apiKey: process.env.TLS_ORACLE_API_KEY || "",
  },

  // Venice AI API (OpenAI-совместимый)
  ai: {
    apiKey: process.env.VENICE_API_KEY || "",
    baseUrl: process.env.AI_BASE_URL || "https://api.venice.ai/api/v1",
    model: process.env.AI_MODEL || "claude-sonnet-45",
  },

};
