/**
 * ESPN API — расписание спортивных событий
 *
 * Неофициальный, но открытый API ESPN.
 * Без ключа, без жёсткого лимита.
 * Паттерн: /sports/{sport}/{league}/scoreboard?dates=YYYYMMDD-YYYYMMDD
 */

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

/**
 * Получить матчи/события из ESPN API
 * @param {string} espnPath — путь ESPN, напр. "soccer/eng.1" или "basketball/nba"
 * @param {string} from — дата начала "YYYY-MM-DD"
 * @param {string} to — дата конца "YYYY-MM-DD"
 * @returns {Array} массив матчей {teamA, teamB, date, round}
 */
export async function fetchESPNMatches(espnPath, from, to) {
  const fromStr = from.replace(/-/g, "");
  const toStr = to.replace(/-/g, "");
  const url = `${ESPN_BASE}/${espnPath}/scoreboard?dates=${fromStr}-${toStr}&limit=50`;

  console.log(`[espn] GET ${espnPath} (${from} → ${to})`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ESPN API ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const events = data.events || [];

  console.log(`[espn] ${espnPath}: ${events.length} событий`);

  return events
    .map((event) => parseEvent(event))
    .filter(Boolean)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 25);
}

/**
 * Парсинг одного события ESPN в единый формат
 */
function parseEvent(event) {
  const comp = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];

  // Определяем участников (команды или спортсмены)
  const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
  const away = competitors.find((c) => c.homeAway === "away") || competitors[1];

  let teamA, teamB;

  if (home && away) {
    // Стандартный матч: 2 участника (команды или бойцы)
    teamA = home.team?.displayName || home.athlete?.displayName || "TBD";
    teamB = away.team?.displayName || away.athlete?.displayName || "TBD";
  } else if (competitors.length === 1) {
    // Один участник (например, F1 — гонка)
    teamA = event.name || "TBD";
    teamB = "";
  } else {
    // Нет участников — используем название события (турнир, гонка)
    teamA = event.name || "TBD";
    teamB = "";
  }

  // Определяем раунд / тур
  const round =
    comp.series?.summary ||
    event.status?.type?.detail ||
    "";

  return {
    teamA,
    teamB,
    date: event.date,
    round,
  };
}

/**
 * Проверяет доступность ESPN пути (не все лиги поддерживаются)
 */
export function isESPNSupported(espnPath) {
  return !!espnPath;
}
