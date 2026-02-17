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
  });

  modal = setupModal(selector, { theme: "dark" });
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
  return (BigInt(Math.round(amountNear * 1e6)) * BigInt("1000000000000000000")).toString();
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
        "30000000000000", // 30 TGas
        yocto
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
        { amount: yocto },
        "100000000000000", // 100 TGas
        "0"
      ),
    ],
  });
}

// ── Вызовы контракта (автоподпись, без попапа) ────────────────

// Создать рынок
export async function createMarket({
  question,
  description,
  outcomes,
  category,
  betsEndDate,
  resolutionDate,
}) {
  const wallet = await selector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "create_market",
        {
          question,
          description,
          outcomes,
          category,
          betsEndDate: betsEndDate.toString(),
          resolutionDate: resolutionDate.toString(),
        },
        "30000000000000", // 30 TGas
        "0"
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
        { market_id: marketId, outcome, amount: yocto },
        "30000000000000", // 30 TGas
        "0" // Без deposit — списывается из внутреннего баланса
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
        "30000000000000", // 30 TGas
        "0"
      ),
    ],
  });
}

