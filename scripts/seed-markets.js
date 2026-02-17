/**
 * Скрипт для создания 100 рынков на NEAR контракте
 *
 * Использует oracle аккаунт для подписания транзакций.
 * Все рынки: английский язык, тип "winner", разные виды спорта.
 *
 * Запуск: node scripts/seed-markets.js
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

// ── Временные утилиты ─────────────────────────────────────────

const HOUR = 3600_000;
const MS_TO_NS = 1_000_000;

function futureNano(hoursFromNow) {
  return ((Date.now() + hoursFromNow * HOUR) * MS_TO_NS).toString();
}

// ── Данные рынков ─────────────────────────────────────────────

const MARKETS = [
  // ═══ FOOTBALL (30) ═══
  // EPL
  { q: "Who will win: Manchester City vs Arsenal?", d: "Premier League 2025/26 matchday", outcomes: ["Manchester City", "Arsenal", "Draw"], cat: "football", h: 4 },
  { q: "Who will win: Liverpool vs Chelsea?", d: "Premier League 2025/26", outcomes: ["Liverpool", "Chelsea", "Draw"], cat: "football", h: 6 },
  { q: "Who will win: Manchester United vs Tottenham?", d: "Premier League 2025/26", outcomes: ["Manchester United", "Tottenham", "Draw"], cat: "football", h: 8 },
  { q: "Who will win: Newcastle vs Aston Villa?", d: "Premier League 2025/26", outcomes: ["Newcastle", "Aston Villa", "Draw"], cat: "football", h: 10 },
  { q: "Who will win: Brighton vs West Ham?", d: "Premier League 2025/26", outcomes: ["Brighton", "West Ham", "Draw"], cat: "football", h: 12 },
  // La Liga
  { q: "Who will win: Real Madrid vs Barcelona?", d: "La Liga El Clasico 2025/26", outcomes: ["Real Madrid", "Barcelona", "Draw"], cat: "football", h: 5 },
  { q: "Who will win: Atletico Madrid vs Sevilla?", d: "La Liga 2025/26", outcomes: ["Atletico Madrid", "Sevilla", "Draw"], cat: "football", h: 14 },
  { q: "Who will win: Real Sociedad vs Athletic Bilbao?", d: "La Liga Basque derby", outcomes: ["Real Sociedad", "Athletic Bilbao", "Draw"], cat: "football", h: 16 },
  { q: "Who will win: Villarreal vs Valencia?", d: "La Liga 2025/26", outcomes: ["Villarreal", "Valencia", "Draw"], cat: "football", h: 18 },
  // Bundesliga
  { q: "Who will win: Bayern Munich vs Borussia Dortmund?", d: "Bundesliga Der Klassiker", outcomes: ["Bayern Munich", "Borussia Dortmund", "Draw"], cat: "football", h: 7 },
  { q: "Who will win: RB Leipzig vs Bayer Leverkusen?", d: "Bundesliga 2025/26", outcomes: ["RB Leipzig", "Bayer Leverkusen", "Draw"], cat: "football", h: 20 },
  { q: "Who will win: Eintracht Frankfurt vs Wolfsburg?", d: "Bundesliga 2025/26", outcomes: ["Eintracht Frankfurt", "Wolfsburg", "Draw"], cat: "football", h: 22 },
  // Serie A
  { q: "Who will win: Inter Milan vs AC Milan?", d: "Serie A Milan Derby", outcomes: ["Inter Milan", "AC Milan", "Draw"], cat: "football", h: 9 },
  { q: "Who will win: Juventus vs Napoli?", d: "Serie A 2025/26", outcomes: ["Juventus", "Napoli", "Draw"], cat: "football", h: 24 },
  { q: "Who will win: AS Roma vs Lazio?", d: "Serie A Rome Derby", outcomes: ["AS Roma", "Lazio", "Draw"], cat: "football", h: 26 },
  { q: "Who will win: Atalanta vs Fiorentina?", d: "Serie A 2025/26", outcomes: ["Atalanta", "Fiorentina", "Draw"], cat: "football", h: 28 },
  // Ligue 1
  { q: "Who will win: PSG vs Marseille?", d: "Ligue 1 Le Classique", outcomes: ["PSG", "Marseille", "Draw"], cat: "football", h: 11 },
  { q: "Who will win: Lyon vs Monaco?", d: "Ligue 1 2025/26", outcomes: ["Lyon", "Monaco", "Draw"], cat: "football", h: 30 },
  // Champions League
  { q: "Who will win: Real Madrid vs Manchester City?", d: "UEFA Champions League knockout", outcomes: ["Real Madrid", "Manchester City", "Draw"], cat: "football", h: 3 },
  { q: "Who will win: Bayern Munich vs PSG?", d: "UEFA Champions League knockout", outcomes: ["Bayern Munich", "PSG", "Draw"], cat: "football", h: 13 },
  { q: "Who will win: Barcelona vs Inter Milan?", d: "UEFA Champions League", outcomes: ["Barcelona", "Inter Milan", "Draw"], cat: "football", h: 15 },
  { q: "Who will win: Arsenal vs Borussia Dortmund?", d: "UEFA Champions League", outcomes: ["Arsenal", "Borussia Dortmund", "Draw"], cat: "football", h: 17 },
  { q: "Who will win: Liverpool vs Atletico Madrid?", d: "UEFA Champions League", outcomes: ["Liverpool", "Atletico Madrid", "Draw"], cat: "football", h: 19 },
  // International
  { q: "Who will win: Brazil vs Argentina?", d: "World Cup Qualifier", outcomes: ["Brazil", "Argentina", "Draw"], cat: "football", h: 32 },
  { q: "Who will win: France vs Germany?", d: "UEFA Nations League", outcomes: ["France", "Germany", "Draw"], cat: "football", h: 34 },
  { q: "Who will win: England vs Spain?", d: "International Friendly", outcomes: ["England", "Spain", "Draw"], cat: "football", h: 36 },
  { q: "Who will win: Portugal vs Italy?", d: "UEFA Nations League", outcomes: ["Portugal", "Italy", "Draw"], cat: "football", h: 38 },
  { q: "Who will win: Netherlands vs Belgium?", d: "Low Countries Derby", outcomes: ["Netherlands", "Belgium", "Draw"], cat: "football", h: 40 },
  // MLS
  { q: "Who will win: LA Galaxy vs Inter Miami?", d: "MLS 2026 season", outcomes: ["LA Galaxy", "Inter Miami", "Draw"], cat: "football", h: 42 },
  { q: "Who will win: NYCFC vs New York Red Bulls?", d: "MLS Hudson River Derby", outcomes: ["NYCFC", "New York Red Bulls", "Draw"], cat: "football", h: 44 },

  // ═══ BASKETBALL (20) ═══
  // NBA
  { q: "Who will win: Lakers vs Celtics?", d: "NBA 2025/26 regular season", outcomes: ["Lakers", "Celtics"], cat: "basketball", h: 3 },
  { q: "Who will win: Warriors vs Bucks?", d: "NBA 2025/26", outcomes: ["Warriors", "Bucks"], cat: "basketball", h: 5 },
  { q: "Who will win: Nuggets vs 76ers?", d: "NBA 2025/26", outcomes: ["Nuggets", "76ers"], cat: "basketball", h: 7 },
  { q: "Who will win: Mavericks vs Suns?", d: "NBA 2025/26", outcomes: ["Mavericks", "Suns"], cat: "basketball", h: 9 },
  { q: "Who will win: Heat vs Knicks?", d: "NBA 2025/26", outcomes: ["Heat", "Knicks"], cat: "basketball", h: 11 },
  { q: "Who will win: Clippers vs Thunder?", d: "NBA 2025/26", outcomes: ["Clippers", "Thunder"], cat: "basketball", h: 13 },
  { q: "Who will win: Timberwolves vs Kings?", d: "NBA 2025/26", outcomes: ["Timberwolves", "Kings"], cat: "basketball", h: 15 },
  { q: "Who will win: Cavaliers vs Pacers?", d: "NBA 2025/26", outcomes: ["Cavaliers", "Pacers"], cat: "basketball", h: 17 },
  { q: "Who will win: Nets vs Bulls?", d: "NBA 2025/26", outcomes: ["Nets", "Bulls"], cat: "basketball", h: 19 },
  { q: "Who will win: Hawks vs Raptors?", d: "NBA 2025/26", outcomes: ["Hawks", "Raptors"], cat: "basketball", h: 21 },
  { q: "Who will win: Spurs vs Rockets?", d: "NBA 2025/26 Texas Rivalry", outcomes: ["Spurs", "Rockets"], cat: "basketball", h: 23 },
  { q: "Who will win: Pelicans vs Grizzlies?", d: "NBA 2025/26", outcomes: ["Pelicans", "Grizzlies"], cat: "basketball", h: 25 },
  // EuroLeague
  { q: "Who will win: Real Madrid vs Barcelona?", d: "EuroLeague Basketball El Clasico", outcomes: ["Real Madrid", "Barcelona"], cat: "basketball", h: 8 },
  { q: "Who will win: Fenerbahce vs Olympiacos?", d: "EuroLeague Basketball", outcomes: ["Fenerbahce", "Olympiacos"], cat: "basketball", h: 14 },
  { q: "Who will win: Panathinaikos vs CSKA Moscow?", d: "EuroLeague Basketball", outcomes: ["Panathinaikos", "CSKA Moscow"], cat: "basketball", h: 20 },
  { q: "Who will win: Bayern Munich vs Anadolu Efes?", d: "EuroLeague Basketball", outcomes: ["Bayern Munich", "Anadolu Efes"], cat: "basketball", h: 27 },
  // NCAA
  { q: "Who will win: Duke vs North Carolina?", d: "NCAA Basketball rivalry", outcomes: ["Duke", "North Carolina"], cat: "basketball", h: 10 },
  { q: "Who will win: Kansas vs Kentucky?", d: "NCAA Basketball", outcomes: ["Kansas", "Kentucky"], cat: "basketball", h: 16 },
  { q: "Who will win: UConn vs Gonzaga?", d: "NCAA Basketball", outcomes: ["UConn", "Gonzaga"], cat: "basketball", h: 29 },
  { q: "Who will win: Michigan State vs Purdue?", d: "NCAA Basketball Big Ten", outcomes: ["Michigan State", "Purdue"], cat: "basketball", h: 33 },

  // ═══ HOCKEY (15) ═══
  // NHL
  { q: "Who will win: Bruins vs Rangers?", d: "NHL 2025/26 season", outcomes: ["Bruins", "Rangers"], cat: "hockey", h: 4 },
  { q: "Who will win: Oilers vs Avalanche?", d: "NHL 2025/26", outcomes: ["Oilers", "Avalanche"], cat: "hockey", h: 6 },
  { q: "Who will win: Panthers vs Hurricanes?", d: "NHL 2025/26", outcomes: ["Panthers", "Hurricanes"], cat: "hockey", h: 8 },
  { q: "Who will win: Maple Leafs vs Canadiens?", d: "NHL Original Six rivalry", outcomes: ["Maple Leafs", "Canadiens"], cat: "hockey", h: 10 },
  { q: "Who will win: Stars vs Jets?", d: "NHL 2025/26", outcomes: ["Stars", "Jets"], cat: "hockey", h: 12 },
  { q: "Who will win: Golden Knights vs Canucks?", d: "NHL 2025/26", outcomes: ["Golden Knights", "Canucks"], cat: "hockey", h: 14 },
  { q: "Who will win: Lightning vs Penguins?", d: "NHL 2025/26", outcomes: ["Lightning", "Penguins"], cat: "hockey", h: 16 },
  { q: "Who will win: Wild vs Blues?", d: "NHL 2025/26 Central Division", outcomes: ["Wild", "Blues"], cat: "hockey", h: 18 },
  { q: "Who will win: Capitals vs Devils?", d: "NHL 2025/26", outcomes: ["Capitals", "Devils"], cat: "hockey", h: 22 },
  { q: "Who will win: Kings vs Sharks?", d: "NHL California rivalry", outcomes: ["Kings", "Sharks"], cat: "hockey", h: 26 },
  { q: "Who will win: Flames vs Predators?", d: "NHL 2025/26", outcomes: ["Flames", "Predators"], cat: "hockey", h: 30 },
  { q: "Who will win: Red Wings vs Blackhawks?", d: "NHL Original Six rivalry", outcomes: ["Red Wings", "Blackhawks"], cat: "hockey", h: 35 },
  { q: "Who will win: Islanders vs Senators?", d: "NHL 2025/26", outcomes: ["Islanders", "Senators"], cat: "hockey", h: 38 },
  { q: "Who will win: Kraken vs Ducks?", d: "NHL 2025/26 Pacific Division", outcomes: ["Kraken", "Ducks"], cat: "hockey", h: 41 },
  { q: "Who will win: Sabres vs Blue Jackets?", d: "NHL 2025/26", outcomes: ["Sabres", "Blue Jackets"], cat: "hockey", h: 45 },

  // ═══ AMERICAN FOOTBALL (10) ═══
  // NFL
  { q: "Who will win: Chiefs vs Eagles?", d: "NFL 2025 season", outcomes: ["Chiefs", "Eagles"], cat: "american-football", h: 24 },
  { q: "Who will win: Cowboys vs 49ers?", d: "NFL 2025 season", outcomes: ["Cowboys", "49ers"], cat: "american-football", h: 28 },
  { q: "Who will win: Bills vs Ravens?", d: "NFL 2025 AFC", outcomes: ["Bills", "Ravens"], cat: "american-football", h: 32 },
  { q: "Who will win: Dolphins vs Jets?", d: "NFL 2025 AFC East rivalry", outcomes: ["Dolphins", "Jets"], cat: "american-football", h: 36 },
  { q: "Who will win: Packers vs Lions?", d: "NFL 2025 NFC North", outcomes: ["Packers", "Lions"], cat: "american-football", h: 40 },
  { q: "Who will win: Bengals vs Steelers?", d: "NFL 2025 AFC North", outcomes: ["Bengals", "Steelers"], cat: "american-football", h: 44 },
  { q: "Who will win: Rams vs Seahawks?", d: "NFL 2025 NFC West", outcomes: ["Rams", "Seahawks"], cat: "american-football", h: 20 },
  { q: "Who will win: Vikings vs Bears?", d: "NFL 2025 NFC North", outcomes: ["Vikings", "Bears"], cat: "american-football", h: 34 },
  { q: "Who will win: Texans vs Jaguars?", d: "NFL 2025 AFC South", outcomes: ["Texans", "Jaguars"], cat: "american-football", h: 42 },
  { q: "Who will win: Cardinals vs Commanders?", d: "NFL 2025 season", outcomes: ["Cardinals", "Commanders"], cat: "american-football", h: 46 },

  // ═══ BASEBALL (8) ═══
  // MLB
  { q: "Who will win: Yankees vs Red Sox?", d: "MLB 2026 season rivalry", outcomes: ["Yankees", "Red Sox"], cat: "baseball", h: 6 },
  { q: "Who will win: Dodgers vs Braves?", d: "MLB 2026 season", outcomes: ["Dodgers", "Braves"], cat: "baseball", h: 12 },
  { q: "Who will win: Astros vs Rangers?", d: "MLB 2026 Texas rivalry", outcomes: ["Astros", "Rangers"], cat: "baseball", h: 18 },
  { q: "Who will win: Mets vs Phillies?", d: "MLB 2026 NL East", outcomes: ["Mets", "Phillies"], cat: "baseball", h: 24 },
  { q: "Who will win: Cubs vs Cardinals?", d: "MLB 2026 NL Central rivalry", outcomes: ["Cubs", "Cardinals"], cat: "baseball", h: 30 },
  { q: "Who will win: Giants vs Padres?", d: "MLB 2026 NL West", outcomes: ["Giants", "Padres"], cat: "baseball", h: 36 },
  { q: "Who will win: Guardians vs White Sox?", d: "MLB 2026 AL Central", outcomes: ["Guardians", "White Sox"], cat: "baseball", h: 42 },
  { q: "Who will win: Mariners vs Angels?", d: "MLB 2026 AL West", outcomes: ["Mariners", "Angels"], cat: "baseball", h: 46 },

  // ═══ MMA (7) ═══
  // UFC
  { q: "Who will win: Islam Makhachev vs Charles Oliveira?", d: "UFC Lightweight Championship", outcomes: ["Islam Makhachev", "Charles Oliveira"], cat: "mma", h: 24 },
  { q: "Who will win: Alex Pereira vs Magomed Ankalaev?", d: "UFC Light Heavyweight bout", outcomes: ["Alex Pereira", "Magomed Ankalaev"], cat: "mma", h: 26 },
  { q: "Who will win: Ilia Topuria vs Max Holloway?", d: "UFC Featherweight Championship", outcomes: ["Ilia Topuria", "Max Holloway"], cat: "mma", h: 28 },
  { q: "Who will win: Sean O'Malley vs Merab Dvalishvili?", d: "UFC Bantamweight bout", outcomes: ["Sean O'Malley", "Merab Dvalishvili"], cat: "mma", h: 30 },
  { q: "Who will win: Leon Edwards vs Belal Muhammad?", d: "UFC Welterweight Championship", outcomes: ["Leon Edwards", "Belal Muhammad"], cat: "mma", h: 34 },
  { q: "Who will win: Jon Jones vs Tom Aspinall?", d: "UFC Heavyweight Super Fight", outcomes: ["Jon Jones", "Tom Aspinall"], cat: "mma", h: 38 },
  { q: "Who will win: Valentina Shevchenko vs Alexa Grasso?", d: "UFC Women's Flyweight", outcomes: ["Valentina Shevchenko", "Alexa Grasso"], cat: "mma", h: 43 },

  // ═══ TENNIS (7) ═══
  // ATP/WTA
  { q: "Who will win: Djokovic vs Sinner?", d: "ATP Grand Slam semifinal", outcomes: ["Djokovic", "Sinner"], cat: "tennis", h: 5 },
  { q: "Who will win: Alcaraz vs Medvedev?", d: "ATP Masters 1000", outcomes: ["Alcaraz", "Medvedev"], cat: "tennis", h: 11 },
  { q: "Who will win: Rune vs Fritz?", d: "ATP Tour 2026", outcomes: ["Rune", "Fritz"], cat: "tennis", h: 17 },
  { q: "Who will win: Sabalenka vs Swiatek?", d: "WTA Grand Slam final", outcomes: ["Sabalenka", "Swiatek"], cat: "tennis", h: 23 },
  { q: "Who will win: Gauff vs Rybakina?", d: "WTA Tour 2026", outcomes: ["Gauff", "Rybakina"], cat: "tennis", h: 31 },
  { q: "Who will win: Zverev vs Tsitsipas?", d: "ATP Tour 2026", outcomes: ["Zverev", "Tsitsipas"], cat: "tennis", h: 37 },
  { q: "Who will win: Ruud vs Rublev?", d: "ATP Tour 2026", outcomes: ["Ruud", "Rublev"], cat: "tennis", h: 43 },

  // ═══ RACING (3) ═══
  // F1
  { q: "Who will win the Bahrain Grand Prix?", d: "F1 2026 Season Opener", outcomes: ["Verstappen", "Hamilton", "Leclerc", "Norris"], cat: "racing", h: 36 },
  { q: "Who will win the Monaco Grand Prix?", d: "F1 2026 Monaco GP", outcomes: ["Leclerc", "Verstappen", "Norris", "Piastri"], cat: "racing", h: 40 },
  { q: "Who will win the British Grand Prix?", d: "F1 2026 British GP at Silverstone", outcomes: ["Hamilton", "Norris", "Verstappen", "Russell"], cat: "racing", h: 44 },
];

// ── Создание рынков ───────────────────────────────────────────

async function main() {
  console.log(`\n  Подключение к ${NETWORK}...`);
  console.log(`  Контракт: ${CONTRACT_ID}`);
  console.log(`  Оракул: ${ORACLE_ID}`);
  console.log(`  Рынков к созданию: ${MARKETS.length}\n`);

  // Подключение
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(ORACLE_KEY);
  await keyStore.setKey(NETWORK, ORACLE_ID, keyPair);

  const near = await connect({
    networkId: NETWORK,
    keyStore,
    nodeUrl: NODE_URL,
  });

  const account = await near.account(ORACLE_ID);

  // Проверяем баланс оракула
  const state = await account.state();
  const balanceNear = (BigInt(state.amount) / BigInt("1000000000000000000000000")).toString();
  console.log(`  Баланс оракула: ~${balanceNear} NEAR\n`);

  let created = 0;
  let failed = 0;

  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];

    const betsEndDate = futureNano(m.h);
    const resolutionDate = futureNano(m.h + 2); // +2 часа после дедлайна ставок

    try {
      const result = await account.functionCall({
        contractId: CONTRACT_ID,
        methodName: "create_market",
        args: {
          question: m.q,
          description: m.d,
          outcomes: m.outcomes,
          category: m.cat,
          betsEndDate,
          resolutionDate,
        },
        gas: "30000000000000", // 30 TGas
        attachedDeposit: "0",
      });

      const txHash = result.transaction?.hash || result.transaction_outcome?.id || "?";
      created++;
      console.log(`  [${String(i + 1).padStart(3)}/${MARKETS.length}] OK  ${m.cat.padEnd(18)} ${m.q.slice(0, 55)}...  TX: ${txHash.slice(0, 12)}...`);
    } catch (err) {
      failed++;
      console.error(`  [${String(i + 1).padStart(3)}/${MARKETS.length}] ERR ${m.cat.padEnd(18)} ${m.q.slice(0, 55)}...  ${err.message?.slice(0, 60)}`);
    }

    // Небольшая пауза между транзакциями (100мс)
    if (i < MARKETS.length - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log(`\n  ════════════════════════════════════════`);
  console.log(`  Создано: ${created} / ${MARKETS.length}`);
  if (failed > 0) console.log(`  Ошибок: ${failed}`);
  console.log(`  ════════════════════════════════════════\n`);
}

main().catch((err) => {
  console.error("Критическая ошибка:", err);
  process.exit(1);
});
