/**
 * Скрипт для создания рынков на основе реальных матчей из ESPN API
 *
 * 1. Обходит все лиги из SPORTS_CONFIG
 * 2. Получает реальные матчи из ESPN API (7 дней вперёд)
 * 3. Создаёт рынки "Who will win?" для каждого матча
 *
 * Запуск: node scripts/seed-markets.js
 * Отмена фейков: node scripts/seed-markets.js --cancel-range 7 106
 */

import { connect, keyStores, KeyPair } from "near-api-js";
import dotenv from "dotenv";
dotenv.config();

// ── Конфигурация ──────────────────────────────────────────────

const NETWORK = process.env.NEAR_NETWORK || "testnet";
const NODE_URL =
  NETWORK === "mainnet"
    ? "https://free.rpc.fastnear.com"
    : "https://test.rpc.fastnear.com";
const CONTRACT_ID = process.env.NEARCAST_CONTRACT;
const ORACLE_ID = process.env.ORACLE_ACCOUNT_ID;
const ORACLE_KEY = process.env.ORACLE_PRIVATE_KEY;

if (!CONTRACT_ID || !ORACLE_ID || !ORACLE_KEY) {
  console.error("Нужны NEARCAST_CONTRACT, ORACLE_ACCOUNT_ID, ORACLE_PRIVATE_KEY в .env");
  process.exit(1);
}

// ── ESPN API ──────────────────────────────────────────────────

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

async function fetchESPN(espnPath, from, to) {
  const fromStr = from.replace(/-/g, "");
  const toStr = to.replace(/-/g, "");
  const url = `${ESPN_BASE}/${espnPath}/scoreboard?dates=${fromStr}-${toStr}&limit=50`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const data = await res.json();

  return (data.events || []).map((event) => {
    const comp = event.competitions?.[0] || {};
    const competitors = comp.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") || competitors[1];

    return {
      teamA: home?.team?.displayName || home?.athlete?.displayName || "",
      teamB: away?.team?.displayName || away?.athlete?.displayName || "",
      date: event.date,
      name: event.name || "",
      round: comp.series?.summary || event.status?.type?.detail || "",
    };
  }).filter((m) => m.teamA && m.teamB && m.teamA !== "TBD" && m.teamB !== "TBD");
}

// ── Все лиги из конфига ───────────────────────────────────────

const LEAGUES = [
  // Football
  { sport: "football", espn: "soccer/eng.1", label: "Premier League" },
  { sport: "football", espn: "soccer/esp.1", label: "La Liga" },
  { sport: "football", espn: "soccer/ger.1", label: "Bundesliga" },
  { sport: "football", espn: "soccer/ita.1", label: "Serie A" },
  { sport: "football", espn: "soccer/fra.1", label: "Ligue 1" },
  { sport: "football", espn: "soccer/ned.1", label: "Eredivisie" },
  { sport: "football", espn: "soccer/por.1", label: "Primeira Liga" },
  { sport: "football", espn: "soccer/tur.1", label: "Super Lig" },
  { sport: "football", espn: "soccer/sco.1", label: "Scottish Premiership" },
  { sport: "football", espn: "soccer/bel.1", label: "Belgian Pro League" },
  { sport: "football", espn: "soccer/uefa.champions", label: "Champions League" },
  { sport: "football", espn: "soccer/uefa.europa", label: "Europa League" },
  { sport: "football", espn: "soccer/uefa.europa.conf", label: "Conference League" },
  { sport: "football", espn: "soccer/eng.fa", label: "FA Cup" },
  { sport: "football", espn: "soccer/usa.1", label: "MLS" },
  // Basketball
  { sport: "basketball", espn: "basketball/nba", label: "NBA" },
  // Hockey
  { sport: "hockey", espn: "hockey/nhl", label: "NHL" },
  // American Football
  { sport: "american-football", espn: "football/nfl", label: "NFL" },
  // Baseball
  { sport: "baseball", espn: "baseball/mlb", label: "MLB" },
  // MMA
  { sport: "mma", espn: "mma/ufc", label: "UFC" },
  // Tennis
  { sport: "tennis", espn: "tennis/atp", label: "ATP" },
  { sport: "tennis", espn: "tennis/wta", label: "WTA" },
  // Racing
  { sport: "racing", espn: "racing/f1", label: "F1" },
];

// ── Утилиты ───────────────────────────────────────────────────

const MS_TO_NS = 1_000_000;
const HOUR_MS = 3600_000;

function toNano(isoDate) {
  return (new Date(isoDate).getTime() * MS_TO_NS).toString();
}

function futureNano(ms) {
  return ((Date.now() + ms) * MS_TO_NS).toString();
}

// ── Подключение к NEAR ────────────────────────────────────────

async function initAccount() {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(ORACLE_KEY);
  await keyStore.setKey(NETWORK, ORACLE_ID, keyPair);
  const near = await connect({ networkId: NETWORK, keyStore, nodeUrl: NODE_URL });
  return near.account(ORACLE_ID);
}

// ── Отмена рынков по диапазону ID ─────────────────────────────

async function cancelRange(account, fromId, toId) {
  console.log(`\n  Отмена рынков #${fromId} — #${toId}...\n`);
  let ok = 0, fail = 0;
  for (let id = fromId; id <= toId; id++) {
    try {
      await account.functionCall({
        contractId: CONTRACT_ID,
        methodName: "cancel_market",
        args: { market_id: id },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
      ok++;
      process.stdout.write(`  [${id}] OK  `);
      if (ok % 10 === 0) console.log();
    } catch (err) {
      fail++;
      process.stdout.write(`  [${id}] SKIP  `);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`\n\n  Отменено: ${ok}, пропущено: ${fail}\n`);
}

// ── Создание рынков из реальных матчей ────────────────────────

async function seedReal(account) {
  const today = new Date().toISOString().split("T")[0];
  const endDate = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  console.log(`\n  Получаю реальные матчи из ESPN (${today} → ${endDate})...\n`);

  const allMatches = [];

  for (const league of LEAGUES) {
    try {
      const matches = await fetchESPN(league.espn, today, endDate);
      for (const m of matches) {
        allMatches.push({ ...m, sport: league.sport, league: league.label });
      }
      console.log(`  ${league.label.padEnd(25)} ${matches.length} матчей`);
    } catch (err) {
      console.log(`  ${league.label.padEnd(25)} ОШИБКА: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n  Всего реальных матчей: ${allMatches.length}`);

  // Убираем дубли (по teamA + teamB + date)
  const seen = new Set();
  const unique = allMatches.filter((m) => {
    const key = `${m.teamA}|${m.teamB}|${m.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`  Уникальных: ${unique.length}\n`);

  if (unique.length === 0) {
    console.log("  Нет матчей для создания.\n");
    return;
  }

  // Сортируем по дате
  unique.sort((a, b) => new Date(a.date) - new Date(b.date));

  let created = 0, failed = 0;

  for (let i = 0; i < unique.length; i++) {
    const m = unique[i];
    const matchTime = new Date(m.date).getTime();
    const now = Date.now();

    // Ставки закрываются за 1 час до матча (минимум через 2 часа от сейчас)
    const betsEndMs = Math.max(matchTime - HOUR_MS, now + 2 * HOUR_MS);
    // Resolve через 3 часа после начала матча
    const resolutionMs = matchTime + 3 * HOUR_MS;

    // betsEndDate должен быть в будущем, resolutionDate > betsEndDate
    if (betsEndMs <= now || resolutionMs <= betsEndMs) continue;

    const hasDraw = m.sport === "football";
    const outcomes = hasDraw
      ? [m.teamA, m.teamB, "Draw"]
      : [m.teamA, m.teamB];

    const question = `Who will win: ${m.teamA} vs ${m.teamB}?`;
    const description = `${m.league}${m.round ? ` — ${m.round}` : ""} | ${new Date(m.date).toUTCString().slice(0, 22)}`;

    try {
      const result = await account.functionCall({
        contractId: CONTRACT_ID,
        methodName: "create_market",
        args: {
          question,
          description,
          outcomes,
          category: m.sport,
          betsEndDate: (betsEndMs * MS_TO_NS).toString(),
          resolutionDate: (resolutionMs * MS_TO_NS).toString(),
        },
        gas: "30000000000000",
        attachedDeposit: "0",
      });

      const txHash = result.transaction?.hash || result.transaction_outcome?.id || "?";
      created++;
      console.log(`  [${String(created).padStart(3)}] ${m.sport.padEnd(18)} ${question.slice(0, 60).padEnd(62)} ${m.league}`);
    } catch (err) {
      failed++;
      console.error(`  [ERR] ${question.slice(0, 50)}  ${err.message?.slice(0, 60)}`);
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\n  ════════════════════════════════════════`);
  console.log(`  Создано: ${created}`);
  if (failed > 0) console.log(`  Ошибок: ${failed}`);
  console.log(`  ════════════════════════════════════════\n`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log(`\n  NEAR: ${NETWORK} | Контракт: ${CONTRACT_ID} | Оракул: ${ORACLE_ID}\n`);

  const account = await initAccount();

  const args = process.argv.slice(2);

  if (args[0] === "--cancel-range" && args[1] && args[2]) {
    await cancelRange(account, parseInt(args[1]), parseInt(args[2]));
  } else {
    await seedReal(account);
  }
}

main().catch((err) => {
  console.error("Критическая ошибка:", err);
  process.exit(1);
});
