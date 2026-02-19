/**
 * Одноразовый скрипт: seed liquidity для рынков с пустым пулом
 * Добавляет 1 NEAR на каждый исход для всех active рынков с totalPool = 0
 *
 * Запуск: node scripts/seed-existing.js
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

const BET_AMOUNT = "1000000000000000000000000"; // 1 NEAR

async function main() {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(NETWORK, ORACLE_ID, KeyPair.fromString(ORACLE_KEY));
  const near = await connect({ networkId: NETWORK, keyStore, nodeUrl: NODE_URL });
  const account = await near.account(ORACLE_ID);

  console.log(`\n  Контракт: ${CONTRACT_ID} | Оракул: ${ORACLE_ID}\n`);

  // Загружаем все рынки
  const stats = await account.viewFunction({
    contractId: CONTRACT_ID, methodName: "get_stats", args: {},
  });
  const totalMarkets = stats.totalMarkets || 0;
  console.log(`  Всего рынков: ${totalMarkets}\n`);

  let seeded = 0;
  let skipped = 0;

  for (let id = 0; id < totalMarkets; id++) {
    const market = await account.viewFunction({
      contractId: CONTRACT_ID, methodName: "get_market", args: { market_id: id },
    });
    if (!market) { skipped++; continue; }

    // Пропускаем resolved/voided и рынки с ликвидностью
    if (market.status === "resolved" || market.status === "voided") { skipped++; continue; }
    if (BigInt(market.totalPool || "0") > 0n) { skipped++; continue; }

    const outcomes = market.outcomes || [];
    const neededYocto = BigInt(BET_AMOUNT) * BigInt(outcomes.length);

    // Депозит если нужно
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

    // Ставка на каждый исход
    for (let i = 0; i < outcomes.length; i++) {
      await account.functionCall({
        contractId: CONTRACT_ID, methodName: "place_bet",
        args: { market_id: id, outcome: i, amount: BET_AMOUNT },
        gas: "30000000000000", attachedDeposit: "0",
      });
      await new Promise(r => setTimeout(r, 150));
    }

    seeded++;
    console.log(`  [${seeded}] Рынок #${id}: ${market.question.slice(0, 60)} — seed ${outcomes.length} NEAR`);
  }

  console.log(`\n  ════════════════════════════════════════`);
  console.log(`  Засижено: ${seeded} | Пропущено: ${skipped}`);
  console.log(`  ════════════════════════════════════════\n`);
}

main().catch(err => { console.error("Ошибка:", err); process.exit(1); });
