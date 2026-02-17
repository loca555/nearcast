import React, { useState, useEffect, useCallback, useContext, createContext } from "react";
import {
  initWalletSelector,
  getAccount,
  showModal,
  signOut,
  subscribe,
  createMarket,
  placeBet,
  claimWinnings,
  claimRefund,
  deposit as walletDeposit,
  withdraw as walletWithdraw,
} from "./near-wallet.js";
import "@near-wallet-selector/modal-ui/styles.css";

// ══════════════════════════════════════════════════════════════
// ПЕРЕВОДЫ
// ══════════════════════════════════════════════════════════════

const TRANSLATIONS = {
  ru: {
    nav: { markets: "Рынки", create: "+ Создать", resolved: "Завершённые", portfolio: "Портфель", connect: "Подключить" },
    status: { active: "Активный", closed: "In-play", resolved: "Resolved", cancelled: "Отменён", resolvedWon: (w) => `Resolved: ${w} won` },
    stats: { markets: "Рынков", volume: "Объём (NEAR)" },
    filters: { all: "Все", active: "Активный", inPlay: "In-play", resolved: "Resolved", cancelled: "Отменённые" },
    sort: { label: "Сортировка", endDate: "Дата окончания", volume: "Объём", newest: "Новые" },
    market: {
      pool: "Пул", bets: "Ставок", outcomes: "Исходов", until: "До", resolution: "Resolution",
      noMarkets: "Рынков пока нет. Создайте первый!", backToMarkets: "← Назад к рынкам",
      outcomesTitle: "Исходы", available: "Доступно", amountNear: "Сумма NEAR",
      placeBet: "Поставить", selectOutcome: "Выберите исход", minBet: "Минимум 0.1 NEAR",
      betAccepted: "Ставка принята!", claimWinnings: "Забрать выигрыш", claimRefund: "Забрать возврат",
      winningsDeposited: "Выигрыш зачислен!", refundDeposited: "Возврат зачислен!",
    },
    balance: {
      title: "Баланс на платформе", deposit: "Пополнить", withdraw: "Вывести", cancel: "Отмена",
      depositPlaceholder: "Сумма NEAR для пополнения", withdrawPlaceholder: "Сумма NEAR для вывода",
      depositDone: "Депозит выполнен!", withdrawDone: "Вывод выполнен!", invalidAmount: "Введите корректную сумму",
    },
    create: {
      title: "Создать рынок", steps: ["Лига", "Матч", "Тип рынка", "Подтверждение"],
      sport: "Спорт *", country: "Страна / Регион *", league: "Лига / Турнир *", select: "— Выберите —",
      showMatches: "Показать ближайшие матчи", loadingSchedule: "Загрузка расписания...",
      selectLeague: "Выберите лигу", upcomingMatches: "Ближайшие матчи", back: "Назад",
      noMatches: "Матчей не найдено", selectMatch: "Выбрать матч",
      selectMarketType: "Выберите тип рынка:", aiGenerating: "AI генерирует рынок...",
      createMarket: "Создать рынок", outcomeOptions: "Варианты исходов:",
      betsUntil: "Ставки до:", resolution: "Resolution:",
      confirmCreate: "Подтвердить и создать", creating: "Создание...", marketCreated: "Рынок создан!",
    },
    resolved: { title: "Завершённые рынки", noResolved: "Завершённых рынков пока нет" },
    portfolio: {
      title: "Мой портфель", refresh: "Обновить", balanceNear: "Баланс (NEAR)",
      bets: "Ставок", markets: "Рынков", totalBet: "Поставлено (NEAR)",
      noBets: "У вас пока нет ставок", outcome: "Исход",
      claimed: "✓ Получено", pending: "Ожидание",
      connectWallet: "Подключите кошелёк", connectNearWallet: "Подключить NEAR кошелёк",
    },
    loading: "Загрузка...", error: "Ошибка",
  },
  en: {
    nav: { markets: "Markets", create: "+ Create", resolved: "Resolved", portfolio: "Portfolio", connect: "Connect" },
    status: { active: "Active", closed: "In-play", resolved: "Resolved", cancelled: "Cancelled", resolvedWon: (w) => `Resolved: ${w} won` },
    stats: { markets: "Markets", volume: "Volume (NEAR)" },
    filters: { all: "All", active: "Active", inPlay: "In-play", resolved: "Resolved", cancelled: "Cancelled" },
    sort: { label: "Sort", endDate: "End Date", volume: "Volume", newest: "Newest" },
    market: {
      pool: "Pool", bets: "Bets", outcomes: "Outcomes", until: "Until", resolution: "Resolution",
      noMarkets: "No markets yet. Create the first one!", backToMarkets: "← Back to markets",
      outcomesTitle: "Outcomes", available: "Available", amountNear: "Amount NEAR",
      placeBet: "Place Bet", selectOutcome: "Select an outcome", minBet: "Minimum 0.1 NEAR",
      betAccepted: "Bet placed!", claimWinnings: "Claim Winnings", claimRefund: "Claim Refund",
      winningsDeposited: "Winnings deposited!", refundDeposited: "Refund deposited!",
    },
    balance: {
      title: "Platform Balance", deposit: "Deposit", withdraw: "Withdraw", cancel: "Cancel",
      depositPlaceholder: "NEAR amount to deposit", withdrawPlaceholder: "NEAR amount to withdraw",
      depositDone: "Deposit complete!", withdrawDone: "Withdrawal complete!", invalidAmount: "Enter a valid amount",
    },
    create: {
      title: "Create Market", steps: ["League", "Match", "Market Type", "Confirm"],
      sport: "Sport *", country: "Country / Region *", league: "League / Tournament *", select: "— Select —",
      showMatches: "Show upcoming matches", loadingSchedule: "Loading schedule...",
      selectLeague: "Select a league", upcomingMatches: "Upcoming Matches", back: "Back",
      noMatches: "No matches found", selectMatch: "Select Match",
      selectMarketType: "Select market type:", aiGenerating: "AI generating market...",
      createMarket: "Create Market", outcomeOptions: "Outcome options:",
      betsUntil: "Bets until:", resolution: "Resolution:",
      confirmCreate: "Confirm & Create", creating: "Creating...", marketCreated: "Market created!",
    },
    resolved: { title: "Resolved Markets", noResolved: "No resolved markets yet" },
    portfolio: {
      title: "My Portfolio", refresh: "Refresh", balanceNear: "Balance (NEAR)",
      bets: "Bets", markets: "Markets", totalBet: "Total Bet (NEAR)",
      noBets: "You have no bets yet", outcome: "Outcome",
      claimed: "✓ Claimed", pending: "Pending",
      connectWallet: "Connect your wallet", connectNearWallet: "Connect NEAR Wallet",
    },
    loading: "Loading...", error: "Error",
  },
};

// ══════════════════════════════════════════════════════════════
// ТЕМЫ
// ══════════════════════════════════════════════════════════════

const THEMES = {
  dark: {
    bg: "#0a0e1a", text: "#e2e8f0", headerBg: "#0f1629", headerBorder: "#1e293b",
    accent: "#818cf8", accentBg: "#6366f1",
    cardBg: "#1e293b", cardBorder: "#334155",
    inputBg: "#0f1629", inputBorder: "#334155",
    secondaryBg: "#334155", secondaryText: "#e2e8f0",
    muted: "#94a3b8", dimmed: "#64748b",
    successBg: "#22c55e22", successText: "#22c55e",
    errorBg: "#ef444422", errorText: "#ef4444",
    outcomeBarEnd: "#1e293b", outcomeFill: "#6366f133", outcomeWin: "#22c55e33",
    balanceGrad: "linear-gradient(135deg, #1e293b 0%, #0f1629 100%)",
    warningBg: "#f59e0b11", warningBorder: "#f59e0b33", warningText: "#f59e0b",
    selectedBg: "#6366f122",
  },
  light: {
    bg: "#f8fafc", text: "#1e293b", headerBg: "#ffffff", headerBorder: "#e2e8f0",
    accent: "#6366f1", accentBg: "#6366f1",
    cardBg: "#ffffff", cardBorder: "#e2e8f0",
    inputBg: "#f1f5f9", inputBorder: "#cbd5e1",
    secondaryBg: "#e2e8f0", secondaryText: "#334155",
    muted: "#64748b", dimmed: "#94a3b8",
    successBg: "#dcfce7", successText: "#16a34a",
    errorBg: "#fef2f2", errorText: "#dc2626",
    outcomeBarEnd: "#f1f5f9", outcomeFill: "#6366f122", outcomeWin: "#22c55e22",
    balanceGrad: "linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)",
    warningBg: "#fefce8", warningBorder: "#fde68a", warningText: "#a16207",
    selectedBg: "#6366f111",
  },
};

// ══════════════════════════════════════════════════════════════
// СТИЛИ (зависят от темы)
// ══════════════════════════════════════════════════════════════

function getStyles(th) {
  return {
    body: { margin: 0, fontFamily: "'Inter', sans-serif", background: th.bg, color: th.text, minHeight: "100vh", transition: "background 0.3s, color 0.3s" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 32px", borderBottom: `1px solid ${th.headerBorder}`, background: th.headerBg },
    logo: { fontSize: 24, fontWeight: 700, color: th.accent },
    nav: { display: "flex", gap: 16, alignItems: "center" },
    navBtn: (active) => ({ padding: "8px 16px", background: active ? th.accent : "transparent", color: active ? "#fff" : th.muted, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500 }),
    walletBtn: { padding: "8px 20px", background: th.accentBg, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 },
    container: { maxWidth: 1100, margin: "0 auto", padding: "24px 16px" },
    card: { background: th.cardBg, borderRadius: 12, padding: 20, marginBottom: 16, border: `1px solid ${th.cardBorder}`, cursor: "pointer", transition: "border-color 0.2s, background 0.3s" },
    cardTitle: { fontSize: 18, fontWeight: 600, marginBottom: 8 },
    badge: (color) => ({ display: "inline-block", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: color + "22", color, marginRight: 8 }),
    input: { width: "100%", padding: "10px 14px", background: th.inputBg, border: `1px solid ${th.inputBorder}`, borderRadius: 8, color: th.text, fontSize: 14, marginBottom: 12, boxSizing: "border-box" },
    select: { padding: "10px 14px", background: th.inputBg, border: `1px solid ${th.inputBorder}`, borderRadius: 8, color: th.text, fontSize: 14, marginBottom: 12 },
    primaryBtn: { padding: "12px 24px", background: th.accentBg, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 15, fontWeight: 600 },
    secondaryBtn: { padding: "8px 16px", background: th.secondaryBg, color: th.secondaryText, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 },
    outcomeBar: (pct, isWinner) => ({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", marginBottom: 8, borderRadius: 8, background: `linear-gradient(90deg, ${isWinner ? th.outcomeWin : th.outcomeFill} ${pct}%, ${th.outcomeBarEnd} ${pct}%)`, border: isWinner ? "1px solid #22c55e" : `1px solid ${th.cardBorder}`, cursor: "pointer" }),
    filters: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
    filterBtn: (active) => ({ padding: "6px 14px", background: active ? th.accentBg : th.cardBg, color: active ? "#fff" : th.muted, border: `1px solid ${th.cardBorder}`, borderRadius: 20, cursor: "pointer", fontSize: 13 }),
    statsRow: { display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" },
    statCard: { flex: 1, minWidth: 140, background: th.cardBg, borderRadius: 12, padding: "16px 20px", border: `1px solid ${th.cardBorder}`, textAlign: "center" },
    statValue: { fontSize: 24, fontWeight: 700, color: th.accent },
    statLabel: { fontSize: 12, color: th.muted, marginTop: 4 },
    backBtn: { background: "none", border: "none", color: th.accent, cursor: "pointer", fontSize: 14, marginBottom: 16, padding: 0 },
    iconBtn: { background: "none", border: `1px solid ${th.cardBorder}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 16, color: th.muted, display: "flex", alignItems: "center", justifyContent: "center" },
  };
}

const STATUS_COLORS = { active: "#22c55e", closed: "#f59e0b", resolved: "#3b82f6", cancelled: "#ef4444" };

// ══════════════════════════════════════════════════════════════
// УТИЛИТЫ
// ══════════════════════════════════════════════════════════════

const ONE_NEAR = 1e24;
const formatNear = (yocto) => {
  if (!yocto || yocto === "0") return "0";
  return (Number(BigInt(yocto)) / ONE_NEAR).toFixed(2);
};

const msToNano = (ms) => (BigInt(ms) * BigInt(1_000_000)).toString();

function formatDate(nanoTimestamp) {
  if (!nanoTimestamp || nanoTimestamp === "0") return "—";
  const ms = Number(BigInt(nanoTimestamp) / BigInt(1_000_000));
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatMatchDate(iso) {
  try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function getStatusLabel(market, t) {
  if (!market) return "—";
  const s = market.status;
  if (s === "active") return t.status.active;
  if (s === "closed") return t.status.closed;
  if (s === "resolved") {
    const idx = market.resolvedOutcome;
    const winner = idx != null && market.outcomes?.[idx];
    return winner ? t.status.resolvedWon(winner) : t.status.resolved;
  }
  if (s === "cancelled") return t.status.cancelled;
  return s;
}

const isErrorMsg = (msg) => msg && (msg.includes("Ошибка") || msg.includes("Error"));

const CATEGORY_LABELS = {
  "спорт": { ru: "Спорт", en: "Sports" },
  "football": { ru: "Футбол", en: "Football" },
  "basketball": { ru: "Баскетбол", en: "Basketball" },
  "hockey": { ru: "Хоккей", en: "Hockey" },
  "american-football": { ru: "Амер. футбол", en: "Am. Football" },
  "baseball": { ru: "Бейсбол", en: "Baseball" },
  "mma": { ru: "MMA", en: "MMA" },
  "tennis": { ru: "Теннис", en: "Tennis" },
  "racing": { ru: "Автоспорт", en: "Motorsport" },
};
const categoryLabel = (cat, lang) => {
  const labels = CATEGORY_LABELS[cat];
  return labels ? (lang === "en" ? labels.en : labels.ru) : cat;
};

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

// ══════════════════════════════════════════════════════════════
// КОНТЕКСТ ПРИЛОЖЕНИЯ
// ══════════════════════════════════════════════════════════════

const AppContext = createContext();
const useApp = () => useContext(AppContext);

// ══════════════════════════════════════════════════════════════
// ГЛАВНЫЙ КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════

export default function App() {
  const mob = useIsMobile();
  const [page, setPage] = useState("markets");
  const [account, setAccount] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [userBets, setUserBets] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [nearConfig, setNearConfig] = useState(null);
  const [balance, setBalance] = useState("0");

  // Язык и тема — сохраняем в localStorage
  const [lang, setLang] = useState(() => localStorage.getItem("nc-lang") || "ru");
  const [theme, setTheme] = useState(() => localStorage.getItem("nc-theme") || "dark");

  const t = TRANSLATIONS[lang];
  const th = THEMES[theme];
  const S = getStyles(th);
  useEffect(() => { localStorage.setItem("nc-lang", lang); }, [lang]);
  useEffect(() => { localStorage.setItem("nc-theme", theme); }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  const toggleLang = () => setLang((prev) => (prev === "ru" ? "en" : "ru"));

  // ── Инициализация ───────────────────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/near-config");
        const cfg = await res.json();
        setNearConfig(cfg);
        await initWalletSelector(cfg.networkId, cfg.contractId, cfg.nodeUrl);
        const acc = getAccount();
        setAccount(acc);
        subscribe((accounts) => {
          setAccount(accounts.length > 0 ? accounts[0] : null);
        });
      } catch (err) {
        console.error("Init error:", err);
      }
    }
    init();
  }, []);

  // ── Загрузка данных ─────────────────────────────────────────

  const loadMarkets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("limit", "500");
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await fetch(`/api/markets?${params}`);
      const data = await res.json();
      setMarkets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Markets load error:", err);
    }
  }, [statusFilter, categoryFilter]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      setStats(await res.json());
    } catch (err) {
      console.error("Stats load error:", err);
    }
  }, []);

  const loadBalance = useCallback(async () => {
    if (!account) return;
    try {
      const res = await fetch(`/api/balance/${account.accountId}`);
      const data = await res.json();
      setBalance(data.balance || "0");
    } catch (err) {
      console.error("Balance load error:", err);
    }
  }, [account]);

  const loadUserBets = useCallback(async () => {
    if (!account) return;
    try {
      const res = await fetch(`/api/user/${account.accountId}/bets`);
      const data = await res.json();
      setUserBets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Bets load error:", err);
    }
  }, [account]);

  useEffect(() => { loadMarkets(); loadStats(); }, [loadMarkets, loadStats]);
  useEffect(() => { if (account) { loadUserBets(); loadBalance(); } }, [account, loadUserBets, loadBalance]);

  const openMarket = async (id) => {
    try {
      const res = await fetch(`/api/markets/${id}`);
      setSelectedMarket(await res.json());
      setPage("market");
    } catch (err) {
      console.error("Market load error:", err);
    }
  };

  // ── Рендер ──────────────────────────────────────────────────

  const ctx = { t, th, S, lang, mob };

  return (
    <AppContext.Provider value={ctx}>
      <div style={S.body}>
        {/* Шапка */}
        <header style={{ ...S.header, ...(mob ? { flexDirection: "column", gap: 12, padding: "12px 16px" } : {}) }}>
          <div style={S.logo}>◈ NearCast</div>
          <nav style={{ ...S.nav, ...(mob ? { flexWrap: "wrap", justifyContent: "center", gap: 8 } : {}) }}>
            <button style={S.navBtn(page === "markets")} onClick={() => setPage("markets")}>{t.nav.markets}</button>
            <button style={S.navBtn(page === "create")} onClick={() => setPage("create")}>{t.nav.create}</button>
            <button style={S.navBtn(page === "resolved")} onClick={() => setPage("resolved")}>{t.nav.resolved}</button>
            <button style={S.navBtn(page === "portfolio")} onClick={() => setPage("portfolio")}>{t.nav.portfolio}</button>

            {/* Переключатель темы */}
            <button style={S.iconBtn} onClick={toggleTheme} title={theme === "dark" ? "Light mode" : "Dark mode"}>
              {theme === "dark" ? "\u2600" : "\u263D"}
            </button>

            {/* Переключатель языка */}
            <button style={S.iconBtn} onClick={toggleLang} title={lang === "ru" ? "English" : "Русский"}>
              {lang === "ru" ? "EN" : "RU"}
            </button>

            {account ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <span style={{ color: th.accent, fontWeight: 600, fontSize: 13 }}>
                  {formatNear(balance)} NEAR
                </span>
                <button style={{ ...S.walletBtn, fontSize: 12, padding: "6px 12px" }} onClick={signOut}>
                  {account.accountId.slice(0, mob ? 10 : 16)}...
                </button>
              </div>
            ) : (
              <button style={S.walletBtn} onClick={showModal}>{t.nav.connect}</button>
            )}
          </nav>
        </header>

        <div style={S.container}>
          {account && <BalancePanel balance={balance} onUpdate={loadBalance} />}

          {page === "markets" && (
            <MarketBrowser
              markets={markets} stats={stats}
              statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              onOpen={openMarket}
            />
          )}
          {page === "market" && selectedMarket && (
            <MarketDetail
              market={selectedMarket} account={account} balance={balance}
              onBack={() => { setPage("markets"); loadMarkets(); }}
              onRefresh={() => { openMarket(selectedMarket.id); loadBalance(); }}
            />
          )}
          {page === "resolved" && <ResolvedMarkets onOpen={openMarket} />}
          {page === "create" && (
            <CreateMarket account={account} onCreated={() => { setPage("markets"); loadMarkets(); }} />
          )}
          {page === "portfolio" && (
            <Portfolio
              account={account} userBets={userBets} markets={markets} balance={balance}
              onRefresh={() => { loadUserBets(); loadMarkets(); loadBalance(); }}
              onOpenMarket={openMarket}
            />
          )}
        </div>
      </div>
    </AppContext.Provider>
  );
}

// ══════════════════════════════════════════════════════════════
// ПАНЕЛЬ БАЛАНСА
// ══════════════════════════════════════════════════════════════

function BalancePanel({ balance, onUpdate }) {
  const { t, th, S, mob } = useApp();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleAction = async () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return setMessage(`${t.error}: ${t.balance.invalidAmount}`);
    setLoading(true); setMessage("");
    try {
      if (mode === "deposit") { await walletDeposit(val); setMessage(t.balance.depositDone); }
      else { await walletWithdraw(val); setMessage(t.balance.withdrawDone); }
      setAmount(""); setMode(null); onUpdate();
    } catch (err) { setMessage(`${t.error}: ${err.message}`); }
    setLoading(false);
  };

  return (
    <div style={{ ...S.card, cursor: "default", marginBottom: 24, background: th.balanceGrad, border: `1px solid ${th.accentBg}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...(mob ? { flexDirection: "column", gap: 12, alignItems: "stretch" } : {}) }}>
        <div style={mob ? { textAlign: "center" } : {}}>
          <div style={{ fontSize: 13, color: th.muted, marginBottom: 4 }}>{t.balance.title}</div>
          <div style={{ fontSize: mob ? 24 : 28, fontWeight: 700, color: th.accent }}>
            {formatNear(balance)} <span style={{ fontSize: 16, fontWeight: 400, color: th.muted }}>NEAR</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: mob ? "center" : "flex-end" }}>
          <button style={{ ...S.primaryBtn, fontSize: 13, padding: "8px 16px" }} onClick={() => setMode(mode === "deposit" ? null : "deposit")}>{t.balance.deposit}</button>
          <button style={{ ...S.secondaryBtn, fontSize: 13 }} onClick={() => setMode(mode === "withdraw" ? null : "withdraw")}>{t.balance.withdraw}</button>
        </div>
      </div>

      {mode && (
        <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", ...(mob ? { flexDirection: "column", alignItems: "stretch" } : {}) }}>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder={mode === "deposit" ? t.balance.depositPlaceholder : t.balance.withdrawPlaceholder}
            min="0.01" step="0.1"
            style={{ ...S.input, width: mob ? "100%" : 260, marginBottom: 0 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...S.primaryBtn, fontSize: 13, padding: "10px 20px", flex: 1, background: mode === "deposit" ? th.accentBg : "#f59e0b", opacity: loading ? 0.5 : 1 }}
              onClick={handleAction} disabled={loading}>
              {loading ? "..." : mode === "deposit" ? t.balance.deposit : t.balance.withdraw}
            </button>
            <button style={{ ...S.secondaryBtn, fontSize: 13 }} onClick={() => { setMode(null); setMessage(""); }}>{t.balance.cancel}</button>
          </div>
        </div>
      )}

      {message && (
        <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: isErrorMsg(message) ? th.errorBg : th.successBg, color: isErrorMsg(message) ? th.errorText : th.successText, fontSize: 14 }}>
          {message}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// СПИСОК РЫНКОВ
// ══════════════════════════════════════════════════════════════

function MarketBrowser({ markets, stats, statusFilter, setStatusFilter, onOpen }) {
  const { t, th, S, lang, mob } = useApp();
  const [sortBy, setSortBy] = useState("newest");
  const [sportFilter, setSportFilter] = useState("all");

  // Извлекаем уникальные категории для фильтра
  const categories = [...new Set(markets.map((m) => m.category).filter(Boolean))];

  // Сортировка
  const sorted = [...markets].sort((a, b) => {
    if (sortBy === "endDate") {
      return Number(BigInt(a.betsEndDate || "0") - BigInt(b.betsEndDate || "0"));
    }
    if (sortBy === "volume") {
      return Number(BigInt(b.totalPool || "0") - BigInt(a.totalPool || "0"));
    }
    // newest — по id по убыванию
    return b.id - a.id;
  });

  // Фильтрация по категории
  const filtered = sportFilter === "all" ? sorted : sorted.filter((m) => m.category === sportFilter);

  return (
    <>
      {stats && (
        <div style={S.statsRow}>
          <div style={S.statCard}>
            <div style={S.statValue}>{stats.totalMarkets || 0}</div>
            <div style={S.statLabel}>{t.stats.markets}</div>
          </div>
          <div style={S.statCard}>
            <div style={S.statValue}>{formatNear(stats.totalVolume)}</div>
            <div style={S.statLabel}>{t.stats.volume}</div>
          </div>
        </div>
      )}

      {/* Статус-фильтры */}
      <div style={S.filters}>
        {[["all", t.filters.all], ["active", t.filters.active], ["closed", t.filters.inPlay]].map(([s, label]) => (
          <button key={s} style={S.filterBtn(statusFilter === s)} onClick={() => setStatusFilter(s)}>{label}</button>
        ))}
      </div>

      {/* Сортировка + фильтр по категории */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, color: th.muted }}>{t.sort.label}:</span>
          {[["newest", t.sort.newest], ["endDate", t.sort.endDate], ["volume", t.sort.volume]].map(([key, label]) => (
            <button key={key} style={S.filterBtn(sortBy === key)} onClick={() => setSortBy(key)}>{label}</button>
          ))}
        </div>
        {categories.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button style={S.filterBtn(sportFilter === "all")} onClick={() => setSportFilter("all")}>{t.filters.all}</button>
            {categories.map((cat) => (
              <button key={cat} style={S.filterBtn(sportFilter === cat)} onClick={() => setSportFilter(cat)}>{categoryLabel(cat, lang)}</button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", color: th.dimmed, padding: 40 }}>{t.market.noMarkets}</div>
      )}
      {filtered.map((m) => (
        <div key={m.id} style={S.card} onClick={() => onOpen(m.id)}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = th.accentBg)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = th.cardBorder)}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 4 }}>
            <span style={S.badge(STATUS_COLORS[m.status] || "#94a3b8")}>{getStatusLabel(m, t)}</span>
            <span style={S.badge("#94a3b8")}>{categoryLabel(m.category, lang)}</span>
          </div>
          <div style={S.cardTitle}>{m.question}</div>
          <div style={{ display: "flex", gap: mob ? 8 : 20, color: th.muted, fontSize: mob ? 12 : 13, flexWrap: "wrap" }}>
            <span>{t.market.pool}: {formatNear(m.totalPool)} NEAR</span>
            <span>{t.market.bets}: {m.totalBets}</span>
            {!mob && <span>{t.market.outcomes}: {m.outcomes.length}</span>}
            <span>{t.market.until}: {formatDate(m.betsEndDate)}</span>
          </div>
        </div>
      ))}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// ДЕТАЛИ РЫНКА
// ══════════════════════════════════════════════════════════════

function MarketDetail({ market, account, balance, onBack, onRefresh }) {
  const { t, th, S, lang, mob } = useApp();
  const [betAmount, setBetAmount] = useState("1");
  const [selectedOutcome, setSelectedOutcome] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const totalPool = BigInt(market.totalPool || "0");

  const handleBet = async () => {
    if (!account) return showModal();
    if (selectedOutcome === null) return setMessage(`${t.error}: ${t.market.selectOutcome}`);
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount < 0.1) return setMessage(`${t.error}: ${t.market.minBet}`);
    setLoading(true); setMessage("");
    try { await placeBet(market.id, selectedOutcome, amount); setMessage(t.market.betAccepted); onRefresh(); }
    catch (err) { setMessage(`${t.error}: ${err.message}`); }
    setLoading(false);
  };

  const handleClaim = async () => {
    setLoading(true); setMessage("");
    try {
      if (market.status === "resolved") { await claimWinnings(market.id); setMessage(t.market.winningsDeposited); }
      else if (market.status === "cancelled") { await claimRefund(market.id); setMessage(t.market.refundDeposited); }
      onRefresh();
    } catch (err) { setMessage(`${t.error}: ${err.message}`); }
    setLoading(false);
  };

  return (
    <>
      <button style={S.backBtn} onClick={onBack}>{t.market.backToMarkets}</button>
      <div style={{ ...S.card, cursor: "default" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={S.badge(STATUS_COLORS[market.status])}>{getStatusLabel(market, t)}</span>
          <span style={S.badge("#94a3b8")}>{categoryLabel(market.category, lang)}</span>
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>{market.question}</h2>
        {market.description && <p style={{ color: th.muted, margin: "0 0 16px", fontSize: 14 }}>{market.description}</p>}
        <div style={{ display: "flex", gap: mob ? 8 : 24, color: th.muted, fontSize: mob ? 12 : 13, marginBottom: 20, flexWrap: "wrap" }}>
          <span>{t.market.pool}: <b style={{ color: th.accent }}>{formatNear(market.totalPool)} NEAR</b></span>
          <span>{t.market.bets}: {market.totalBets}</span>
          <span>{t.market.until}: {formatDate(market.betsEndDate)}</span>
          <span>{t.market.resolution}: {formatDate(market.resolutionDate)}</span>
        </div>

        <h3 style={{ fontSize: 16, marginBottom: 12 }}>{t.market.outcomesTitle}</h3>
        {market.outcomes.map((outcome, i) => {
          const pool = BigInt(market.outcomePools[i] || "0");
          const pct = totalPool > 0n ? Number((pool * 100n) / totalPool) : 0;
          const odds = totalPool > 0n && pool > 0n ? (Number(totalPool) / Number(pool)).toFixed(2) : "—";
          const isWinner = market.resolvedOutcome === i;
          return (
            <div key={i} style={S.outcomeBar(pct, isWinner)} onClick={() => market.status === "active" && setSelectedOutcome(i)}>
              <div>
                <span style={{ fontWeight: selectedOutcome === i ? 700 : 400 }}>
                  {selectedOutcome === i && "● "}{outcome}{isWinner && " ✓"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: th.muted }}>
                <span>{pct}%</span><span>{formatNear(market.outcomePools[i])} NEAR</span><span>x{odds}</span>
              </div>
            </div>
          );
        })}

        {market.status === "active" && (
          <div style={{ marginTop: 20 }}>
            {account && (
              <div style={{ fontSize: 13, color: th.muted, marginBottom: 8 }}>
                {t.market.available}: <b style={{ color: th.accent }}>{formatNear(balance)} NEAR</b>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: mob ? "wrap" : "nowrap" }}>
              <input type="number" value={betAmount} onChange={(e) => setBetAmount(e.target.value)}
                placeholder={t.market.amountNear} min="0.1" step="0.1"
                style={{ ...S.input, width: mob ? "100%" : 140, marginBottom: 0 }} />
              <button style={{ ...S.primaryBtn, opacity: loading ? 0.5 : 1, ...(mob ? { width: "100%" } : {}) }}
                onClick={handleBet} disabled={loading}>
                {loading ? "..." : t.market.placeBet}
              </button>
            </div>
          </div>
        )}

        {(market.status === "resolved" || market.status === "cancelled") && account && (
          <div style={{ marginTop: 20 }}>
            <button style={{ ...S.primaryBtn, background: "#22c55e", opacity: loading ? 0.5 : 1 }}
              onClick={handleClaim} disabled={loading}>
              {market.status === "resolved" ? t.market.claimWinnings : t.market.claimRefund}
            </button>
          </div>
        )}

        {message && (
          <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: isErrorMsg(message) ? th.errorBg : th.successBg, color: isErrorMsg(message) ? th.errorText : th.successText, fontSize: 14 }}>
            {message}
          </div>
        )}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// СОЗДАНИЕ РЫНКА
// ══════════════════════════════════════════════════════════════

function CreateMarket({ account, onCreated }) {
  const { t, th, S, lang, mob } = useApp();
  const [step, setStep] = useState("league");
  const [sportsConfig, setSportsConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [sport, setSport] = useState("");
  const [country, setCountry] = useState("");
  const [league, setLeague] = useState("");
  const [matches, setMatches] = useState([]);
  const [matchesNote, setMatchesNote] = useState("");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [marketType, setMarketType] = useState("winner");
  const [aiResult, setAiResult] = useState(null);

  useEffect(() => {
    fetch("/api/sports-config").then((r) => r.json()).then(setSportsConfig).catch(() => {});
  }, []);

  const countries = sport && sportsConfig?.sports?.[sport]?.countries ? Object.entries(sportsConfig.sports[sport].countries) : [];
  const leagues = sport && country && sportsConfig?.sports?.[sport]?.countries?.[country]?.leagues ? Object.entries(sportsConfig.sports[sport].countries[country].leagues) : [];

  const handleSportChange = (val) => {
    setSport(val); setCountry(""); setLeague("");
    // Сбрасываем тип рынка на первый допустимый для нового спорта
    const allowed = val && sportsConfig?.sports?.[val]?.marketTypes;
    if (allowed && !allowed.includes(marketType)) setMarketType(allowed[0] || "winner");
  };
  const handleCountryChange = (val) => { setCountry(val); setLeague(""); };

  const handleLoadMatches = async () => {
    if (!sport || !country || !league) return setMessage(`${t.error}: ${t.create.selectLeague}`);
    setLoading(true); setMessage("");
    try {
      const res = await fetch("/api/upcoming-matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sport, country, league }) });
      const data = await res.json();
      if (data.error) { setMessage(data.error); setLoading(false); return; }
      setMatches(data.matches || []); setMatchesNote(data.note || ""); setSelectedMatch(null); setStep("matches");
    } catch (err) { setMessage(`${t.error}: ${err.message}`); }
    setLoading(false);
  };

  const handleGenerate = async () => {
    if (!selectedMatch) return;
    setLoading(true); setMessage("");
    try {
      const res = await fetch("/api/generate-market", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport, country, league, teamA: selectedMatch.teamA, teamB: selectedMatch.teamB, matchDate: selectedMatch.date, marketType, lang }) });
      const data = await res.json();
      if (data.error) { setMessage(data.error); setLoading(false); return; }
      setAiResult(data); setStep("confirm");
    } catch (err) { setMessage(`${t.error}: ${err.message}`); }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!account) return showModal();
    if (!aiResult) return;
    setLoading(true); setMessage("");
    try {
      const betsEnd = new Date(aiResult.betsEndDate).getTime();
      const resolution = new Date(aiResult.resolutionDate).getTime();
      await createMarket({ question: aiResult.question, description: aiResult.description || "", outcomes: aiResult.outcomes, category: sport, betsEndDate: msToNano(betsEnd), resolutionDate: msToNano(resolution) });
      setMessage(t.create.marketCreated);
      setTimeout(onCreated, 1500);
    } catch (err) { setMessage(`${t.error}: ${err.message}`); }
    setLoading(false);
  };

  if (!sportsConfig) return <div style={{ color: th.dimmed, padding: 40, textAlign: "center" }}>{t.loading}</div>;

  const sportsList = Object.entries(sportsConfig.sports);
  const allMarketTypes = Object.entries(sportsConfig.marketTypes);
  // Фильтруем типы рынков по выбранному спорту
  const allowedTypes = sport && sportsConfig.sports[sport]?.marketTypes;
  const marketTypes = allowedTypes
    ? allMarketTypes.filter(([key]) => allowedTypes.includes(key))
    : allMarketTypes;
  const stepNames = t.create.steps;
  const stepKeys = ["league", "matches", "market", "confirm"];
  const stepNum = stepKeys.indexOf(step) + 1;

  return (
    <>
      <h2 style={{ fontSize: 22, marginBottom: 20 }}>{t.create.title}</h2>

      {/* Индикатор шагов */}
      <div style={{ display: "flex", gap: mob ? 4 : 8, marginBottom: 24, alignItems: "center", justifyContent: mob ? "center" : "flex-start" }}>
        {stepNames.map((label, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div style={{ width: mob ? 16 : 32, height: 2, background: i < stepNum ? th.accentBg : th.cardBorder }} />}
            <div style={{ display: "flex", alignItems: "center", gap: 4, color: i < stepNum ? th.accent : th.dimmed }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, background: i < stepNum ? th.accentBg : th.cardBg, color: i < stepNum ? "#fff" : th.dimmed, border: `2px solid ${i < stepNum ? th.accentBg : th.cardBorder}` }}>
                {i + 1}
              </div>
              {!mob && <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* ШАГ 1: Выбор лиги */}
      {step === "league" && (
        <div style={{ ...S.card, cursor: "default" }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 13, color: th.muted }}>{t.create.sport}</label>
              <select style={{ ...S.select, width: "100%" }} value={sport} onChange={(e) => handleSportChange(e.target.value)}>
                <option value="">{t.create.select}</option>
                {sportsList.map(([key, val]) => <option key={key} value={key}>{lang === "en" && val.labelEn ? val.labelEn : val.label}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 13, color: th.muted }}>{t.create.country}</label>
              <select style={{ ...S.select, width: "100%" }} value={country} onChange={(e) => handleCountryChange(e.target.value)} disabled={!sport}>
                <option value="">{t.create.select}</option>
                {countries.map(([key, val]) => <option key={key} value={key}>{lang === "en" && val.labelEn ? val.labelEn : val.label}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 13, color: th.muted }}>{t.create.league}</label>
              <select style={{ ...S.select, width: "100%" }} value={league} onChange={(e) => setLeague(e.target.value)} disabled={!country}>
                <option value="">{t.create.select}</option>
                {leagues.map(([key, val]) => <option key={key} value={key}>{typeof val === "object" ? (lang === "en" && val.labelEn ? val.labelEn : val.label) : val}</option>)}
              </select>
            </div>
          </div>
          <button style={{ ...S.primaryBtn, marginTop: 16, opacity: loading ? 0.5 : 1 }} onClick={handleLoadMatches} disabled={loading}>
            {loading ? t.create.loadingSchedule : t.create.showMatches}
          </button>
          {message && <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: th.errorBg, color: th.errorText, fontSize: 14 }}>{message}</div>}
        </div>
      )}

      {/* ШАГ 2: Выбор матча */}
      {step === "matches" && (
        <div style={{ ...S.card, cursor: "default" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, margin: 0 }}>{t.create.upcomingMatches}</h3>
            <button style={S.secondaryBtn} onClick={() => { setStep("league"); setMessage(""); }}>{t.create.back}</button>
          </div>
          {matchesNote && (
            <div style={{ padding: "8px 14px", borderRadius: 8, marginBottom: 16, background: th.warningBg, border: `1px solid ${th.warningBorder}`, color: th.warningText, fontSize: 13 }}>{matchesNote}</div>
          )}
          {matches.length === 0 ? (
            <div style={{ textAlign: "center", color: th.dimmed, padding: 30 }}>{t.create.noMatches}</div>
          ) : (
            matches.map((m, i) => {
              const isSelected = selectedMatch === m;
              return (
                <div key={i} onClick={() => setSelectedMatch(m)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: mob ? "flex-start" : "center",
                  flexDirection: mob ? "column" : "row", gap: mob ? 4 : 0,
                  padding: "12px 16px", marginBottom: 8, borderRadius: 10,
                  background: isSelected ? th.selectedBg : th.inputBg,
                  border: `1px solid ${isSelected ? th.accentBg : th.cardBorder}`,
                  cursor: "pointer", transition: "all 0.15s",
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: mob ? 14 : 15 }}>
                      {isSelected && <span style={{ color: th.accentBg }}>● </span>}
                      {m.teamB ? `${m.teamA} — ${m.teamB}` : m.teamA}
                    </div>
                    {m.round && <div style={{ fontSize: 12, color: th.muted, marginTop: 2 }}>{m.round}</div>}
                  </div>
                  <div style={{ fontSize: mob ? 12 : 14, color: th.accent, fontWeight: 500, whiteSpace: "nowrap" }}>
                    {formatMatchDate(m.date)}
                  </div>
                </div>
              );
            })
          )}
          {selectedMatch && (
            <div style={{ marginTop: 16 }}>
              <button style={S.primaryBtn} onClick={() => { setStep("market"); setMessage(""); }}>{t.create.selectMatch}</button>
            </div>
          )}
        </div>
      )}

      {/* ШАГ 3: Выбор типа рынка */}
      {step === "market" && selectedMatch && (
        <div style={{ ...S.card, cursor: "default" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: mob ? 14 : 16, margin: 0 }}>
              {selectedMatch.teamA} — {selectedMatch.teamB}
              {!mob && <span style={{ color: th.accent, fontSize: 14, fontWeight: 400, marginLeft: 12 }}>{formatMatchDate(selectedMatch.date)}</span>}
              {mob && <div style={{ color: th.accent, fontSize: 12, fontWeight: 400, marginTop: 4 }}>{formatMatchDate(selectedMatch.date)}</div>}
            </h3>
            <button style={S.secondaryBtn} onClick={() => { setStep("matches"); setMessage(""); }}>{t.create.back}</button>
          </div>
          <label style={{ fontSize: 13, color: th.muted }}>{t.create.selectMarketType}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, marginBottom: 16 }}>
            {marketTypes.map(([key, val]) => (
              <button key={key} style={{ padding: "10px 18px", background: marketType === key ? th.accentBg : th.inputBg, color: marketType === key ? "#fff" : th.muted, border: `1px solid ${marketType === key ? th.accentBg : th.cardBorder}`, borderRadius: 8, cursor: "pointer", fontSize: 14 }}
                onClick={() => setMarketType(key)}>{typeof val === "object" ? (lang === "en" ? val.en : val.ru) : val}</button>
            ))}
          </div>
          <button style={{ ...S.primaryBtn, opacity: loading ? 0.5 : 1 }} onClick={handleGenerate} disabled={loading}>
            {loading ? t.create.aiGenerating : t.create.createMarket}
          </button>
          {message && <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: th.errorBg, color: th.errorText, fontSize: 14 }}>{message}</div>}
        </div>
      )}

      {/* ШАГ 4: Подтверждение */}
      {step === "confirm" && aiResult && (
        <div style={{ ...S.card, cursor: "default" }}>
          <h3 style={{ fontSize: 18, margin: "0 0 8px" }}>{aiResult.question}</h3>
          {aiResult.description && <p style={{ color: th.muted, fontSize: 14, margin: "0 0 16px" }}>{aiResult.description}</p>}
          <label style={{ fontSize: 13, color: th.muted }}>{t.create.outcomeOptions}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, marginTop: 4 }}>
            {aiResult.outcomes.map((o, i) => (
              <div key={i} style={{ padding: "8px 16px", background: `${th.accentBg}22`, border: `1px solid ${th.accentBg}55`, borderRadius: 8, color: th.accent, fontSize: 14, fontWeight: 500 }}>{o}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 24, marginBottom: 16, fontSize: 14, flexWrap: "wrap" }}>
            <div><span style={{ color: th.muted }}>{t.create.betsUntil} </span><b>{new Date(aiResult.betsEndDate).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</b></div>
            <div><span style={{ color: th.muted }}>{t.create.resolution} </span><b>{new Date(aiResult.resolutionDate).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</b></div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button style={S.secondaryBtn} onClick={() => { setStep("market"); setAiResult(null); setMessage(""); }}>{t.create.back}</button>
            <button style={{ ...S.primaryBtn, opacity: loading ? 0.5 : 1 }} onClick={handleCreate} disabled={loading}>
              {loading ? t.create.creating : t.create.confirmCreate}
            </button>
          </div>
          {message && (
            <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: isErrorMsg(message) ? th.errorBg : th.successBg, color: isErrorMsg(message) ? th.errorText : th.successText, fontSize: 14 }}>{message}</div>
          )}
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// ЗАВЕРШЁННЫЕ РЫНКИ
// ══════════════════════════════════════════════════════════════

function ResolvedMarkets({ onOpen }) {
  const { t, th, S, lang, mob } = useApp();
  const [markets, setMarkets] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/markets?limit=500");
        const data = await res.json();
        const all = Array.isArray(data) ? data : [];
        setMarkets(all.filter((m) => m.status === "resolved" || m.status === "closed" || m.status === "cancelled"));
      } catch (err) { console.error("Load error:", err); }
      setLoading(false);
    }
    load();
  }, []);

  const filtered = filter === "all" ? markets : markets.filter((m) => m.status === filter);

  return (
    <>
      <h2 style={{ fontSize: 22, marginBottom: 20 }}>{t.resolved.title}</h2>
      <div style={S.filters}>
        {[["all", t.filters.all], ["resolved", t.filters.resolved], ["closed", t.filters.inPlay], ["cancelled", t.filters.cancelled]].map(([key, label]) => (
          <button key={key} style={S.filterBtn(filter === key)} onClick={() => setFilter(key)}>
            {label}
            {key !== "all" && <span style={{ marginLeft: 4, opacity: 0.6 }}>({markets.filter((m) => m.status === key).length})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: th.dimmed, padding: 40 }}>{t.loading}</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: th.dimmed, padding: 40 }}>{t.resolved.noResolved}</div>
      ) : (
        filtered.map((m) => {
          const winnerIdx = m.resolvedOutcome;
          const winner = winnerIdx != null && m.outcomes?.[winnerIdx];
          return (
            <div key={m.id} style={S.card} onClick={() => onOpen(m.id)}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = th.accentBg)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = th.cardBorder)}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 4 }}>
                <span style={S.badge(STATUS_COLORS[m.status] || "#94a3b8")}>{getStatusLabel(m, t)}</span>
                <span style={S.badge("#94a3b8")}>{categoryLabel(m.category, lang)}</span>
              </div>
              <div style={S.cardTitle}>{m.question}</div>
              {winner && (
                <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 8, marginBottom: 8, background: th.successBg, border: `1px solid ${th.successText}44`, color: th.successText, fontSize: 14, fontWeight: 600 }}>
                  {winner}
                </div>
              )}
              <div style={{ display: "flex", gap: mob ? 8 : 20, color: th.muted, fontSize: mob ? 12 : 13, flexWrap: "wrap" }}>
                <span>{t.market.pool}: {formatNear(m.totalPool)} NEAR</span>
                <span>{t.market.bets}: {m.totalBets}</span>
                <span>{t.market.outcomes}: {m.outcomes.length}</span>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// ПОРТФЕЛЬ
// ══════════════════════════════════════════════════════════════

function Portfolio({ account, userBets, markets, balance, onRefresh, onOpenMarket }) {
  const { t, th, S, mob } = useApp();

  if (!account) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <h2 style={{ color: th.dimmed }}>{t.portfolio.connectWallet}</h2>
        <button style={S.walletBtn} onClick={showModal}>{t.portfolio.connectNearWallet}</button>
      </div>
    );
  }

  const betsByMarket = {};
  for (const bet of userBets) {
    if (!betsByMarket[bet.marketId]) betsByMarket[bet.marketId] = [];
    betsByMarket[bet.marketId].push(bet);
  }
  const marketIds = Object.keys(betsByMarket).map(Number);
  const totalBet = userBets.reduce((sum, b) => sum + BigInt(b.amount), 0n);

  return (
    <>
      <h2 style={{ fontSize: 22, marginBottom: 20 }}>
        {t.portfolio.title}
        <button style={{ ...S.secondaryBtn, marginLeft: 12 }} onClick={onRefresh}>{t.portfolio.refresh}</button>
      </h2>

      <div style={{ ...S.statsRow, ...(mob ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } : {}) }}>
        <div style={{ ...S.statCard, ...(mob ? { minWidth: 0 } : {}) }}>
          <div style={{ ...S.statValue, fontSize: mob ? 18 : 24 }}>{formatNear(balance)}</div>
          <div style={S.statLabel}>{t.portfolio.balanceNear}</div>
        </div>
        <div style={{ ...S.statCard, ...(mob ? { minWidth: 0 } : {}) }}>
          <div style={{ ...S.statValue, fontSize: mob ? 18 : 24 }}>{userBets.length}</div>
          <div style={S.statLabel}>{t.portfolio.bets}</div>
        </div>
        <div style={{ ...S.statCard, ...(mob ? { minWidth: 0 } : {}) }}>
          <div style={{ ...S.statValue, fontSize: mob ? 18 : 24 }}>{marketIds.length}</div>
          <div style={S.statLabel}>{t.portfolio.markets}</div>
        </div>
        <div style={{ ...S.statCard, ...(mob ? { minWidth: 0 } : {}) }}>
          <div style={{ ...S.statValue, fontSize: mob ? 18 : 24 }}>{formatNear(totalBet.toString())}</div>
          <div style={S.statLabel}>{t.portfolio.totalBet}</div>
        </div>
      </div>

      {marketIds.length === 0 && (
        <div style={{ textAlign: "center", color: th.dimmed, padding: 40 }}>{t.portfolio.noBets}</div>
      )}

      {marketIds.map((mid) => {
        const bets = betsByMarket[mid];
        const market = markets.find((m) => m.id === mid);
        const marketQuestion = market?.question || `Market #${mid}`;
        const marketStatus = market?.status || "?";

        return (
          <div key={mid} style={S.card} onClick={() => onOpenMarket(mid)}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = th.accentBg)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = th.cardBorder)}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={S.badge(STATUS_COLORS[marketStatus] || "#94a3b8")}>{getStatusLabel(market || { status: marketStatus }, t)}</span>
            </div>
            <div style={S.cardTitle}>{marketQuestion}</div>
            {bets.map((bet, i) => (
              <div key={i} style={{ fontSize: mob ? 12 : 13, color: th.muted, display: "flex", gap: mob ? 6 : 12, marginTop: 4, flexWrap: "wrap" }}>
                <span>{t.portfolio.outcome}: <b style={{ color: th.text }}>{market?.outcomes?.[bet.outcome] || `#${bet.outcome}`}</b></span>
                <span>{formatNear(bet.amount)} NEAR</span>
                <span>{bet.claimed ? t.portfolio.claimed : t.portfolio.pending}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
