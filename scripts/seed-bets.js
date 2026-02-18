/**
 * Скрипт для размещения ставок на все исходы всех активных рынков
 *
 * 1. Переводит NEAR с временных аккаунтов на основной (если указаны)
 * 2. Депозитит NEAR в контракт (internal balance)
 * 3. Ставит 1 NEAR на каждый исход каждого активного рынка
 *
 * Запуск: node scripts/seed-bets.js
 * С переводом: node scripts/seed-bets.js --fund
 * Только ставки (без депозита): node scripts/seed-bets.js --bets-only
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

const BET_AMOUNT = "1000000000000000000000000"; // 1 NEAR в yocto
const NEAR = 1e24;

// ── Временные аккаунты для перевода (созданные через helper API) ──

const TEMP_ACCOUNTS = [
  { id: "nearcast-faucet-tmp1.testnet", key: "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp" },
  { id: "nearcast-faucet-tmp2.testnet", key: "ed25519:4UyAhtp5J6pQA2AyFJ7wjjrJtSHtJwboh4kLzyKabnE3r79gwd5fAkzgHoJeKcM9ftbv7k5vEUYmEf2GBwTj2qga" },
  { id: "nearcast-faucet-tmp3.testnet", key: "ed25519:3gLmDNkLJQLSrPKyhL9kuxoCZYtByfYsgunJk7hPupJVxYM3JiUmaUTkcwmCqNpeWGpKWaqeEWBZ36egebeZegGN" },
  { id: "nearcast-faucet-tmp4.testnet", key: "ed25519:4Mu3iNPFiQLAn8PfWNostGymumYaUCk6VKcAjPExkWzByRFQuuTEGep7KnpcXkuG5yWWdfLXGfoCmkKhZtAyFnn1" },
  { id: "nearcast-faucet-tmp5.testnet", key: "ed25519:3n9XT4LvDXHDU7fvBjQ7aWXvUjTfkVZy66JSfrHBWVRoFQmmDc591ZPdDCRvghzwQqu7xTmqsTyaAmEysuWhHRBH" },
  { id: "nearcast-faucet-tmp6.testnet", key: "ed25519:3Ra8JafeV1CFUu5nM3E94uxggsFszeP7sPMTwHdTtcPpVRGRTkoJ3pn2V8bYcFCzPH2cBazgp3HHxQUsnE6AwTfh" },
  { id: "nearcast-faucet-tmp7.testnet", key: "ed25519:SWyGYRwX6CazCEGWiNeKcktDzMNtHbzPtCHQRqUQeo1b2fMFUSfFviNG8crswEDhM6Xgk1o29ReN7BkunzFJ2Py" },
];

// ── Подключение ───────────────────────────────────────────────

async function initAccount(accountId, privateKey) {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(privateKey);
  await keyStore.setKey(NETWORK, accountId, keyPair);
  const near = await connect({ networkId: NETWORK, keyStore, nodeUrl: NODE_URL });
  return near.account(accountId);
}

// ── Перевод NEAR с временных аккаунтов на основной ────────────

async function fundFromTempAccounts(oracleAccount) {
  console.log("\n  ═══ Перевод NEAR с временных аккаунтов ═══\n");

  let totalTransferred = 0;

  for (const tmp of TEMP_ACCOUNTS) {
    try {
      const tmpAccount = await initAccount(tmp.id, tmp.key);
      const state = await tmpAccount.state();
      const balance = Number(state.amount) / NEAR;

      // Оставляем 0.05 NEAR на gas и storage
      const transferAmount = Math.floor((balance - 0.05) * 100) / 100;

      if (transferAmount <= 0) {
        console.log(`  ${tmp.id}: ${balance.toFixed(2)} NEAR — пропуск (мало средств)`);
        continue;
      }

      const yocto = BigInt(Math.floor(transferAmount * 1e4)) * BigInt(1e20);

      await tmpAccount.sendMoney(ORACLE_ID, yocto.toString());
      totalTransferred += transferAmount;
      console.log(`  ${tmp.id}: перевёл ${transferAmount.toFixed(2)} NEAR`);
    } catch (err) {
      console.log(`  ${tmp.id}: ОШИБКА — ${err.message?.slice(0, 60)}`);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n  Итого переведено: ${totalTransferred.toFixed(2)} NEAR\n`);

  // Проверяем итоговый баланс
  const bal = await oracleAccount.getAccountBalance();
  console.log(`  Баланс ${ORACLE_ID}: ${(Number(bal.available) / NEAR).toFixed(2)} NEAR\n`);

  return totalTransferred;
}

// ── Получение всех активных рынков ────────────────────────────

async function getActiveMarkets(viewAccount) {
  const stats = await viewAccount.viewFunction({
    contractId: CONTRACT_ID,
    methodName: "get_stats",
    args: {},
  });

  const totalMarkets = stats.totalMarkets || stats.total_markets || 0;
  const markets = [];

  // Загружаем рынки пачками
  for (let from = 0; from < totalMarkets; from += 50) {
    const batch = await viewAccount.viewFunction({
      contractId: CONTRACT_ID,
      methodName: "get_markets",
      args: { from_index: from, limit: 50 },
    });
    markets.push(...batch);
  }

  // Только активные рынки
  return markets.filter((m) => m.status === "active");
}

// ── Депозит и ставки ──────────────────────────────────────────

async function depositAndBet(oracleAccount, markets) {
  // Считаем нужную сумму
  let totalOutcomes = 0;
  for (const m of markets) {
    totalOutcomes += m.outcomes.length;
  }

  const neededNear = totalOutcomes; // 1 NEAR на каждый исход
  console.log(`\n  ═══ Размещение ставок ═══\n`);
  console.log(`  Рынков: ${markets.length}`);
  console.log(`  Исходов: ${totalOutcomes}`);
  console.log(`  Нужно: ${neededNear} NEAR\n`);

  const skipDeposit = process.argv.includes("--bets-only");

  if (!skipDeposit) {
    // Проверяем текущий баланс на контракте
    let currentBalance = "0";
    try {
      currentBalance = await oracleAccount.viewFunction({
        contractId: CONTRACT_ID,
        methodName: "get_balance",
        args: { account_id: ORACLE_ID },
      });
    } catch { /* нет баланса */ }

    const currentNear = Number(currentBalance) / NEAR;
    console.log(`  Баланс на контракте: ${currentNear.toFixed(2)} NEAR`);

    const depositNeeded = Math.max(0, neededNear - currentNear + 1); // +1 запас

    if (depositNeeded > 0) {
      const depositYocto = BigInt(Math.ceil(depositNeeded)) * BigInt(NEAR);
      console.log(`  Депозит: ${Math.ceil(depositNeeded)} NEAR...`);

      await oracleAccount.functionCall({
        contractId: CONTRACT_ID,
        methodName: "deposit",
        args: {},
        gas: "30000000000000",
        attachedDeposit: depositYocto.toString(),
      });

      console.log(`  Депозит выполнен!\n`);
    } else {
      console.log(`  Достаточно средств на контракте\n`);
    }
  }

  // Размещаем ставки
  let placed = 0;
  let skipped = 0;
  let failed = 0;

  for (const market of markets) {
    for (let outcome = 0; outcome < market.outcomes.length; outcome++) {
      try {
        await oracleAccount.functionCall({
          contractId: CONTRACT_ID,
          methodName: "place_bet",
          args: {
            market_id: market.id,
            outcome,
            amount: BET_AMOUNT,
          },
          gas: "30000000000000",
          attachedDeposit: "0",
        });

        placed++;
        const pct = ((placed + skipped + failed) / totalOutcomes * 100).toFixed(0);
        process.stdout.write(`\r  [${pct}%] Ставка #${placed}: Рынок ${market.id}, исход "${market.outcomes[outcome]}" — 1 NEAR   `);
      } catch (err) {
        const msg = err.message || "";
        if (msg.includes("already placed") || msg.includes("Already bet")) {
          skipped++;
          process.stdout.write(`\r  [${((placed + skipped + failed) / totalOutcomes * 100).toFixed(0)}%] Пропуск: Рынок ${market.id}, исход ${outcome} — уже есть ставка   `);
        } else {
          failed++;
          console.log(`\n  [ERR] Рынок ${market.id}, исход ${outcome}: ${msg.slice(0, 80)}`);
        }
      }

      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.log(`\n\n  ════════════════════════════════════════`);
  console.log(`  Ставок размещено: ${placed}`);
  if (skipped > 0) console.log(`  Пропущено (дубли): ${skipped}`);
  if (failed > 0) console.log(`  Ошибок: ${failed}`);
  console.log(`  ════════════════════════════════════════\n`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log(`\n  NEAR: ${NETWORK} | Контракт: ${CONTRACT_ID} | Аккаунт: ${ORACLE_ID}\n`);

  const oracleAccount = await initAccount(ORACLE_ID, ORACLE_KEY);

  // Шаг 1: Перевод средств (если --fund)
  if (process.argv.includes("--fund")) {
    await fundFromTempAccounts(oracleAccount);
  }

  // Шаг 2: Получаем рынки
  const markets = await getActiveMarkets(oracleAccount);
  console.log(`  Найдено активных рынков: ${markets.length}`);

  if (markets.length === 0) {
    console.log("  Нет активных рынков для ставок.\n");
    return;
  }

  // Шаг 3: Депозит и ставки
  await depositAndBet(oracleAccount, markets);
}

main().catch((err) => {
  console.error("Критическая ошибка:", err);
  process.exit(1);
});
