/**
 * OutLayer ESPN Relayer — автоматическое разрешение спортивных рынков
 *
 * Периодически проверяет closed-рынки с espnEventId и вызывает
 * request_resolution на контракте (который вызывает OutLayer TEE).
 *
 * Permissionless: кто угодно может запустить этот бот или вызвать
 * request_resolution напрямую через кошелёк.
 */

import config from "../config.js";
import { getMarkets, requestResolution } from "./near.js";

let relayerIntervalId = null;

// Разрешить один рынок через OutLayer (on-chain)
async function resolveViaOutLayer(market) {
  console.log(`[outlayer] Разрешаю рынок #${market.id} (ESPN: ${market.espn_event_id || market.espnEventId})`);

  try {
    const txHash = await requestResolution(market.id);
    console.log(`[outlayer] Рынок #${market.id} — OutLayer запрос отправлен. TX: ${txHash}`);
    return { success: true, marketId: market.id, txHash };
  } catch (err) {
    console.error(`[outlayer] Ошибка для рынка #${market.id}:`, err.message);
    return { success: false, marketId: market.id, error: err.message };
  }
}

// Проверка и разрешение спортивных рынков
async function checkSportsMarkets() {
  try {
    const markets = await getMarkets({ status: "closed", limit: 50 });
    if (!markets || markets.length === 0) return;

    const now = BigInt(Date.now()) * BigInt(1_000_000);

    for (const market of markets) {
      // Только спортивные рынки с ESPN ID
      const espnId = market.espn_event_id || market.espnEventId;
      if (!espnId) continue;
      if (now < BigInt(market.resolution_date || market.resolutionDate)) continue;

      await resolveViaOutLayer(market);
      // Пауза между вызовами — OutLayer + NEAR gas
      await new Promise((r) => setTimeout(r, 5000));
    }
  } catch (err) {
    console.error("[outlayer] Ошибка:", err.message);
  }
}

// Ручной триггер для одного рынка
export async function triggerResolution(marketId) {
  const { getMarket } = await import("./near.js");
  const market = await getMarket(marketId);
  if (!market) throw new Error(`Рынок #${marketId} не найден`);

  const espnId = market.espn_event_id || market.espnEventId;
  if (!espnId) throw new Error("Рынок не спортивный (нет ESPN ID)");

  const status = market.status;
  if (status === "resolved" || status === "voided") {
    throw new Error(`Рынок уже ${status}`);
  }

  return resolveViaOutLayer(market);
}

export function startRelayer() {
  if (relayerIntervalId) return;
  console.log("[outlayer] Relayer запущен (проверка каждые 5 мин)");
  setTimeout(checkSportsMarkets, 15_000);
  relayerIntervalId = setInterval(checkSportsMarkets, 300_000);
}

export function stopRelayer() {
  if (relayerIntervalId) {
    clearInterval(relayerIntervalId);
    relayerIntervalId = null;
  }
}
