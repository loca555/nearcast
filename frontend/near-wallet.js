/**
 * NEAR Wallet — подключение кошелька и взаимодействие с контрактом
 *
 * Паттерн: внутренний баланс + function-call access keys
 * - deposit() — единственный вызов с attached NEAR (попап)
 * - Все остальные методы без deposit — автоподпись через access key
 */

import { setupWalletSelector, actionCreators } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui";

let selector = null;
let modal = null;
let contractId = "";

// ── Инициализация ─────────────────────────────────────────────

export async function initWalletSelector(networkId = "testnet", contract = "", nodeUrl = "") {
  contractId = contract;

  const network = nodeUrl
    ? { networkId, nodeUrl }
    : networkId;

  // Function Call Access Key: методы без attached deposit
  // вызываются без попапа кошелька (автоподпись).
  // deposit() и request_resolution() — с attached NEAR — попап останется.
  selector = await setupWalletSelector({
    network,
    modules: [
      setupMyNearWallet({
        walletUrl:
          networkId === "testnet"
            ? "https://testnet.mynearwallet.com"
            : "https://app.mynearwallet.com",
      }),
    ],
    createAccessKeyFor: contract
      ? {
          contractId: contract,
          methodNames: ["place_bet", "claim_winnings", "withdraw", "create_market", "resolve_with_reclaim_proof", "request_resolution"],
        }
      : undefined,
  });

  modal = setupModal(selector, {
    theme: "dark",
    contractId: contract || undefined,
    methodNames: ["place_bet", "claim_winnings", "withdraw", "create_market", "resolve_with_reclaim_proof", "request_resolution"],
  });
  return { selector, modal };
}

// ── Аккаунт ───────────────────────────────────────────────────

export function getAccount() {
  if (!selector) return null;
  const state = selector.store.getState();
  const accounts = state.accounts || [];
  return accounts.length > 0 ? accounts[0] : null;
}

export function showModal() {
  if (modal) modal.show();
}

export async function signOut() {
  if (!selector) return;
  const wallet = await selector.wallet();
  await wallet.signOut();
}

export function subscribe(callback) {
  if (!selector) return () => {};
  const sub = selector.store.observable.subscribe((state) => {
    callback(state.accounts || []);
  });
  return () => sub.unsubscribe();
}

// ── Конвертация NEAR → yoctoNEAR ─────────────────────────────

function nearToYocto(amountNear) {
  return BigInt(Math.round(amountNear * 1e6)) * BigInt("1000000000000000000");
}

// ── Внутренний баланс: deposit / withdraw ─────────────────────

// Пополнение внутреннего баланса (единственный вызов с попапом)
export async function deposit(amountNear) {
  const wallet = await selector.wallet();
  const yocto = nearToYocto(amountNear);
  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "deposit",
        {},
        30_000_000_000_000n, // 30 TGas
        yocto // attached NEAR — попап кошелька
      ),
    ],
  });
}

// Вывод с внутреннего баланса на кошелёк
export async function withdraw(amountNear) {
  const wallet = await selector.wallet();
  const yocto = nearToYocto(amountNear);
  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "withdraw",
        { amount: yocto.toString() },
        100_000_000_000_000n, // 100 TGas
        0n // без deposit — автоподпись
      ),
    ],
  });
}

// ── Вызовы контракта (автоподпись, без попапа) ────────────────

// Создать рынок (Rust-контракт — snake_case поля)
export async function createMarket({
  question,
  description,
  outcomes,
  category,
  betsEndDate,
  resolutionDate,
  espnEventId,
  sport,
  league,
  marketType,
}) {
  const wallet = await selector.wallet();
  const args = {
    question,
    description,
    outcomes,
    category,
    bets_end_date: betsEndDate.toString(),
    resolution_date: resolutionDate.toString(),
  };
  // ESPN метаданные (опциональные)
  if (espnEventId) args.espn_event_id = espnEventId;
  if (sport) args.sport = sport;
  if (league) args.league = league;
  if (marketType) args.market_type = marketType;

  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "create_market",
        args,
        30_000_000_000_000n, // 30 TGas
        0n // без deposit — автоподпись
      ),
    ],
  });
}

// Сделать ставку (из внутреннего баланса, без attached deposit)
export async function placeBet(marketId, outcome, amountNear) {
  const wallet = await selector.wallet();
  const yocto = nearToYocto(amountNear);
  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "place_bet",
        { market_id: marketId, outcome, amount: yocto.toString() },
        30_000_000_000_000n, // 30 TGas
        0n // без deposit — автоподпись
      ),
    ],
  });
}

// Permissionless: запрос разрешения ESPN-рынка через OutLayer TEE
export async function requestResolution(marketId) {
  const wallet = await selector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "request_resolution",
        { market_id: marketId },
        300_000_000_000_000n, // 300 TGas (OutLayer + callback)
        nearToYocto(0.5) // attached 0.5 NEAR — попап кошелька
      ),
    ],
  });
}

// Разрешение через Reclaim zkTLS proof (proof генерирует бэкенд, TX подписывает юзер)
export async function resolveWithReclaimProof(marketId, proof, oracleResult) {
  const wallet = await selector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "resolve_with_reclaim_proof",
        { market_id: marketId, proof, oracle_result: oracleResult },
        300_000_000_000_000n, // 300 TGas (verify + callback)
        0n // без deposit
      ),
    ],
  });
}

// Забрать выигрыш (зачисляется на внутренний баланс)
export async function claimWinnings(marketId) {
  const wallet = await selector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "claim_winnings",
        { market_id: marketId },
        30_000_000_000_000n, // 30 TGas
        0n // без deposit — автоподпись
      ),
    ],
  });
}

