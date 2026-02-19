/**
 * Скрипт для создания 10 рынков: 5 Winner + 5 Over/Under
 * Ближайшие матчи — Лига Европы, Ла Лига, Бундеслига, Серия А (19-20 фев 2026)
 */

import { connect, keyStores, KeyPair } from "near-api-js";
import dotenv from "dotenv";
dotenv.config();

const NETWORK = process.env.NEAR_NETWORK || "testnet";
const NODE_URL = NETWORK === "mainnet"
  ? "https://free.rpc.fastnear.com"
  : "https://test.rpc.fastnear.com";
const CONTRACT_ID = process.env.NEARCAST_CONTRACT;
const ORACLE_ID = process.env.ORACLE_ACCOUNT_ID;
const ORACLE_KEY = process.env.ORACLE_PRIVATE_KEY;

if (!CONTRACT_ID || !ORACLE_ID || !ORACLE_KEY) {
  console.error("Нужны NEARCAST_CONTRACT, ORACLE_ACCOUNT_ID, ORACLE_PRIVATE_KEY в .env");
  process.exit(1);
}

const MS_TO_NS = 1_000_000;
const HOUR_MS = 3600_000;

// ── 5 Winner рынков ─────────────────────────────────────────
const WINNER_MARKETS = [
  {
    espnEventId: "401858776",
    teamA: "Fenerbahce", teamB: "Nottingham Forest",
    matchDate: "2026-02-19T17:45:00Z",
    sport: "soccer", league: "uefa.europa",
    category: "football", leagueLabel: "Europa League",
  },
  {
    espnEventId: "401858771",
    teamA: "Celtic", teamB: "VfB Stuttgart",
    matchDate: "2026-02-19T20:00:00Z",
    sport: "soccer", league: "uefa.europa",
    category: "football", leagueLabel: "Europa League",
  },
  {
    espnEventId: "748388",
    teamA: "Athletic Club", teamB: "Elche",
    matchDate: "2026-02-20T20:00:00Z",
    sport: "soccer", league: "esp.1",
    category: "football", leagueLabel: "La Liga",
  },
  {
    espnEventId: "746919",
    teamA: "Mainz", teamB: "Hamburg SV",
    matchDate: "2026-02-20T19:30:00Z",
    sport: "soccer", league: "ger.1",
    category: "football", leagueLabel: "Bundesliga",
  },
  {
    espnEventId: "737038",
    teamA: "Sassuolo", teamB: "Hellas Verona",
    matchDate: "2026-02-20T19:45:00Z",
    sport: "soccer", league: "ita.1",
    category: "football", leagueLabel: "Serie A",
  },
];

// ── 5 Over/Under рынков ─────────────────────────────────────
const OVER_UNDER_MARKETS = [
  {
    espnEventId: "401858770",
    teamA: "SK Brann", teamB: "Bologna",
    matchDate: "2026-02-19T17:45:00Z",
    sport: "soccer", league: "uefa.europa",
    category: "football", leagueLabel: "Europa League",
    total: 2.5,
  },
  {
    espnEventId: "401858773",
    teamA: "PAOK Salonika", teamB: "Celta Vigo",
    matchDate: "2026-02-19T17:45:00Z",
    sport: "soccer", league: "uefa.europa",
    category: "football", leagueLabel: "Europa League",
    total: 2.5,
  },
  {
    espnEventId: "401858775",
    teamA: "Lille", teamB: "Red Star Belgrade",
    matchDate: "2026-02-19T20:00:00Z",
    sport: "soccer", league: "uefa.europa",
    category: "football", leagueLabel: "Europa League",
    total: 2.5,
  },
  {
    espnEventId: "401858777",
    teamA: "Dinamo Zagreb", teamB: "Racing Genk",
    matchDate: "2026-02-19T17:45:00Z",
    sport: "soccer", league: "uefa.europa",
    category: "football", leagueLabel: "Europa League",
    total: 2.5,
  },
  {
    espnEventId: "401858774",
    teamA: "Ludogorets Razgrad", teamB: "Ferencvaros",
    matchDate: "2026-02-19T20:00:00Z",
    sport: "soccer", league: "uefa.europa",
    category: "football", leagueLabel: "Europa League",
    total: 2.5,
  },
];

async function initAccount() {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(ORACLE_KEY);
  await keyStore.setKey(NETWORK, ORACLE_ID, keyPair);
  const near = await connect({ networkId: NETWORK, keyStore, nodeUrl: NODE_URL });
  return near.account(ORACLE_ID);
}

async function createMarket(account, args) {
  return account.functionCall({
    contractId: CONTRACT_ID,
    methodName: "create_market",
    args,
    gas: "30000000000000",
    attachedDeposit: "0",
  });
}

const BET_AMOUNT = "1000000000000000000000000"; // 1 NEAR

/** Seed liquidity: 1 NEAR на каждый исход нового рынка */
async function seedLiquidity(account, marketId, outcomesCount) {
  // Депозит на контракт (outcomesCount NEAR + 1 запас)
  const neededYocto = BigInt(BET_AMOUNT) * BigInt(outcomesCount);
  const balance = await account.viewFunction({
    contractId: CONTRACT_ID, methodName: "get_balance",
    args: { account_id: ORACLE_ID },
  });
  if (BigInt(balance || "0") < neededYocto) {
    const deposit = neededYocto - BigInt(balance || "0") + BigInt(BET_AMOUNT);
    await account.functionCall({
      contractId: CONTRACT_ID, methodName: "deposit", args: {},
      gas: "30000000000000", attachedDeposit: deposit.toString(),
    });
  }
  for (let i = 0; i < outcomesCount; i++) {
    await account.functionCall({
      contractId: CONTRACT_ID, methodName: "place_bet",
      args: { market_id: marketId, outcome: i, amount: BET_AMOUNT },
      gas: "30000000000000", attachedDeposit: "0",
    });
    await new Promise(r => setTimeout(r, 150));
  }
}

async function main() {
  console.log(`\n  NEAR: ${NETWORK} | Контракт: ${CONTRACT_ID} | Оракул: ${ORACLE_ID}\n`);
  const account = await initAccount();

  const now = Date.now();
  let created = 0;

  // ── Winner Markets ────────────────────────────────────────
  console.log("  ═══ WINNER (5 рынков) ═══\n");

  for (const m of WINNER_MARKETS) {
    const matchMs = new Date(m.matchDate).getTime();
    const betsEndMs = Math.max(matchMs - HOUR_MS, now + 30 * 60000); // минимум 30 мин от сейчас
    const resolutionMs = matchMs + 3 * HOUR_MS;

    if (betsEndMs <= now || resolutionMs <= betsEndMs) {
      console.log(`  [SKIP] ${m.teamA} vs ${m.teamB} — матч слишком скоро`);
      continue;
    }

    const outcomes = [m.teamA, m.teamB, "Draw"];
    const question = `Who will win: ${m.teamA} vs ${m.teamB}?`;
    const description = `${m.leagueLabel} | ${new Date(m.matchDate).toUTCString().slice(0, 22)}`;

    try {
      await createMarket(account, {
        question,
        description,
        outcomes,
        category: m.category,
        bets_end_date: (betsEndMs * MS_TO_NS).toString(),
        resolution_date: (resolutionMs * MS_TO_NS).toString(),
        espn_event_id: m.espnEventId,
        sport: m.sport,
        league: m.league,
        market_type: "winner",
      });
      // Seed liquidity: 1 NEAR на каждый исход
      const stats = await account.viewFunction({
        contractId: CONTRACT_ID, methodName: "get_stats", args: {},
      });
      const newId = (stats.totalMarkets || 1) - 1;
      await seedLiquidity(account, newId, outcomes.length);
      created++;
      console.log(`  [${created}] WINNER  ${m.teamA} vs ${m.teamB} (${m.leagueLabel}) — seed ${outcomes.length} NEAR`);
    } catch (err) {
      console.error(`  [ERR] ${m.teamA} vs ${m.teamB}: ${err.message?.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Over/Under Markets ────────────────────────────────────
  console.log("\n  ═══ OVER/UNDER (5 рынков) ═══\n");

  for (const m of OVER_UNDER_MARKETS) {
    const matchMs = new Date(m.matchDate).getTime();
    const betsEndMs = Math.max(matchMs - HOUR_MS, now + 30 * 60000);
    const resolutionMs = matchMs + 3 * HOUR_MS;

    if (betsEndMs <= now || resolutionMs <= betsEndMs) {
      console.log(`  [SKIP] ${m.teamA} vs ${m.teamB} — матч слишком скоро`);
      continue;
    }

    const outcomes = [`Over ${m.total} goals`, `Under ${m.total} goals`];
    const question = `${m.teamA} vs ${m.teamB}: Over or Under ${m.total} total goals?`;
    const description = `${m.leagueLabel} | ${new Date(m.matchDate).toUTCString().slice(0, 22)}`;

    try {
      await createMarket(account, {
        question,
        description,
        outcomes,
        category: m.category,
        bets_end_date: (betsEndMs * MS_TO_NS).toString(),
        resolution_date: (resolutionMs * MS_TO_NS).toString(),
        espn_event_id: m.espnEventId,
        sport: m.sport,
        league: m.league,
        market_type: "over-under",
      });
      // Seed liquidity: 1 NEAR на каждый исход
      const stats = await account.viewFunction({
        contractId: CONTRACT_ID, methodName: "get_stats", args: {},
      });
      const newId = (stats.totalMarkets || 1) - 1;
      await seedLiquidity(account, newId, outcomes.length);
      created++;
      console.log(`  [${created}] O/U ${m.total}  ${m.teamA} vs ${m.teamB} (${m.leagueLabel}) — seed ${outcomes.length} NEAR`);
    } catch (err) {
      console.error(`  [ERR] ${m.teamA} vs ${m.teamB}: ${err.message?.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n  ════════════════════════════════════════`);
  console.log(`  Создано рынков: ${created} / 10`);
  console.log(`  ════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error("Ошибка:", err);
  process.exit(1);
});
