/**
 * NEAR сервис — подключение к блокчейну
 *
 * Два режима:
 * - viewAccount: бесплатные чтения (без ключей)
 * - oracleAccount: подписание транзакций (OutLayer relayer)
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

// ── Создание рынка (через оракул-аккаунт) ────────────────────────

export async function createMarket({
  question,
  description,
  outcomes,
  category,
  betsEndDate,
  resolutionDate,
  espnEventId,
  sport,
  league,
  marketType,
}) {
  const account = await initOracleAccount();

  const result = await account.functionCall({
    contractId: config.near.contractId,
    methodName: "create_market",
    args: {
      question,
      description,
      outcomes,
      category: category || "sports",
      bets_end_date: betsEndDate,
      resolution_date: resolutionDate,
      espn_event_id: espnEventId || null,
      sport: sport || null,
      league: league || null,
      market_type: marketType || "winner",
    },
    gas: "30000000000000", // 30 TGas
    attachedDeposit: "0",
  });

  const txHash = result.transaction?.hash || result.transaction_outcome?.id;

  // Извлекаем market_id из return value
  const returnVal = result.status?.SuccessValue;
  let marketId = null;
  if (returnVal) {
    try {
      marketId = JSON.parse(Buffer.from(returnVal, "base64").toString());
    } catch {}
  }

  // Пробуем из логов
  if (marketId == null) {
    const logs =
      result.receipts_outcome
        ?.flatMap((r) => r.outcome?.logs || [])
        .join("\n") || "";
    const idMatch = logs.match(/market.*?#?(\d+)/i);
    if (idMatch) marketId = parseInt(idMatch[1]);
  }

  console.log(`[near] Рынок создан: #${marketId}. TX: ${txHash}`);
  return { marketId, txHash };
}

// ── Seed Liquidity — авто-ставки на все исходы нового рынка ───────

const BET_AMOUNT = "1000000000000000000000000"; // 1 NEAR

export async function seedLiquidity(marketId) {
  const account = await initOracleAccount();

  // Получаем данные рынка
  const market = await viewContract("get_market", { market_id: marketId });
  if (!market) throw new Error(`Рынок #${marketId} не найден`);
  if (market.status !== "active") throw new Error(`Рынок #${marketId} не активен (${market.status})`);

  const outcomes = market.outcomes || [];
  const neededYocto = BigInt(BET_AMOUNT) * BigInt(outcomes.length);

  // Проверяем баланс на контракте, при необходимости пополняем
  const balance = await viewContract("get_balance", { account_id: config.oracle.accountId });
  const currentBalance = BigInt(balance || "0");

  if (currentBalance < neededYocto) {
    const depositAmount = neededYocto - currentBalance + BigInt(BET_AMOUNT); // +1 NEAR запас
    console.log(`[liquidity] Депозит ${Number(depositAmount) / 1e24} NEAR в контракт`);
    await account.functionCall({
      contractId: config.near.contractId,
      methodName: "deposit",
      args: {},
      gas: "30000000000000",
      attachedDeposit: depositAmount.toString(),
    });
  }

  // Ставим на каждый исход
  const results = [];
  for (let i = 0; i < outcomes.length; i++) {
    try {
      await account.functionCall({
        contractId: config.near.contractId,
        methodName: "place_bet",
        args: { market_id: marketId, outcome: i, amount: BET_AMOUNT },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
      results.push({ outcome: i, label: outcomes[i], status: "ok" });
      console.log(`[liquidity] Рынок #${marketId}, исход "${outcomes[i]}" — 1 NEAR`);
    } catch (err) {
      results.push({ outcome: i, label: outcomes[i], status: "error", error: err.message });
      console.log(`[liquidity] Рынок #${marketId}, исход "${outcomes[i]}" — ОШИБКА: ${err.message?.slice(0, 50)}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return { marketId, bets: results, total: outcomes.length };
}

// ── TLS Oracle — альтернативное разрешение через MPC-TLS + ZK ────

/**
 * Submit аттестации в TLS Oracle контракт
 * @returns {string} attestation_id (из логов транзакции)
 */
export async function submitTlsAttestation(proofData) {
  const account = await initOracleAccount();

  const result = await account.functionCall({
    contractId: config.tlsOracle.contractId,
    methodName: "submit_attestation",
    args: {
      source_url: proofData.sourceUrl,
      server_name: proofData.serverName,
      timestamp: proofData.timestamp,
      response_data: proofData.responseData,
      proof_a: proofData.proofA,
      proof_b: proofData.proofB,
      proof_c: proofData.proofC,
      public_signals: proofData.publicSignals,
    },
    gas: "200000000000000", // 200 TGas (ZK verify)
    attachedDeposit: "50000000000000000000000", // 0.05 NEAR (storage)
  });

  const txHash = result.transaction?.hash || result.transaction_outcome?.id;
  console.log(`[near] TLS Oracle submit_attestation. TX: ${txHash}`);

  // Извлекаем attestation_id из логов
  const logs =
    result.receipts_outcome
      ?.flatMap((r) => r.outcome?.logs || [])
      .join("\n") || "";
  const idMatch = logs.match(/id:\s*(\d+)/);
  const attestationId = idMatch ? parseInt(idMatch[1]) : null;

  return { txHash, attestationId };
}

/**
 * Разрешить рынок через TLS Oracle аттестацию
 */
export async function requestTlsResolution(
  marketId,
  attestationId,
  homeScore,
  awayScore,
  homeTeam,
  awayTeam,
  eventStatus,
) {
  const account = await initOracleAccount();

  const result = await account.functionCall({
    contractId: config.near.contractId,
    methodName: "resolve_with_tls_attestation",
    args: {
      market_id: marketId,
      attestation_id: attestationId,
      home_score: homeScore,
      away_score: awayScore,
      home_team: homeTeam,
      away_team: awayTeam,
      event_status: eventStatus,
    },
    gas: "100000000000000", // 100 TGas
    attachedDeposit: "0",
  });

  const txHash = result.transaction?.hash || result.transaction_outcome?.id;
  console.log(
    `[near] TLS Oracle resolution для #${marketId}. TX: ${txHash}`,
  );
  return txHash;
}

/**
 * Чтение аттестации из TLS Oracle (view call)
 */
export async function getTlsAttestation(attestationId) {
  const account = await initViewAccount();
  try {
    return account.viewFunction({
      contractId: config.tlsOracle.contractId,
      methodName: "get_attestation",
      args: { id: attestationId },
    });
  } catch (err) {
    console.error(
      `[near] Ошибка чтения TLS аттестации #${attestationId}:`,
      err.message,
    );
    return null;
  }
}

// ── ESPN Oracle — запрос разрешения через OutLayer (on-chain) ────

export async function requestResolution(marketId) {
  const account = await initOracleAccount();

  const result = await account.functionCall({
    contractId: config.near.contractId,
    methodName: "request_resolution",
    args: { market_id: marketId },
    gas: "300000000000000", // 300 TGas (OutLayer + callback)
    attachedDeposit: "100000000000000000000000", // 0.1 NEAR для OutLayer
  });

  const txHash = result.transaction?.hash || result.transaction_outcome?.id;
  console.log(`[near] OutLayer resolution для #${marketId}. TX: ${txHash}`);
  return txHash;
}

