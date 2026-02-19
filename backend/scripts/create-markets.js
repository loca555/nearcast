#!/usr/bin/env node
/**
 * Скрипт создания 50 рынков (25 winner + 25 over-under)
 *
 * Получает реальные ближайшие матчи через ESPN API,
 * создаёт рынки на контракте и сидирует ликвидность.
 *
 * Запуск: node backend/scripts/create-markets.js  (из корня NearCast)
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Загружаем .env из корня NearCast (где он лежит)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Динамический импорт после загрузки env
const { createMarket, seedLiquidity } = await import("../services/near.js");
const { fetchESPNMatches } = await import("../services/sports-api.js");

// ── Конфигурация лиг для сбора матчей ──────────────────────────

const LEAGUES = [
  { espn: "soccer/eng.1", sport: "soccer", league: "eng.1", label: "Premier League", category: "sports", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/esp.1", sport: "soccer", league: "esp.1", label: "La Liga", category: "sports", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/ger.1", sport: "soccer", league: "ger.1", label: "Bundesliga", category: "sports", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/ita.1", sport: "soccer", league: "ita.1", label: "Serie A", category: "sports", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/fra.1", sport: "soccer", league: "fra.1", label: "Ligue 1", category: "sports", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/uefa.champions", sport: "soccer", league: "uefa.champions", label: "Champions League", category: "sports", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/uefa.europa", sport: "soccer", league: "uefa.europa", label: "Europa League", category: "sports", ouLine: 2.5, ouUnit: "goals" },
  { espn: "basketball/nba", sport: "basketball", league: "nba", label: "NBA", category: "sports", ouLine: 215.5, ouUnit: "points", noDraws: true },
  { espn: "hockey/nhl", sport: "hockey", league: "nhl", label: "NHL", category: "sports", ouLine: 5.5, ouUnit: "goals", noDraws: true },
];

// ── Хелперы ────────────────────────────────────────────────────

/** ISO дата → наносекунды (строка) для NEAR контракта */
function toNanos(isoDate) {
  const ms = new Date(isoDate).getTime();
  return (BigInt(ms) * BigInt(1_000_000)).toString();
}

/** Форматировать дату кратко */
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Пауза */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Основная логика ────────────────────────────────────────────

async function main() {
  console.log("═══ NearCast — Создание 50 рынков ═══\n");

  // 1. Собираем ближайшие матчи из ESPN
  const today = new Date().toISOString().split("T")[0];
  const endDate = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]; // 2 недели

  console.log(`Период: ${today} → ${endDate}\n`);

  let allEvents = [];

  for (const lg of LEAGUES) {
    try {
      const events = await fetchESPNMatches(lg.espn, today, endDate);
      // Берём только матчи с двумя командами и будущей датой
      const valid = events.filter(
        (e) => e.teamA && e.teamB && e.teamB !== "" && new Date(e.date) > new Date(),
      );
      for (const ev of valid) {
        allEvents.push({ ...ev, ...lg });
      }
      console.log(`  ${lg.label}: ${valid.length} предстоящих матчей`);
    } catch (err) {
      console.error(`  ${lg.label}: ошибка — ${err.message}`);
    }
    await sleep(300); // щадим ESPN API
  }

  console.log(`\nВсего матчей: ${allEvents.length}`);

  // Сортируем по дате
  allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Берём 25 уникальных матчей (для 25 winner + 25 over-under = 50 рынков)
  const selectedEvents = allEvents.slice(0, 25);

  if (selectedEvents.length < 25) {
    console.warn(`\n⚠ Найдено только ${selectedEvents.length} матчей (нужно 25). Создам ${selectedEvents.length * 2} рынков.`);
  }

  console.log(`\nСоздаю рынки для ${selectedEvents.length} матчей...\n`);

  let created = 0;
  let failed = 0;

  for (let i = 0; i < selectedEvents.length; i++) {
    const ev = selectedEvents[i];
    const matchDate = new Date(ev.date);
    const dateStr = fmtDate(ev.date);

    // Даты для контракта
    const betsEnd = new Date(matchDate.getTime() - 60 * 60 * 1000); // -1 час
    const resolution = new Date(matchDate.getTime() + 3 * 60 * 60 * 1000); // +3 часа

    const betsEndNanos = toNanos(betsEnd.toISOString());
    const resolutionNanos = toNanos(resolution.toISOString());

    // ── Winner рынок ──
    const winnerOutcomes = ev.noDraws
      ? [ev.teamA, ev.teamB]
      : [ev.teamA, "Draw", ev.teamB];

    try {
      console.log(`[${i * 2 + 1}/50] Winner: ${ev.teamA} vs ${ev.teamB} (${ev.label})`);
      const { marketId } = await createMarket({
        question: `Who will win: ${ev.teamA} vs ${ev.teamB}? (${ev.label}, ${dateStr})`,
        description: `${ev.label} match. ${ev.teamA} (home) vs ${ev.teamB} (away). ${ev.round || ""}`.trim(),
        outcomes: winnerOutcomes,
        category: ev.category,
        betsEndDate: betsEndNanos,
        resolutionDate: resolutionNanos,
        espnEventId: ev.id || "",
        sport: ev.sport,
        league: ev.league,
        marketType: "winner",
      });

      // Сидируем ликвидность
      if (marketId != null) {
        try {
          await seedLiquidity(marketId);
          console.log(`  ✓ Рынок #${marketId} + ликвидность`);
        } catch (liqErr) {
          console.warn(`  ✓ Рынок #${marketId} (ликвидность: ${liqErr.message?.slice(0, 60)})`);
        }
      } else {
        console.log(`  ✓ Рынок создан (ID не извлечён)`);
      }
      created++;
    } catch (err) {
      console.error(`  ✗ Winner ошибка: ${err.message?.slice(0, 100)}`);
      failed++;
    }

    await sleep(500);

    // ── Over/Under рынок ──
    try {
      console.log(`[${i * 2 + 2}/50] O/U ${ev.ouLine}: ${ev.teamA} vs ${ev.teamB} (${ev.label})`);
      const { marketId } = await createMarket({
        question: `Total over/under ${ev.ouLine} ${ev.ouUnit}: ${ev.teamA} vs ${ev.teamB}? (${ev.label}, ${dateStr})`,
        description: `Will the total be over or under ${ev.ouLine} ${ev.ouUnit}? ${ev.label}: ${ev.teamA} vs ${ev.teamB}. ${ev.round || ""}`.trim(),
        outcomes: [`Over ${ev.ouLine} ${ev.ouUnit}`, `Under ${ev.ouLine} ${ev.ouUnit}`],
        category: ev.category,
        betsEndDate: betsEndNanos,
        resolutionDate: resolutionNanos,
        espnEventId: ev.id || "",
        sport: ev.sport,
        league: ev.league,
        marketType: "over-under",
      });

      if (marketId != null) {
        try {
          await seedLiquidity(marketId);
          console.log(`  ✓ Рынок #${marketId} + ликвидность`);
        } catch (liqErr) {
          console.warn(`  ✓ Рынок #${marketId} (ликвидность: ${liqErr.message?.slice(0, 60)})`);
        }
      } else {
        console.log(`  ✓ Рынок создан (ID не извлечён)`);
      }
      created++;
    } catch (err) {
      console.error(`  ✗ O/U ошибка: ${err.message?.slice(0, 100)}`);
      failed++;
    }

    await sleep(500);
  }

  console.log(`\n═══ Итого ═══`);
  console.log(`Создано: ${created}`);
  console.log(`Ошибки: ${failed}`);
}

main().catch((err) => {
  console.error("Фатальная ошибка:", err);
  process.exit(1);
});
