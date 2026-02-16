/**
 * AI-валидатор рынков — проверяет спортивные события и предлагает даты
 *
 * Пользователь вводит: спорт, страну, лигу, тип рынка, команды.
 * AI сверяет с реальным расписанием и возвращает подтверждённые данные.
 */

import config from "../config.js";
import { chatCompletion, getResponseText, getUsage } from "./ai-client.js";
import { checkBudget, trackUsage } from "./spending-tracker.js";

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
    countries: {
      england: {
        label: "Англия",
        leagues: {
          "premier-league": "Премьер-лига",
          "championship": "Чемпионшип",
          "fa-cup": "Кубок Англии",
          "league-cup": "Кубок Лиги",
        },
      },
      spain: {
        label: "Испания",
        leagues: {
          "la-liga": "Ла Лига",
          "segunda": "Сегунда",
          "copa-del-rey": "Кубок Короля",
        },
      },
      germany: {
        label: "Германия",
        leagues: {
          "bundesliga": "Бундеслига",
          "2-bundesliga": "2. Бундеслига",
          "dfb-pokal": "Кубок Германии",
        },
      },
      italy: {
        label: "Италия",
        leagues: {
          "serie-a": "Серия A",
          "serie-b": "Серия B",
          "coppa-italia": "Кубок Италии",
        },
      },
      france: {
        label: "Франция",
        leagues: {
          "ligue-1": "Лига 1",
          "ligue-2": "Лига 2",
          "coupe-de-france": "Кубок Франции",
        },
      },
      europe: {
        label: "Еврокубки",
        leagues: {
          "champions-league": "Лига Чемпионов",
          "europa-league": "Лига Европы",
          "conference-league": "Лига Конференций",
        },
      },
      international: {
        label: "Сборные",
        leagues: {
          "world-cup": "Чемпионат мира",
          "euro": "Чемпионат Европы",
          "nations-league": "Лига наций",
          "friendlies": "Товарищеские",
        },
      },
    },
  },
  basketball: {
    label: "Баскетбол",
    countries: {
      usa: {
        label: "США",
        leagues: {
          "nba": "NBA",
          "ncaa": "NCAA",
        },
      },
      europe: {
        label: "Европа",
        leagues: {
          "euroleague": "Евролига",
        },
      },
    },
  },
  tennis: {
    label: "Теннис",
    countries: {
      international: {
        label: "Международный",
        leagues: {
          "grand-slam": "Гранд Слэм",
          "atp-1000": "ATP Masters 1000",
          "wta-1000": "WTA 1000",
        },
      },
    },
  },
  mma: {
    label: "MMA",
    countries: {
      international: {
        label: "Международный",
        leagues: {
          "ufc": "UFC",
          "bellator": "Bellator",
        },
      },
    },
  },
  hockey: {
    label: "Хоккей",
    countries: {
      usa: {
        label: "США/Канада",
        leagues: {
          "nhl": "NHL",
        },
      },
      russia: {
        label: "Россия",
        leagues: {
          "khl": "КХЛ",
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

export async function getUpcomingMatches({ sport, country, league }) {
  const sportLabel = SPORTS_CONFIG[sport]?.label || sport;
  const countryData = SPORTS_CONFIG[sport]?.countries?.[country];
  const countryLabel = countryData?.label || country;
  const leagueLabel = countryData?.leagues?.[league] || league;

  const today = new Date().toISOString().split("T")[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

  // Промпт на английском — лучше для web search (больше данных в сети)
  const prompt = `Search for the current ${leagueLabel} fixtures schedule.

Find ALL ${leagueLabel} (${countryLabel}, ${sportLabel}) matches scheduled between ${today} and ${twoWeeks}.

Return ONLY valid JSON:
{
  "matches": [
    {"teamA": "Home Team", "teamB": "Away Team", "date": "2026-02-21T15:00:00Z", "round": "Matchweek 26"}
  ],
  "note": "source or explanation"
}

Rules:
- Up to 15 matches, sorted by date
- date in ISO 8601 UTC
- Use real team names from the current season
- round — matchweek, round, or stage
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
  const sportLabel = SPORTS_CONFIG[sport]?.label || sport;
  const countryData = SPORTS_CONFIG[sport]?.countries?.[country];
  const countryLabel = countryData?.label || country;
  const leagueLabel = countryData?.leagues?.[league] || league;
  const marketTypeLabel = MARKET_TYPES[marketType] || marketType;

  const prompt = `Сгенерируй предсказательный рынок для матча.

Матч: ${teamA} vs ${teamB}
Дата: ${matchDate}
Спорт: ${sportLabel}, ${leagueLabel} (${countryLabel})
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
