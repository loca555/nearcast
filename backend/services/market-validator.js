/**
 * AI-валидатор рынков — проверяет спортивные события и предлагает даты
 *
 * Пользователь вводит: спорт, страну, лигу, тип рынка, команды.
 * AI сверяет с реальным расписанием и возвращает подтверждённые данные.
 */

import config from "../config.js";
import { chatCompletion, getResponseText, getUsage } from "./ai-client.js";
import { checkBudget, trackUsage } from "./spending-tracker.js";

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

  const prompt = `Ты — спортивный справочник. Верни список ближайших матчей.

Спорт: ${sportLabel}
Страна/Регион: ${countryLabel}
Лига/Турнир: ${leagueLabel}
Период: с ${today} по ${twoWeeks} (2 недели вперёд)

Верни ВСЕ запланированные матчи на этот период. Если точное расписание неизвестно — предложи наиболее вероятные матчи текущего тура/раунда.

ОТВЕТ СТРОГО В JSON (массив):
{
  "matches": [
    {
      "teamA": "Arsenal",
      "teamB": "Chelsea",
      "date": "2026-02-20T20:00:00Z",
      "round": "25 тур"
    }
  ],
  "note": "пояснение если есть"
}

Правила:
- Верни до 15 матчей, отсортированных по дате
- date в формате ISO 8601 UTC
- round — тур, раунд, этап (если применимо)
- Если сезон закончился или лига на паузе — верни {"matches": [], "note": "причина"}`;

  checkBudget();

  const response = await chatCompletion(prompt, 1500, { webSearch: true });
  trackUsage("validator", getUsage(response));

  const text = getResponseText(response);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI вернул невалидный ответ");
  }

  return JSON.parse(jsonMatch[0]);
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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI вернул невалидный ответ");
  }

  return JSON.parse(jsonMatch[0]);
}
