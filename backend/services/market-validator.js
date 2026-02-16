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
        search: "England",
        leagues: {
          "premier-league": { label: "Премьер-лига", search: "English Premier League" },
          "championship": { label: "Чемпионшип", search: "EFL Championship" },
          "fa-cup": { label: "Кубок Англии", search: "FA Cup" },
          "league-cup": { label: "Кубок Лиги", search: "EFL League Cup Carabao Cup" },
        },
      },
      spain: {
        label: "Испания",
        search: "Spain",
        leagues: {
          "la-liga": { label: "Ла Лига", search: "La Liga" },
          "segunda": { label: "Сегунда", search: "La Liga 2 Segunda Division" },
          "copa-del-rey": { label: "Кубок Короля", search: "Copa del Rey" },
        },
      },
      germany: {
        label: "Германия",
        search: "Germany",
        leagues: {
          "bundesliga": { label: "Бундеслига", search: "Bundesliga" },
          "2-bundesliga": { label: "2. Бундеслига", search: "2. Bundesliga" },
          "dfb-pokal": { label: "Кубок Германии", search: "DFB-Pokal" },
        },
      },
      italy: {
        label: "Италия",
        search: "Italy",
        leagues: {
          "serie-a": { label: "Серия A", search: "Serie A" },
          "serie-b": { label: "Серия B", search: "Serie B" },
          "coppa-italia": { label: "Кубок Италии", search: "Coppa Italia" },
        },
      },
      france: {
        label: "Франция",
        search: "France",
        leagues: {
          "ligue-1": { label: "Лига 1", search: "Ligue 1" },
          "ligue-2": { label: "Лига 2", search: "Ligue 2" },
          "coupe-de-france": { label: "Кубок Франции", search: "Coupe de France" },
        },
      },
      europe: {
        label: "Еврокубки",
        search: "Europe",
        leagues: {
          "champions-league": { label: "Лига Чемпионов", search: "UEFA Champions League" },
          "europa-league": { label: "Лига Европы", search: "UEFA Europa League" },
          "conference-league": { label: "Лига Конференций", search: "UEFA Conference League" },
        },
      },
      international: {
        label: "Сборные",
        search: "International",
        leagues: {
          "world-cup": { label: "Чемпионат мира", search: "FIFA World Cup" },
          "euro": { label: "Чемпионат Европы", search: "UEFA Euro" },
          "nations-league": { label: "Лига наций", search: "UEFA Nations League" },
          "friendlies": { label: "Товарищеские", search: "International Friendlies" },
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
        search: "USA",
        leagues: {
          "nba": { label: "NBA", search: "NBA National Basketball Association" },
          "ncaa": { label: "NCAA", search: "NCAA College Basketball" },
        },
      },
      europe: {
        label: "Европа",
        search: "Europe",
        leagues: {
          "euroleague": { label: "Евролига", search: "EuroLeague Basketball" },
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
        search: "International",
        leagues: {
          "grand-slam": { label: "Гранд Слэм", search: "Grand Slam Tennis" },
          "atp-1000": { label: "ATP Masters 1000", search: "ATP Masters 1000" },
          "wta-1000": { label: "WTA 1000", search: "WTA 1000" },
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
        search: "International",
        leagues: {
          "ufc": { label: "UFC", search: "UFC Ultimate Fighting Championship" },
          "bellator": { label: "Bellator", search: "Bellator MMA" },
        },
      },
    },
  },
  hockey: {
    label: "Хоккей",
    search: "Ice Hockey",
    countries: {
      usa: {
        label: "США/Канада",
        search: "USA Canada",
        leagues: {
          "nhl": { label: "NHL", search: "NHL National Hockey League" },
        },
      },
      russia: {
        label: "Россия",
        search: "Russia",
        leagues: {
          "khl": { label: "КХЛ", search: "KHL Kontinental Hockey League" },
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

// Хелпер: извлечь label и search из конфига лиги
function getLeagueInfo(sport, country, league) {
  const sportCfg = SPORTS_CONFIG[sport];
  const countryCfg = sportCfg?.countries?.[country];
  const leagueCfg = countryCfg?.leagues?.[league];
  // Лига может быть объект {label, search} или строка (обратная совместимость)
  const leagueLabel = typeof leagueCfg === "object" ? leagueCfg.label : (leagueCfg || league);
  const leagueSearch = typeof leagueCfg === "object" ? leagueCfg.search : (leagueCfg || league);
  return {
    sportLabel: sportCfg?.label || sport,
    sportSearch: sportCfg?.search || sport,
    countryLabel: countryCfg?.label || country,
    countrySearch: countryCfg?.search || country,
    leagueLabel,
    leagueSearch,
  };
}

export async function getUpcomingMatches({ sport, country, league }) {
  const info = getLeagueInfo(sport, country, league);

  const today = new Date().toISOString().split("T")[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

  // Проверяем кэш (по UTC-дню)
  const cacheKey = `matches:${sport}:${country}:${league}`;
  const cached = getCached(cacheKey, today);
  if (cached) return cached;

  // Генерируем даты ближайших дней для более точного поиска
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86400000);
    days.push(d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
  }

  // Полностью английский промпт для web search
  const prompt = `${info.leagueSearch} schedule ${days[0]} to ${days[6]}.

Search espn.com, flashscore.com, cbssports.com, bbc.com/sport for the ${info.leagueSearch} upcoming games.

List all ${info.leagueSearch} games scheduled from ${today} to ${twoWeeks}. Include games on: ${days.join(", ")}.

Return ONLY valid JSON (no markdown, no code blocks):
{"matches": [{"teamA": "Home Team", "teamB": "Away Team", "date": "2026-02-21T15:00:00Z", "round": "Matchweek 26"}], "note": "source"}

Rules:
- Up to 15 games, sorted by date
- date in ISO 8601 UTC
- Use real team names from the current season
- round — matchweek, round, game number, or stage
- If exact schedule is unavailable, return {"matches": [], "note": "reason"}`;

  checkBudget();

  const response = await chatCompletion(prompt, 2500, { webSearch: true });
  trackUsage("validator", getUsage(response));

  const text = getResponseText(response);
  const result = parseAIJson(text);

  // Кэшируем только если есть матчи
  if (result.matches && result.matches.length > 0) {
    setCache(cacheKey, today, result);
  }

  return result;
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
