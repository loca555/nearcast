/**
 * AI-валидатор рынков — проверяет спортивные события и предлагает даты
 *
 * Пользователь вводит: спорт, страну, лигу, тип рынка, команды.
 * AI сверяет с реальным расписанием и возвращает подтверждённые данные.
 */

import Database from "better-sqlite3";
import config from "../config.js";
import { chatCompletion, getResponseText, getUsage } from "./ai-client.js";
import { checkBudget, trackUsage } from "./spending-tracker.js";
import { fetchESPNMatches } from "./sports-api.js";

// ── Кэш матчей (SQLite, по UTC-дню) ────────────────────────

let db = null;

function initCache() {
  if (db) return db;
  db = new Database("nearcast-oracle.db");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL,
      utc_date TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(cache_key, utc_date)
    )
  `);
  return db;
}

function getCached(key, utcDate) {
  const database = initCache();
  const row = database
    .prepare("SELECT data FROM matches_cache WHERE cache_key = ? AND utc_date = ?")
    .get(key, utcDate);
  if (row) {
    console.log(`[cache] Кэш-хит: ${key} за ${utcDate}`);
    return JSON.parse(row.data);
  }
  return null;
}

function setCache(key, utcDate, data) {
  const database = initCache();
  database
    .prepare("INSERT OR REPLACE INTO matches_cache (cache_key, utc_date, data) VALUES (?, ?, ?)")
    .run(key, utcDate, JSON.stringify(data));
  console.log(`[cache] Сохранено: ${key} за ${utcDate}`);
}

// ── Парсинг JSON от AI (с очисткой типичных ошибок) ──────────

function parseAIJson(text) {
  // Убираем markdown code blocks (```json ... ```)
  let cleaned = text.replace(/```\w*\n?/g, "").trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[ai-parse] Нет JSON в ответе AI:", text.slice(0, 500));
    throw new Error("AI вернул невалидный ответ: " + text.slice(0, 200));
  }

  let raw = jsonMatch[0];
  // Убираем trailing commas перед ] и }
  raw = raw.replace(/,\s*([\]}])/g, "$1");
  // Убираем комментарии //
  raw = raw.replace(/\/\/[^\n]*/g, "");

  try {
    return JSON.parse(raw);
  } catch (e1) {
    // Вторая попытка: убираем управляющие символы
    try {
      const retry = raw.replace(/[\x00-\x1f]/g, " ");
      return JSON.parse(retry);
    } catch (e2) {
      console.error("[ai-parse] Не удалось распарсить JSON:", raw.slice(0, 500));
      throw new Error("AI JSON parse error: " + e2.message + " | raw: " + raw.slice(0, 200));
    }
  }
}

// ── Доступные виды спорта и типы рынков ───────────────────────

export const SPORTS_CONFIG = {
  football: {
    label: "Футбол",
    search: "Football Soccer",
    countries: {
      england: {
        label: "Англия",
        leagues: {
          "premier-league": { label: "Премьер-лига", espn: "soccer/eng.1", search: "English Premier League" },
          "championship": { label: "Чемпионшип", espn: "soccer/eng.2", search: "EFL Championship" },
          "league-one": { label: "Лига 1", espn: "soccer/eng.3", search: "English League One" },
          "league-two": { label: "Лига 2", espn: "soccer/eng.4", search: "English League Two" },
          "fa-cup": { label: "Кубок Англии", espn: "soccer/eng.fa", search: "FA Cup" },
          "league-cup": { label: "Кубок Лиги", espn: "soccer/eng.league_cup", search: "Carabao Cup" },
        },
      },
      spain: {
        label: "Испания",
        leagues: {
          "la-liga": { label: "Ла Лига", espn: "soccer/esp.1", search: "La Liga" },
          "segunda": { label: "Сегунда", espn: "soccer/esp.2", search: "La Liga 2" },
          "copa-del-rey": { label: "Кубок Короля", espn: "soccer/esp.copa_del_rey", search: "Copa del Rey" },
        },
      },
      germany: {
        label: "Германия",
        leagues: {
          "bundesliga": { label: "Бундеслига", espn: "soccer/ger.1", search: "Bundesliga" },
          "2-bundesliga": { label: "2. Бундеслига", espn: "soccer/ger.2", search: "2. Bundesliga" },
          "dfb-pokal": { label: "Кубок Германии", espn: "soccer/ger.dfb_pokal", search: "DFB-Pokal" },
        },
      },
      italy: {
        label: "Италия",
        leagues: {
          "serie-a": { label: "Серия A", espn: "soccer/ita.1", search: "Serie A" },
          "serie-b": { label: "Серия B", espn: "soccer/ita.2", search: "Serie B" },
          "coppa-italia": { label: "Кубок Италии", espn: "soccer/ita.coppa_italia", search: "Coppa Italia" },
        },
      },
      france: {
        label: "Франция",
        leagues: {
          "ligue-1": { label: "Лига 1", espn: "soccer/fra.1", search: "Ligue 1" },
          "ligue-2": { label: "Лига 2", espn: "soccer/fra.2", search: "Ligue 2" },
          "coupe-de-france": { label: "Кубок Франции", espn: "soccer/fra.coupe_de_france", search: "Coupe de France" },
        },
      },
      netherlands: {
        label: "Нидерланды",
        leagues: {
          "eredivisie": { label: "Эредивизи", espn: "soccer/ned.1", search: "Eredivisie" },
        },
      },
      portugal: {
        label: "Португалия",
        leagues: {
          "primeira": { label: "Примейра-лига", espn: "soccer/por.1", search: "Primeira Liga" },
        },
      },
      turkey: {
        label: "Турция",
        leagues: {
          "super-lig": { label: "Суперлига", espn: "soccer/tur.1", search: "Turkish Super Lig" },
        },
      },
      scotland: {
        label: "Шотландия",
        leagues: {
          "premiership": { label: "Премьершип", espn: "soccer/sco.1", search: "Scottish Premiership" },
        },
      },
      belgium: {
        label: "Бельгия",
        leagues: {
          "pro-league": { label: "Про-Лига", espn: "soccer/bel.1", search: "Belgian Pro League" },
        },
      },
      europe: {
        label: "Еврокубки",
        leagues: {
          "champions-league": { label: "Лига Чемпионов", espn: "soccer/uefa.champions", search: "UEFA Champions League" },
          "europa-league": { label: "Лига Европы", espn: "soccer/uefa.europa", search: "UEFA Europa League" },
          "conference-league": { label: "Лига Конференций", espn: "soccer/uefa.europa.conf", search: "UEFA Conference League" },
        },
      },
      international: {
        label: "Сборные",
        leagues: {
          "world-cup": { label: "Чемпионат мира", espn: "soccer/fifa.world", search: "FIFA World Cup" },
          "euro": { label: "Чемпионат Европы", espn: "soccer/uefa.euro", search: "UEFA Euro" },
          "nations-league": { label: "Лига наций", espn: "soccer/uefa.nations", search: "UEFA Nations League" },
          "friendlies": { label: "Товарищеские", espn: "soccer/fifa.friendly", search: "International Friendlies" },
        },
      },
      "south-america": {
        label: "Южная Америка",
        leagues: {
          "brasileirao": { label: "Бразилейрао", espn: "soccer/bra.1", search: "Brasileirao" },
          "argentina": { label: "Примера Аргентины", espn: "soccer/arg.1", search: "Argentine Primera Division" },
        },
      },
      "north-america": {
        label: "Северная Америка",
        leagues: {
          "mls": { label: "MLS", espn: "soccer/usa.1", search: "Major League Soccer" },
          "liga-mx": { label: "Лига MX", espn: "soccer/mex.1", search: "Liga MX" },
        },
      },
    },
  },
  basketball: {
    label: "Баскетбол",
    search: "Basketball",
    countries: {
      usa: {
        label: "США",
        leagues: {
          "nba": { label: "NBA", espn: "basketball/nba", search: "NBA" },
          "wnba": { label: "WNBA", espn: "basketball/wnba", search: "WNBA" },
        },
      },
    },
  },
  hockey: {
    label: "Хоккей",
    search: "Ice Hockey",
    countries: {
      "north-america": {
        label: "США/Канада",
        leagues: {
          "nhl": { label: "NHL", espn: "hockey/nhl", search: "NHL" },
        },
      },
    },
  },
  "american-football": {
    label: "Американский футбол",
    search: "American Football",
    countries: {
      usa: {
        label: "США",
        leagues: {
          "nfl": { label: "NFL", espn: "football/nfl", search: "NFL" },
          "ncaa-football": { label: "NCAA Football", espn: "football/college-football", search: "NCAA College Football" },
        },
      },
    },
  },
  baseball: {
    label: "Бейсбол",
    search: "Baseball",
    countries: {
      usa: {
        label: "США",
        leagues: {
          "mlb": { label: "MLB", espn: "baseball/mlb", search: "MLB" },
        },
      },
    },
  },
  mma: {
    label: "MMA",
    search: "MMA Mixed Martial Arts",
    countries: {
      international: {
        label: "Международный",
        leagues: {
          "ufc": { label: "UFC", espn: "mma/ufc", search: "UFC" },
        },
      },
    },
  },
  tennis: {
    label: "Теннис",
    search: "Tennis",
    countries: {
      international: {
        label: "Международный",
        leagues: {
          "atp": { label: "ATP", espn: "tennis/atp", search: "ATP Tour" },
          "wta": { label: "WTA", espn: "tennis/wta", search: "WTA Tour" },
        },
      },
    },
  },
  racing: {
    label: "Автоспорт",
    search: "Motorsport Racing",
    countries: {
      international: {
        label: "Международный",
        leagues: {
          "f1": { label: "Формула 1", espn: "racing/f1", search: "Formula 1" },
        },
      },
    },
  },
};

export const MARKET_TYPES = {
  "winner": "Кто победит",
  "over-under": "Тотал (больше/меньше)",
  "both-score": "Обе забьют",
  "correct-score": "Точный счёт",
  "handicap": "Гандикап",
  "first-half": "Исход 1-го тайма",
};

// ── AI: получить ближайшие матчи ─────────────────────────────

// Хелпер: извлечь label, search и espn из конфига лиги
function getLeagueInfo(sport, country, league) {
  const sportCfg = SPORTS_CONFIG[sport];
  const countryCfg = sportCfg?.countries?.[country];
  const leagueCfg = countryCfg?.leagues?.[league];
  const leagueLabel = typeof leagueCfg === "object" ? leagueCfg.label : (leagueCfg || league);
  const leagueSearch = typeof leagueCfg === "object" ? leagueCfg.search : (leagueCfg || league);
  const espnPath = typeof leagueCfg === "object" ? leagueCfg.espn : null;
  return {
    sportLabel: sportCfg?.label || sport,
    sportSearch: sportCfg?.search || sport,
    countryLabel: countryCfg?.label || country,
    leagueLabel,
    leagueSearch,
    espnPath,
  };
}

export async function getUpcomingMatches({ sport, country, league }) {
  const info = getLeagueInfo(sport, country, league);

  const today = new Date().toISOString().split("T")[0];
  const endDate = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  // Проверяем кэш (по UTC-дню)
  const cacheKey = `matches:${sport}:${country}:${league}`;
  const cached = getCached(cacheKey, today);
  if (cached) return cached;

  let result;

  // ESPN API — основной источник расписания
  if (info.espnPath) {
    try {
      const matches = await fetchESPNMatches(info.espnPath, today, endDate);
      result = { matches: matches || [], note: "ESPN" };
      console.log(`[validator] ESPN: ${result.matches.length} событий для ${info.leagueLabel}`);
    } catch (err) {
      console.error(`[validator] ESPN ошибка, fallback на AI:`, err.message);
      result = await fetchMatchesViaAI(info, today, endDate);
    }
  } else {
    // Нет ESPN пути — AI fallback
    console.log(`[validator] ${info.sportLabel}/${info.leagueLabel} — AI fallback`);
    result = await fetchMatchesViaAI(info, today, endDate);
  }

  // Кэшируем только если есть матчи
  if (result.matches && result.matches.length > 0) {
    setCache(cacheKey, today, result);
  }

  return result;
}

// ── AI fallback для неподдерживаемых видов спорта ─────────────

async function fetchMatchesViaAI(info, today, endDate) {
  const prompt = `Search for ${info.leagueSearch} schedule and fixtures from ${today} to ${endDate}.

Find ALL ${info.leagueSearch} games/matches scheduled in this 7-day period (${today} to ${endDate}).

Return ONLY valid JSON (no markdown, no code blocks):
{"matches": [{"teamA": "Home Team", "teamB": "Away Team", "date": "2026-02-21T15:00:00Z", "round": "Matchweek 26"}], "note": "source"}

Rules:
- Up to 15 games, sorted by date
- date in ISO 8601 UTC
- Use real team/club names from the current season
- round — matchweek, round, game number, or stage
- If exact schedule is unavailable, return {"matches": [], "note": "reason"}`;

  checkBudget();

  const response = await chatCompletion(prompt, 2500, { webSearch: true });
  trackUsage("validator", getUsage(response));

  const text = getResponseText(response);
  return parseAIJson(text);
}

// ── AI: сгенерировать рынок для выбранного матча ─────────────

export async function generateMarket({
  sport,
  country,
  league,
  teamA,
  teamB,
  matchDate,
  marketType,
}) {
  const info = getLeagueInfo(sport, country, league);
  const marketTypeLabel = MARKET_TYPES[marketType] || marketType;

  const prompt = `Сгенерируй предсказательный рынок для матча.

Матч: ${teamA} vs ${teamB}
Дата: ${matchDate}
Спорт: ${info.sportLabel}, ${info.leagueLabel} (${info.countryLabel})
Тип рынка: ${marketTypeLabel}

Сформируй:
1. question — вопрос для рынка (на русском, включи команды и дату)
2. description — краткое описание (контекст матча)
3. outcomes — варианты исходов (массив строк)
4. betsEndDate — за 1 час до начала матча
5. resolutionDate — через 3 часа после начала матча

ОТВЕТ СТРОГО В JSON:
{
  "question": "Кто победит: Arsenal vs Chelsea? (Премьер-лига, 20.02.2026)",
  "description": "Матч 25-го тура Премьер-лиги...",
  "outcomes": ["Arsenal", "Ничья", "Chelsea"],
  "betsEndDate": "2026-02-20T19:00:00Z",
  "resolutionDate": "2026-02-20T23:00:00Z"
}

Правила исходов по типу:
- winner: ["${teamA}", "Ничья", "${teamB}"] (убери "Ничья" если ничья невозможна, напр. теннис/MMA)
- over-under: ["Больше 2.5", "Меньше 2.5"] (выбери подходящую линию)
- both-score: ["Да, обе забьют", "Нет"]
- correct-score: ["1:0", "2:1", "2:0", "0:0", "0:1", "1:2", "0:2", "Другой счёт"] (до 8 вариантов)
- handicap: ["${teamA} -1.5", "${teamB} +1.5"] (выбери подходящий гандикап)
- first-half: ["${teamA}", "Ничья", "${teamB}"]`;

  checkBudget();

  const response = await chatCompletion(prompt, 800);
  trackUsage("validator", getUsage(response));

  const text = getResponseText(response);
  return parseAIJson(text);
}
