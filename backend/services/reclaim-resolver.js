/**
 * Reclaim zkTLS Resolver — разрешение спортивных рынков через zkFetch
 *
 * Альтернативный путь к OutLayer TEE. Использует Reclaim Protocol
 * для криптографического доказательства данных ESPN API.
 *
 * Flow:
 *   1. zkFetch → ESPN API → proof + scores
 *   2. computeOracleResult → winning_outcome из счёта
 *   3. near.js → contract.resolve_with_reclaim_proof(proof, oracle_result)
 *   4. Contract → reclaim-protocol.testnet/verify_proof → apply_resolution
 */

import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import config from "../config.js";
import { getMarket, requestReclaimResolution } from "./near.js";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

// ── ESPN URL из метаданных рынка ────────────────────────────────

function getEspnSummaryUrl(market) {
  const sport = market.sport;
  const league = market.league;
  const espnId = market.espnEventId || market.espn_event_id;

  if (!sport || !league || !espnId) {
    throw new Error("Рынок не содержит ESPN метаданных (sport/league/espnEventId)");
  }

  return `${ESPN_BASE}/${sport}/${league}/summary?event=${espnId}`;
}

// ── Генерация zkTLS proof через ESPN API ────────────────────────

/**
 * Вызывает ESPN API через zkFetch и получает ZK proof
 * @param {object} market — рынок из контракта
 * @returns {{ proof, scores, eventStatus }} — proof + распарсенные данные
 */
export async function generateEspnProof(market) {
  if (!config.reclaim.appId || !config.reclaim.appSecret) {
    throw new Error("RECLAIM_APP_ID и RECLAIM_APP_SECRET не установлены");
  }

  const url = getEspnSummaryUrl(market);
  console.log(`[reclaim] zkFetch: ${url}`);

  const client = new ReclaimClient(config.reclaim.appId, config.reclaim.appSecret);

  // zkFetch к ESPN API с regex для извлечения данных
  // Паттерны ищут score и homeAway в JSON-ответе ESPN
  const proof = await client.zkFetch(url, {
    method: "GET",
  }, {
    responseMatches: [
      {
        type: "regex",
        value: "\"homeAway\"\\s*:\\s*\"home\"[\\s\\S]{0,300}?\"score\"\\s*:\\s*\"(?<home_score>\\d+)\"",
      },
      {
        type: "regex",
        value: "\"homeAway\"\\s*:\\s*\"away\"[\\s\\S]{0,300}?\"score\"\\s*:\\s*\"(?<away_score>\\d+)\"",
      },
      {
        type: "regex",
        value: "\"name\"\\s*:\\s*\"(?<event_status>STATUS_[A-Z_]+)\"",
      },
    ],
  });

  // Извлекаем scores из proof context
  const context = JSON.parse(proof.claimData.context);
  const extracted = context.extractedParameters || {};

  const homeScore = parseInt(extracted.home_score);
  const awayScore = parseInt(extracted.away_score);
  const eventStatus = extracted.event_status || "UNKNOWN";

  if (isNaN(homeScore) || isNaN(awayScore)) {
    throw new Error(`Не удалось извлечь счёт из proof: home=${extracted.home_score}, away=${extracted.away_score}`);
  }

  console.log(`[reclaim] Proof получен. Счёт: ${homeScore}:${awayScore}, статус: ${eventStatus}`);

  return {
    proof,
    scores: { home: homeScore, away: awayScore },
    eventStatus,
  };
}

// ── Вычисление OracleResult из счёта ────────────────────────────

/**
 * Определяет winning_outcome исходя из счёта и типа рынка
 * @param {object} market — рынок из контракта
 * @param {{ home: number, away: number }} scores — счёт матча
 * @param {string} eventStatus — статус события (STATUS_FINAL, STATUS_IN_PROGRESS...)
 * @returns {object} OracleResult для контракта
 */
export function computeOracleResult(market, scores, eventStatus) {
  const { home, away } = scores;
  const marketType = market.marketType || market.market_type || "winner";

  // Проверяем что матч завершён
  if (eventStatus !== "STATUS_FINAL" && eventStatus !== "STATUS_FULL_TIME") {
    throw new Error(`Матч ещё не завершён (статус: ${eventStatus}). Дождитесь окончания.`);
  }

  let winningOutcome = -1; // -1 = void
  let reasoning = "";

  if (marketType === "winner") {
    // outcomes: [TeamA wins, TeamB wins] или [TeamA wins, TeamB wins, Draw]
    if (home > away) {
      winningOutcome = 0;
      reasoning = `Home wins ${home}:${away}`;
    } else if (away > home) {
      winningOutcome = 1;
      reasoning = `Away wins ${away}:${home}`;
    } else {
      // Ничья — outcome 2 если есть, иначе void
      winningOutcome = market.outcomes.length > 2 ? 2 : -1;
      reasoning = `Draw ${home}:${away}`;
    }
  } else if (marketType === "over-under") {
    // outcomes: ["Over X.5", "Under X.5"]
    // Извлекаем линию из названия outcome
    const overOutcome = market.outcomes[0] || "";
    const lineMatch = overOutcome.match(/([\d.]+)/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : 0;
    const total = home + away;

    if (total > line) {
      winningOutcome = 0;
      reasoning = `Total ${total} > ${line} (Over)`;
    } else {
      winningOutcome = 1;
      reasoning = `Total ${total} < ${line} (Under)`;
    }
  } else if (marketType === "both-score") {
    // outcomes: ["Both score", "Not both score"] или аналог
    if (home > 0 && away > 0) {
      winningOutcome = 0;
      reasoning = `Both scored: ${home}:${away}`;
    } else {
      winningOutcome = 1;
      reasoning = `Not both scored: ${home}:${away}`;
    }
  } else {
    // Неизвестный тип — используем winner логику
    if (home > away) winningOutcome = 0;
    else if (away > home) winningOutcome = 1;
    else winningOutcome = market.outcomes.length > 2 ? 2 : -1;
    reasoning = `Score ${home}:${away} (type: ${marketType})`;
  }

  // Нормализуем event_status: ESPN даёт "STATUS_FINAL",
  // контракт ожидает "final" (нижний регистр без префикса)
  const normalizedStatus = eventStatus
    .replace(/^STATUS_/, "")
    .toLowerCase();

  return {
    winning_outcome: winningOutcome,
    confidence: 1.0,
    reasoning,
    home_score: home,
    away_score: away,
    event_status: normalizedStatus,
  };
}

// ── Трансформация proof для контракта ────────────────────────────

/**
 * Преобразует proof от zkFetch в формат контракта ReclaimProof
 * @param {object} proof — proof от Reclaim zkFetch
 * @returns {object} ReclaimProof для контракта
 */
export function transformProofForContract(proof) {
  const claimData = proof.claimData;

  return {
    claim_info: {
      provider: claimData.provider || "http",
      parameters: typeof claimData.parameters === "string"
        ? claimData.parameters
        : JSON.stringify(claimData.parameters),
      context: typeof claimData.context === "string"
        ? claimData.context
        : JSON.stringify(claimData.context),
    },
    signed_claim: {
      claim: {
        identifier: claimData.identifier,
        owner: claimData.owner,
        epoch: claimData.epoch || 1,
        timestamp_s: claimData.timestampS || Math.floor(Date.now() / 1000),
      },
      signatures: proof.signatures || [],
    },
  };
}

// ── Полный flow разрешения через Reclaim ────────────────────────

/**
 * Полный цикл: proof → compute → call contract
 * @param {number} marketId — ID рынка
 * @returns {{ success, marketId, txHash?, error? }}
 */
export async function resolveViaReclaim(marketId) {
  console.log(`[reclaim] Разрешаю рынок #${marketId} через zkTLS...`);

  // 1. Получаем рынок из контракта
  const market = await getMarket(marketId);
  if (!market) throw new Error(`Рынок #${marketId} не найден`);

  const espnId = market.espnEventId || market.espn_event_id;
  if (!espnId) throw new Error("Рынок не спортивный (нет ESPN ID)");

  const status = market.status;
  if (status === "resolved" || status === "voided") {
    throw new Error(`Рынок уже ${status}`);
  }

  // 2. Генерируем zkTLS proof через ESPN API
  const { proof, scores, eventStatus } = await generateEspnProof(market);

  // 3. Вычисляем oracle result из счёта
  const oracleResult = computeOracleResult(market, scores, eventStatus);
  console.log(`[reclaim] Oracle result: outcome=${oracleResult.winning_outcome}, ${oracleResult.reasoning}`);

  // 4. Трансформируем proof для контракта
  const contractProof = transformProofForContract(proof);

  // 5. Вызываем контракт
  const txHash = await requestReclaimResolution(marketId, contractProof, oracleResult);
  console.log(`[reclaim] Рынок #${marketId} — zkTLS запрос отправлен. TX: ${txHash}`);

  return { success: true, marketId, txHash };
}
