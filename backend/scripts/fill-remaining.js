#!/usr/bin/env node
/**
 * Добиваем до 50 рынков из доп. лиг
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { createMarket, seedLiquidity } = await import("../services/near.js");
const { fetchESPNMatches } = await import("../services/sports-api.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function toNanos(isoDate) {
  return (BigInt(new Date(isoDate).getTime()) * BigInt(1_000_000)).toString();
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const extraLeagues = [
  { espn: "soccer/ned.1", sport: "soccer", league: "ned.1", label: "Eredivisie", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/por.1", sport: "soccer", league: "por.1", label: "Primeira Liga", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/tur.1", sport: "soccer", league: "tur.1", label: "Super Lig", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/sco.1", sport: "soccer", league: "sco.1", label: "Scottish Premiership", ouLine: 2.5, ouUnit: "goals" },
  { espn: "soccer/bel.1", sport: "soccer", league: "bel.1", label: "Belgian Pro League", ouLine: 2.5, ouUnit: "goals" },
];

const today = new Date().toISOString().split("T")[0];
const endDate = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
const now = Date.now();

let events = [];
for (const lg of extraLeagues) {
  try {
    const matches = await fetchESPNMatches(lg.espn, today, endDate);
    const valid = matches.filter(
      (e) => e.teamA && e.teamB && e.teamB.length > 0 && new Date(e.date).getTime() - now > 2 * 3600000,
    );
    for (const ev of valid) events.push({ ...ev, ...lg, category: "sports" });
    console.log(`${lg.label}: ${valid.length} будущих матчей`);
  } catch (err) {
    console.error(`${lg.label} ошибка: ${err.message}`);
  }
  await sleep(300);
}

events.sort((a, b) => new Date(a.date) - new Date(b.date));

// Нужно ещё 4 пары (4 winner + 4 over-under = 8 рынков → всего 50)
const selected = events.slice(0, 4);
console.log(`\nВыбрано ${selected.length} матчей → ${selected.length * 2} рынков\n`);

let created = 0;
for (const ev of selected) {
  const matchDate = new Date(ev.date);
  const dateStr = fmtDate(ev.date);
  const betsEnd = new Date(matchDate.getTime() - 3600000);
  const resolution = new Date(matchDate.getTime() + 3 * 3600000);

  // Winner
  try {
    console.log(`Winner: ${ev.teamA} vs ${ev.teamB} (${ev.label})`);
    const { marketId } = await createMarket({
      question: `Who will win: ${ev.teamA} vs ${ev.teamB}? (${ev.label}, ${dateStr})`,
      description: `${ev.label} match. ${ev.teamA} (home) vs ${ev.teamB} (away).`,
      outcomes: [ev.teamA, "Draw", ev.teamB],
      category: "sports",
      betsEndDate: toNanos(betsEnd.toISOString()),
      resolutionDate: toNanos(resolution.toISOString()),
      espnEventId: ev.id || "",
      sport: ev.sport,
      league: ev.league,
      marketType: "winner",
    });
    if (marketId != null) {
      try { await seedLiquidity(marketId); } catch {}
    }
    console.log(`  ✓ #${marketId}`);
    created++;
  } catch (err) {
    console.error(`  ✗ ${err.message?.slice(0, 80)}`);
  }
  await sleep(500);

  // O/U
  try {
    console.log(`O/U ${ev.ouLine}: ${ev.teamA} vs ${ev.teamB}`);
    const { marketId } = await createMarket({
      question: `Total over/under ${ev.ouLine} ${ev.ouUnit}: ${ev.teamA} vs ${ev.teamB}? (${ev.label}, ${dateStr})`,
      description: `Will the total be over or under ${ev.ouLine} ${ev.ouUnit}? ${ev.label}: ${ev.teamA} vs ${ev.teamB}.`,
      outcomes: [`Over ${ev.ouLine} ${ev.ouUnit}`, `Under ${ev.ouLine} ${ev.ouUnit}`],
      category: "sports",
      betsEndDate: toNanos(betsEnd.toISOString()),
      resolutionDate: toNanos(resolution.toISOString()),
      espnEventId: ev.id || "",
      sport: ev.sport,
      league: ev.league,
      marketType: "over-under",
    });
    if (marketId != null) {
      try { await seedLiquidity(marketId); } catch {}
    }
    console.log(`  ✓ #${marketId}`);
    created++;
  } catch (err) {
    console.error(`  ✗ ${err.message?.slice(0, 80)}`);
  }
  await sleep(500);
}

console.log(`\nДополнительно создано: ${created}`);
