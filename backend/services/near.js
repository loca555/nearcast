/**
 * NEAR сервис — подключение к блокчейну
 *
 * Два режима:
 * - viewAccount: бесплатные чтения (без ключей)
 * - oracleAccount: подписание транзакций оракулом (resolve_market)
 */

import { connect, keyStores, KeyPair } from "near-api-js";
import config from "../config.js";

let viewAccount = null;
let oracleAccount = null;

// ── Инициализация read-only аккаунта ──────────────────────────

async function initViewAccount() {
  if (viewAccount) return viewAccount;

  const keyStore = new keyStores.InMemoryKeyStore();
  const near = await connect({
    networkId: config.near.network,
    keyStore,
    nodeUrl: config.near.nodeUrl,
  });

  viewAccount = await near.account("dontcare");
  return viewAccount;
}

// ── Инициализация аккаунта оракула ────────────────────────────

async function initOracleAccount() {
  if (oracleAccount) return oracleAccount;

  if (!config.oracle.accountId || !config.oracle.privateKey) {
    throw new Error("ORACLE_ACCOUNT_ID и ORACLE_PRIVATE_KEY не установлены");
  }

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(config.oracle.privateKey);
  await keyStore.setKey(config.near.network, config.oracle.accountId, keyPair);

  const near = await connect({
    networkId: config.near.network,
    keyStore,
    nodeUrl: config.near.nodeUrl,
  });

  oracleAccount = await near.account(config.oracle.accountId);
  console.log(`[near] Оракул подключён: ${config.oracle.accountId}`);
  return oracleAccount;
}

// ── View методы (бесплатные) ──────────────────────────────────

export async function viewContract(methodName, args = {}) {
  if (!config.near.contractId) {
    console.warn(`[near] Контракт не установлен, пропускаю ${methodName}`);
    return null;
  }
  try {
    const account = await initViewAccount();
    return account.viewFunction({
      contractId: config.near.contractId,
      methodName,
      args,
    });
  } catch (err) {
    console.error(`[near] Ошибка вызова ${methodName}:`, err.message);
    return null;
  }
}

export async function getMarkets(params = {}) {
  const requestedLimit = params.limit || 50;
  const batchSize = 100;

  // Если запрос небольшой — одним вызовом
  if (requestedLimit <= batchSize) {
    return (await viewContract("get_markets", params)) || [];
  }

  // Пакетная загрузка для больших запросов
  let allMarkets = [];
  let fromIndex = params.from_index || 0;

  while (allMarkets.length < requestedLimit) {
    const batch = await viewContract("get_markets", {
      ...params,
      from_index: fromIndex,
      limit: batchSize,
    });

    if (!batch || batch.length === 0) break;
    allMarkets = allMarkets.concat(batch);
    fromIndex += batch.length;

    if (batch.length < batchSize) break; // последняя страница
  }

  return allMarkets.slice(0, requestedLimit);
}

export async function getMarket(marketId) {
  return viewContract("get_market", { market_id: marketId });
}

export async function getOdds(marketId) {
  return viewContract("get_odds", { market_id: marketId });
}

export async function getMarketBets(marketId) {
  return (await viewContract("get_market_bets", { market_id: marketId })) || [];
}

export async function getUserBets(accountId) {
  return (await viewContract("get_user_bets", { account_id: accountId })) || [];
}

export async function getStats() {
  return (await viewContract("get_stats")) || { totalMarkets: 0, totalBets: 0, totalVolume: "0" };
}

export async function getBalance(accountId) {
  return (await viewContract("get_balance", { account_id: accountId })) || "0";
}

// ── Call методы оракула (подписание транзакций) ────────────────

export async function resolveMarket(marketId, winningOutcome, reasoning = "") {
  const account = await initOracleAccount();

  const result = await account.functionCall({
    contractId: config.near.contractId,
    methodName: "resolve_market",
    args: {
      market_id: marketId,
      winning_outcome: winningOutcome,
      reasoning,
    },
    gas: "100000000000000", // 100 TGas
    attachedDeposit: "0",
  });

  const txHash = result.transaction?.hash || result.transaction_outcome?.id;
  console.log(`[near] Рынок #${marketId} разрешён. TX: ${txHash}`);
  return txHash;
}

// ── Аннулирование рынка (void) — возврат всех ставок ─────────

export async function voidMarket(marketId, reasoning = "") {
  const account = await initOracleAccount();

  const result = await account.functionCall({
    contractId: config.near.contractId,
    methodName: "void_market",
    args: {
      market_id: marketId,
      reasoning,
    },
    gas: "100000000000000", // 100 TGas
    attachedDeposit: "0",
  });

  const txHash = result.transaction?.hash || result.transaction_outcome?.id;
  console.log(`[near] Рынок #${marketId} аннулирован (void). TX: ${txHash}`);
  return txHash;
}
