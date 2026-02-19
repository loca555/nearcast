/**
 * TLS Oracle ESPN Relayer — альтернативное разрешение спортивных рынков
 *
 * Использует TLS Oracle (MPC-TLS + ZK proof) для получения данных ESPN:
 * 1. Запрашивает MPC-TLS аттестацию ESPN scores через TLS Oracle backend
 * 2. Сабмитит аттестацию в TLS Oracle контракт (on-chain ZK verify)
 * 3. Вызывает NearCast resolve_with_tls_attestation (cross-contract verify)
 *
 * Permissionless: кто угодно может запустить этот бот.
 */

import config from "../config.js";
import {
  getMarkets,
  submitTlsAttestation,
  requestTlsResolution,
} from "./near.js";

let relayerIntervalId = null;

/**
 * Запросить ESPN proof через TLS Oracle backend
 * @param {string} espnEventId
 * @param {string} sport
 * @param {string} league
 * @returns {object} - { sourceUrl, serverName, timestamp, responseData, proofA, ... }
 */
async function requestEspnProof(espnEventId, sport, league) {
  const url = `${config.tlsOracle.backendUrl}/api/prove-espn`;
  const headers = { "Content-Type": "application/json" };
  if (config.tlsOracle.apiKey) {
    headers["X-API-Key"] = config.tlsOracle.apiKey;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ espnEventId, sport, league }),
    signal: AbortSignal.timeout(120_000), // 2 мин (MPC-TLS + ZK)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`TLS Oracle ошибка (${resp.status}): ${text}`);
  }

  return resp.json();
}

/**
 * Полный flow разрешения рынка через TLS Oracle
 */
async function resolveViaTls(market) {
  const espnId = market.espn_event_id || market.espnEventId;
  const sport = market.sport;
  const league = market.league;

  console.log(
    `[tls-relayer] Разрешаю рынок #${market.id} (ESPN: ${espnId})`,
  );

  // 1. Запрашиваем MPC-TLS аттестацию ESPN через TLS Oracle
  console.log(`[tls-relayer] Шаг 1: MPC-TLS + ZK proof для ESPN event ${espnId}...`);
  const proofData = await requestEspnProof(espnId, sport, league);

  // Парсим компактные ESPN данные
  const espnData = JSON.parse(proofData.responseData);
  console.log(
    `[tls-relayer] ESPN данные: ${espnData.ht} ${espnData.hs}:${espnData.as} ${espnData.at} (${espnData.st})`,
  );

  // Если матч не завершён — пропускаем
  if (espnData.st !== "final") {
    console.log(
      `[tls-relayer] Рынок #${market.id}: матч не завершён (status: ${espnData.st}), пропускаю`,
    );
    return { success: false, marketId: market.id, reason: `not final: ${espnData.st}` };
  }

  // 2. Сабмитим аттестацию в TLS Oracle контракт
  console.log(`[tls-relayer] Шаг 2: submit_attestation в TLS Oracle контракт...`);
  const { txHash: submitTx, attestationId } =
    await submitTlsAttestation(proofData);

  if (attestationId == null) {
    // Если не удалось извлечь ID из логов, пытаемся найти по source_url
    console.warn(
      `[tls-relayer] Не удалось извлечь attestation_id из логов TX ${submitTx}`,
    );
    throw new Error("Не удалось получить attestation_id");
  }

  console.log(
    `[tls-relayer] Аттестация #${attestationId} записана (TX: ${submitTx})`,
  );

  // 3. Разрешаем рынок через NearCast контракт
  console.log(
    `[tls-relayer] Шаг 3: resolve_with_tls_attestation на NearCast...`,
  );
  const resolveTx = await requestTlsResolution(
    market.id,
    attestationId,
    espnData.hs,
    espnData.as,
    espnData.ht,
    espnData.at,
    espnData.st,
  );

  console.log(
    `[tls-relayer] Рынок #${market.id} разрешён через TLS Oracle. TX: ${resolveTx}`,
  );
  return {
    success: true,
    marketId: market.id,
    attestationId,
    submitTx,
    resolveTx,
  };
}

/**
 * Проверка и разрешение спортивных рынков через TLS Oracle
 */
async function checkSportsMarketsTls() {
  try {
    const markets = await getMarkets({ status: "closed", limit: 50 });
    if (!markets || markets.length === 0) return;

    const now = BigInt(Date.now()) * BigInt(1_000_000);

    for (const market of markets) {
      const espnId = market.espn_event_id || market.espnEventId;
      if (!espnId) continue;
      if (now < BigInt(market.resolution_date || market.resolutionDate))
        continue;

      try {
        await resolveViaTls(market);
      } catch (err) {
        console.error(
          `[tls-relayer] Ошибка для рынка #${market.id}:`,
          err.message,
        );
      }

      // Пауза между рынками (MPC-TLS + ZK = тяжёлая операция)
      await new Promise((r) => setTimeout(r, 10_000));
    }
  } catch (err) {
    console.error("[tls-relayer] Ошибка:", err.message);
  }
}

/**
 * Ручной триггер для одного рынка
 */
export async function triggerTlsResolution(marketId) {
  const { getMarket } = await import("./near.js");
  const market = await getMarket(marketId);
  if (!market) throw new Error(`Рынок #${marketId} не найден`);

  const espnId = market.espn_event_id || market.espnEventId;
  if (!espnId) throw new Error("Рынок не спортивный (нет ESPN ID)");

  const status = market.status;
  if (status === "resolved" || status === "voided") {
    throw new Error(`Рынок уже ${status}`);
  }

  return resolveViaTls(market);
}

export function startTlsRelayer() {
  if (relayerIntervalId) return;
  if (!config.tlsOracle.backendUrl || !config.tlsOracle.apiKey) {
    console.log(
      "[tls-relayer] Не настроен (TLS_ORACLE_BACKEND_URL / TLS_ORACLE_API_KEY), пропускаю",
    );
    return;
  }
  console.log("[tls-relayer] TLS Oracle relayer запущен (проверка каждые 5 мин)");
  setTimeout(checkSportsMarketsTls, 30_000);
  relayerIntervalId = setInterval(checkSportsMarketsTls, 300_000);
}

export function stopTlsRelayer() {
  if (relayerIntervalId) {
    clearInterval(relayerIntervalId);
    relayerIntervalId = null;
  }
}
