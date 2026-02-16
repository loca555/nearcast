import React, { useState, useEffect, useCallback } from "react";
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

// ── Определение мобильного устройства ────────────────────────

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < breakpoint
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

// ── Утилиты ───────────────────────────────────────────────────

const ONE_NEAR = 1e24;
const formatNear = (yocto) => {
  if (!yocto || yocto === "0") return "0";
  return (Number(BigInt(yocto)) / ONE_NEAR).toFixed(2);
};

const formatDate = (nanoTimestamp) => {
  if (!nanoTimestamp || nanoTimestamp === "0") return "—";
  const ms = Number(BigInt(nanoTimestamp) / BigInt(1_000_000));
  return new Date(ms).toLocaleString("ru-RU");
};

const msToNano = (ms) => (BigInt(ms) * BigInt(1_000_000)).toString();

const CATEGORIES = ["спорт"];
const STATUS_LABELS = {
  active: "Активный",
  closed: "Закрыт",
  resolved: "Разрешён",
  cancelled: "Отменён",
};
const STATUS_COLORS = {
  active: "#22c55e",
  closed: "#f59e0b",
  resolved: "#3b82f6",
  cancelled: "#ef4444",
};

// ── Стили ─────────────────────────────────────────────────────

const styles = {
  body: {
    margin: 0,
    fontFamily: "'Inter', sans-serif",
    background: "#0a0e1a",
    color: "#e2e8f0",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 32px",
    borderBottom: "1px solid #1e293b",
    background: "#0f1629",
  },
  logo: { fontSize: 24, fontWeight: 700, color: "#818cf8" },
  nav: { display: "flex", gap: 16, alignItems: "center" },
  navBtn: (active) => ({
    padding: "8px 16px",
    background: active ? "#818cf8" : "transparent",
    color: active ? "#fff" : "#94a3b8",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
  }),
  walletBtn: {
    padding: "8px 20px",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
  },
  container: { maxWidth: 1100, margin: "0 auto", padding: "24px 16px" },
  card: {
    background: "#1e293b",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    border: "1px solid #334155",
    cursor: "pointer",
    transition: "border-color 0.2s",
  },
  cardTitle: { fontSize: 18, fontWeight: 600, marginBottom: 8 },
  badge: (color) => ({
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    background: color + "22",
    color,
    marginRight: 8,
  }),
  input: {
    width: "100%",
    padding: "10px 14px",
    background: "#0f1629",
    border: "1px solid #334155",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 14,
    marginBottom: 12,
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "10px 14px",
    background: "#0f1629",
    border: "1px solid #334155",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 14,
    marginBottom: 12,
    minHeight: 80,
    resize: "vertical",
    boxSizing: "border-box",
  },
  select: {
    padding: "10px 14px",
    background: "#0f1629",
    border: "1px solid #334155",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 14,
    marginBottom: 12,
  },
  primaryBtn: {
    padding: "12px 24px",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
  },
  secondaryBtn: {
    padding: "8px 16px",
    background: "#334155",
    color: "#e2e8f0",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
  },
  outcomeBar: (pct, isWinner) => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    marginBottom: 8,
    borderRadius: 8,
    background: `linear-gradient(90deg, ${isWinner ? "#22c55e33" : "#6366f133"} ${pct}%, #1e293b ${pct}%)`,
    border: isWinner ? "1px solid #22c55e" : "1px solid #334155",
    cursor: "pointer",
  }),
  filters: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  filterBtn: (active) => ({
    padding: "6px 14px",
    background: active ? "#6366f1" : "#1e293b",
    color: active ? "#fff" : "#94a3b8",
    border: "1px solid #334155",
    borderRadius: 20,
    cursor: "pointer",
    fontSize: 13,
  }),
  statsRow: {
    display: "flex",
    gap: 16,
    marginBottom: 24,
    flexWrap: "wrap",
  },
  statCard: {
    flex: 1,
    minWidth: 140,
    background: "#1e293b",
    borderRadius: 12,
    padding: "16px 20px",
    border: "1px solid #334155",
    textAlign: "center",
  },
  statValue: { fontSize: 24, fontWeight: 700, color: "#818cf8" },
  statLabel: { fontSize: 12, color: "#94a3b8", marginTop: 4 },
  backBtn: {
    background: "none",
    border: "none",
    color: "#818cf8",
    cursor: "pointer",
    fontSize: 14,
    marginBottom: 16,
    padding: 0,
  },
};

// ══════════════════════════════════════════════════════════════
// ГЛАВНЫЙ КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════

export default function App() {
  const mob = useIsMobile();
  const [page, setPage] = useState("markets"); // markets | market | create | portfolio
  const [account, setAccount] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [userBets, setUserBets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("все");
  const [categoryFilter, setCategoryFilter] = useState("все");
  const [nearConfig, setNearConfig] = useState(null);
  const [balance, setBalance] = useState("0"); // внутренний баланс (yoctoNEAR)

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
        console.error("Ошибка инициализации:", err);
      }
    }
    init();
  }, []);

  // ── Загрузка данных ─────────────────────────────────────────

  const loadMarkets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "все") params.set("status", statusFilter);
      if (categoryFilter !== "все") params.set("category", categoryFilter);
      const res = await fetch(`/api/markets?${params}`);
      const data = await res.json();
      setMarkets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Ошибка загрузки рынков:", err);
    }
  }, [statusFilter, categoryFilter]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      setStats(await res.json());
    } catch (err) {
      console.error("Ошибка загрузки статистики:", err);
    }
  }, []);

  const loadBalance = useCallback(async () => {
    if (!account) return;
    try {
      const res = await fetch(`/api/balance/${account.accountId}`);
      const data = await res.json();
      setBalance(data.balance || "0");
    } catch (err) {
      console.error("Ошибка загрузки баланса:", err);
    }
  }, [account]);

  const loadUserBets = useCallback(async () => {
    if (!account) return;
    try {
      const res = await fetch(`/api/user/${account.accountId}/bets`);
      const data = await res.json();
      setUserBets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Ошибка загрузки ставок:", err);
    }
  }, [account]);

  useEffect(() => {
    loadMarkets();
    loadStats();
  }, [loadMarkets, loadStats]);

  useEffect(() => {
    if (account) {
      loadUserBets();
      loadBalance();
    }
  }, [account, loadUserBets, loadBalance]);

  // ── Навигация ───────────────────────────────────────────────

  const openMarket = async (id) => {
    try {
      const res = await fetch(`/api/markets/${id}`);
      setSelectedMarket(await res.json());
      setPage("market");
    } catch (err) {
      console.error("Ошибка загрузки рынка:", err);
    }
  };

  // ── Рендер ──────────────────────────────────────────────────

  return (
    <div style={styles.body}>
      {/* Шапка */}
      <header style={{
        ...styles.header,
        ...(mob ? { flexDirection: "column", gap: 12, padding: "12px 16px" } : {}),
      }}>
        <div style={styles.logo}>◈ NearCast</div>
        <nav style={{
          ...styles.nav,
          ...(mob ? { flexWrap: "wrap", justifyContent: "center", gap: 8 } : {}),
        }}>
          <button
            style={styles.navBtn(page === "markets")}
            onClick={() => setPage("markets")}
          >
            Рынки
          </button>
          <button
            style={styles.navBtn(page === "create")}
            onClick={() => setPage("create")}
          >
            + Создать
          </button>
          <button
            style={styles.navBtn(page === "portfolio")}
            onClick={() => setPage("portfolio")}
          >
            Портфель
          </button>
          {account ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ color: "#818cf8", fontWeight: 600, fontSize: 13 }}>
                {formatNear(balance)} NEAR
              </span>
              <button style={{ ...styles.walletBtn, fontSize: 12, padding: "6px 12px" }} onClick={signOut}>
                {account.accountId.slice(0, mob ? 10 : 16)}...
              </button>
            </div>
          ) : (
            <button style={styles.walletBtn} onClick={showModal}>
              Подключить
            </button>
          )}
        </nav>
      </header>

      <div style={styles.container}>
        {/* Панель баланса */}
        {account && (
          <BalancePanel balance={balance} onUpdate={loadBalance} mob={mob} />
        )}

        {page === "markets" && (
          <MarketBrowser
            markets={markets}
            stats={stats}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            onOpen={openMarket}
            mob={mob}
          />
        )}
        {page === "market" && selectedMarket && (
          <MarketDetail
            market={selectedMarket}
            account={account}
            balance={balance}
            onBack={() => { setPage("markets"); loadMarkets(); }}
            onRefresh={() => { openMarket(selectedMarket.id); loadBalance(); }}
            mob={mob}
          />
        )}
        {page === "create" && (
          <CreateMarket
            account={account}
            onCreated={() => { setPage("markets"); loadMarkets(); }}
            mob={mob}
          />
        )}
        {page === "portfolio" && (
          <Portfolio
            account={account}
            userBets={userBets}
            markets={markets}
            balance={balance}
            onRefresh={() => { loadUserBets(); loadMarkets(); loadBalance(); }}
            onOpenMarket={openMarket}
            mob={mob}
          />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ПАНЕЛЬ БАЛАНСА
// ══════════════════════════════════════════════════════════════

function BalancePanel({ balance, onUpdate, mob }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(null); // null | "deposit" | "withdraw"
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleAction = async () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return setMessage("Введите корректную сумму");

    setLoading(true);
    setMessage("");
    try {
      if (mode === "deposit") {
        await walletDeposit(val);
        setMessage("Депозит выполнен!");
      } else {
        await walletWithdraw(val);
        setMessage("Вывод выполнен!");
      }
      setAmount("");
      setMode(null);
      onUpdate();
    } catch (err) {
      setMessage("Ошибка: " + err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{
      ...styles.card, cursor: "default", marginBottom: 24,
      background: "linear-gradient(135deg, #1e293b 0%, #0f1629 100%)",
      border: "1px solid #6366f133",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        ...(mob ? { flexDirection: "column", gap: 12, alignItems: "stretch" } : {}),
      }}>
        <div style={mob ? { textAlign: "center" } : {}}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>Баланс на платформе</div>
          <div style={{ fontSize: mob ? 24 : 28, fontWeight: 700, color: "#818cf8" }}>
            {formatNear(balance)} <span style={{ fontSize: 16, fontWeight: 400, color: "#94a3b8" }}>NEAR</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: mob ? "center" : "flex-end" }}>
          <button
            style={{ ...styles.primaryBtn, fontSize: 13, padding: "8px 16px" }}
            onClick={() => setMode(mode === "deposit" ? null : "deposit")}
          >
            Пополнить
          </button>
          <button
            style={{ ...styles.secondaryBtn, fontSize: 13 }}
            onClick={() => setMode(mode === "withdraw" ? null : "withdraw")}
          >
            Вывести
          </button>
        </div>
      </div>

      {mode && (
        <div style={{
          marginTop: 16, display: "flex", gap: 12, alignItems: "center",
          ...(mob ? { flexDirection: "column", alignItems: "stretch" } : {}),
        }}>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Сумма NEAR для ${mode === "deposit" ? "пополнения" : "вывода"}`}
            min="0.01"
            step="0.1"
            style={{ ...styles.input, width: mob ? "100%" : 260, marginBottom: 0 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={{
                ...styles.primaryBtn, fontSize: 13, padding: "10px 20px", flex: 1,
                background: mode === "deposit" ? "#6366f1" : "#f59e0b",
                opacity: loading ? 0.5 : 1,
              }}
              onClick={handleAction}
              disabled={loading}
            >
              {loading ? "..." : mode === "deposit" ? "Пополнить" : "Вывести"}
            </button>
            <button
              style={{ ...styles.secondaryBtn, fontSize: 13 }}
              onClick={() => { setMode(null); setMessage(""); }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {message && (
        <div style={{
          marginTop: 12, padding: "8px 14px", borderRadius: 8,
          background: message.includes("Ошибка") ? "#ef444422" : "#22c55e22",
          color: message.includes("Ошибка") ? "#ef4444" : "#22c55e",
          fontSize: 14,
        }}>
          {message}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// СПИСОК РЫНКОВ
// ══════════════════════════════════════════════════════════════

function MarketBrowser({
  markets,
  stats,
  statusFilter,
  setStatusFilter,
  categoryFilter,
  setCategoryFilter,
  onOpen,
  mob,
}) {
  return (
    <>
      {/* Статистика */}
      {stats && (
        <div style={styles.statsRow}>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{stats.totalMarkets || 0}</div>
            <div style={styles.statLabel}>Рынков</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{formatNear(stats.totalVolume)}</div>
            <div style={styles.statLabel}>Объём (NEAR)</div>
          </div>
        </div>
      )}

      {/* Фильтры по статусу */}
      <div style={styles.filters}>
        {["все", "active", "closed", "resolved"].map((s) => (
          <button
            key={s}
            style={styles.filterBtn(statusFilter === s)}
            onClick={() => setStatusFilter(s)}
          >
            {s === "все" ? "Все" : STATUS_LABELS[s]}
          </button>
        ))}
        {/* Только спорт — фильтр категории не нужен */}
      </div>

      {/* Список рынков */}
      {markets.length === 0 && (
        <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
          Рынков пока нет. Создайте первый!
        </div>
      )}
      {markets.map((m) => (
        <div
          key={m.id}
          style={styles.card}
          onClick={() => onOpen(m.id)}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#334155")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={styles.badge(STATUS_COLORS[m.status] || "#94a3b8")}>
              {STATUS_LABELS[m.status] || m.status}
            </span>
            <span style={styles.badge("#94a3b8")}>{m.category}</span>
          </div>
          <div style={styles.cardTitle}>{m.question}</div>
          <div style={{ display: "flex", gap: mob ? 8 : 20, color: "#94a3b8", fontSize: mob ? 12 : 13, flexWrap: "wrap" }}>
            <span>Пул: {formatNear(m.totalPool)} NEAR</span>
            <span>Ставок: {m.totalBets}</span>
            {!mob && <span>Исходов: {m.outcomes.length}</span>}
            <span>До: {formatDate(m.betsEndDate)}</span>
          </div>
        </div>
      ))}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// ДЕТАЛИ РЫНКА
// ══════════════════════════════════════════════════════════════

function MarketDetail({ market, account, balance, onBack, onRefresh, mob }) {
  const [betAmount, setBetAmount] = useState("1");
  const [selectedOutcome, setSelectedOutcome] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const totalPool = BigInt(market.totalPool || "0");

  const handleBet = async () => {
    if (!account) return showModal();
    if (selectedOutcome === null) return setMessage("Выберите исход");

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount < 0.1) return setMessage("Минимум 0.1 NEAR");

    setLoading(true);
    setMessage("");
    try {
      await placeBet(market.id, selectedOutcome, amount);
      setMessage("Ставка принята!");
      onRefresh();
    } catch (err) {
      setMessage("Ошибка: " + err.message);
    }
    setLoading(false);
  };

  const handleClaim = async () => {
    setLoading(true);
    setMessage("");
    try {
      if (market.status === "resolved") {
        await claimWinnings(market.id);
        setMessage("Выигрыш зачислен на баланс!");
      } else if (market.status === "cancelled") {
        await claimRefund(market.id);
        setMessage("Возврат зачислен на баланс!");
      }
      onRefresh();
    } catch (err) {
      setMessage("Ошибка: " + err.message);
    }
    setLoading(false);
  };

  return (
    <>
      <button style={styles.backBtn} onClick={onBack}>
        ← Назад к рынкам
      </button>

      <div style={{ ...styles.card, cursor: "default" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <span style={styles.badge(STATUS_COLORS[market.status])}>
            {STATUS_LABELS[market.status]}
          </span>
          <span style={styles.badge("#94a3b8")}>{market.category}</span>
        </div>

        <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>{market.question}</h2>
        {market.description && (
          <p style={{ color: "#94a3b8", margin: "0 0 16px", fontSize: 14 }}>
            {market.description}
          </p>
        )}

        <div style={{ display: "flex", gap: mob ? 8 : 24, color: "#94a3b8", fontSize: mob ? 12 : 13, marginBottom: 20, flexWrap: "wrap" }}>
          <span>Пул: <b style={{ color: "#818cf8" }}>{formatNear(market.totalPool)} NEAR</b></span>
          <span>Ставок: {market.totalBets}</span>
          <span>До: {formatDate(market.betsEndDate)}</span>
          <span>Резолв: {formatDate(market.resolutionDate)}</span>
        </div>

        {/* Исходы с коэффициентами */}
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Исходы</h3>
        {market.outcomes.map((outcome, i) => {
          const pool = BigInt(market.outcomePools[i] || "0");
          const pct = totalPool > 0n ? Number((pool * 100n) / totalPool) : 0;
          const odds =
            totalPool > 0n && pool > 0n
              ? (Number(totalPool) / Number(pool)).toFixed(2)
              : "—";
          const isWinner = market.resolvedOutcome === i;

          return (
            <div
              key={i}
              style={styles.outcomeBar(pct, isWinner)}
              onClick={() => market.status === "active" && setSelectedOutcome(i)}
            >
              <div>
                <span style={{ fontWeight: selectedOutcome === i ? 700 : 400 }}>
                  {selectedOutcome === i && "● "}
                  {outcome}
                  {isWinner && " ✓"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#94a3b8" }}>
                <span>{pct}%</span>
                <span>{formatNear(market.outcomePools[i])} NEAR</span>
                <span>x{odds}</span>
              </div>
            </div>
          );
        })}

        {/* Форма ставки */}
        {market.status === "active" && (
          <div style={{ marginTop: 20 }}>
            {account && (
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>
                Доступно: <b style={{ color: "#818cf8" }}>{formatNear(balance)} NEAR</b>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: mob ? "wrap" : "nowrap" }}>
              <input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                placeholder="Сумма NEAR"
                min="0.1"
                step="0.1"
                style={{ ...styles.input, width: mob ? "100%" : 140, marginBottom: 0 }}
              />
              <button
                style={{ ...styles.primaryBtn, opacity: loading ? 0.5 : 1, ...(mob ? { width: "100%" } : {}) }}
                onClick={handleBet}
                disabled={loading}
              >
                {loading ? "..." : "Поставить"}
              </button>
            </div>
          </div>
        )}

        {/* Кнопка клейма */}
        {(market.status === "resolved" || market.status === "cancelled") && account && (
          <div style={{ marginTop: 20 }}>
            <button
              style={{ ...styles.primaryBtn, background: "#22c55e", opacity: loading ? 0.5 : 1 }}
              onClick={handleClaim}
              disabled={loading}
            >
              {market.status === "resolved" ? "Забрать выигрыш" : "Забрать возврат"}
            </button>
          </div>
        )}

        {message && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 14px",
              borderRadius: 8,
              background: message.includes("Ошибка") ? "#ef444422" : "#22c55e22",
              color: message.includes("Ошибка") ? "#ef4444" : "#22c55e",
              fontSize: 14,
            }}
          >
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

function CreateMarket({ account, onCreated, mob }) {
  // Шаги: league → matches → market → confirm
  const [step, setStep] = useState("league");
  const [sportsConfig, setSportsConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Шаг 1: выбор лиги
  const [sport, setSport] = useState("");
  const [country, setCountry] = useState("");
  const [league, setLeague] = useState("");

  // Шаг 2: матчи от AI
  const [matches, setMatches] = useState([]);
  const [matchesNote, setMatchesNote] = useState("");
  const [selectedMatch, setSelectedMatch] = useState(null);

  // Шаг 3: тип рынка
  const [marketType, setMarketType] = useState("winner");

  // Шаг 4: сгенерированный рынок
  const [aiResult, setAiResult] = useState(null);

  useEffect(() => {
    fetch("/api/sports-config")
      .then((r) => r.json())
      .then(setSportsConfig)
      .catch((e) => console.error("Ошибка загрузки конфигурации:", e));
  }, []);

  const countries = sport && sportsConfig?.sports?.[sport]?.countries
    ? Object.entries(sportsConfig.sports[sport].countries)
    : [];
  const leagues = sport && country && sportsConfig?.sports?.[sport]?.countries?.[country]?.leagues
    ? Object.entries(sportsConfig.sports[sport].countries[country].leagues)
    : [];

  const handleSportChange = (val) => { setSport(val); setCountry(""); setLeague(""); };
  const handleCountryChange = (val) => { setCountry(val); setLeague(""); };

  // Шаг 1 → 2: загрузить матчи
  const handleLoadMatches = async () => {
    if (!sport || !country || !league) return setMessage("Выберите лигу");
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/upcoming-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport, country, league }),
      });
      const data = await res.json();
      if (data.error) { setMessage(data.error); return; }
      setMatches(data.matches || []);
      setMatchesNote(data.note || "");
      setSelectedMatch(null);
      setStep("matches");
    } catch (err) {
      setMessage("Ошибка: " + err.message);
    }
    setLoading(false);
  };

  // Шаг 3 → 4: сгенерировать рынок
  const handleGenerate = async () => {
    if (!selectedMatch) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/generate-market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sport, country, league,
          teamA: selectedMatch.teamA,
          teamB: selectedMatch.teamB,
          matchDate: selectedMatch.date,
          marketType,
        }),
      });
      const data = await res.json();
      if (data.error) { setMessage(data.error); return; }
      setAiResult(data);
      setStep("confirm");
    } catch (err) {
      setMessage("Ошибка: " + err.message);
    }
    setLoading(false);
  };

  // Шаг 4: создать на контракте
  const handleCreate = async () => {
    if (!account) return showModal();
    if (!aiResult) return;
    setLoading(true);
    setMessage("");
    try {
      const betsEnd = new Date(aiResult.betsEndDate).getTime();
      const resolution = new Date(aiResult.resolutionDate).getTime();
      await createMarket({
        question: aiResult.question,
        description: aiResult.description || "",
        outcomes: aiResult.outcomes,
        category: "спорт",
        betsEndDate: msToNano(betsEnd),
        resolutionDate: msToNano(resolution),
      });
      setMessage("Рынок создан!");
      setTimeout(onCreated, 1500);
    } catch (err) {
      setMessage("Ошибка: " + err.message);
    }
    setLoading(false);
  };

  if (!sportsConfig) {
    return <div style={{ color: "#64748b", padding: 40, textAlign: "center" }}>Загрузка...</div>;
  }

  const sportsList = Object.entries(sportsConfig.sports);
  const marketTypes = Object.entries(sportsConfig.marketTypes);
  const stepNames = ["Лига", "Матч", "Тип рынка", "Подтверждение"];
  const stepKeys = ["league", "matches", "market", "confirm"];
  const stepNum = stepKeys.indexOf(step) + 1;

  const formatMatchDate = (iso) => {
    try { return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  };

  return (
    <>
      <h2 style={{ fontSize: 22, marginBottom: 20 }}>Создать рынок</h2>

      {/* Индикатор шагов */}
      <div style={{ display: "flex", gap: mob ? 4 : 8, marginBottom: 24, alignItems: "center", justifyContent: mob ? "center" : "flex-start" }}>
        {stepNames.map((label, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div style={{ width: mob ? 16 : 32, height: 2, background: i < stepNum ? "#6366f1" : "#334155" }} />}
            <div style={{ display: "flex", alignItems: "center", gap: 4, color: i < stepNum ? "#818cf8" : "#64748b" }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 600,
                background: i < stepNum ? "#6366f1" : "#1e293b",
                color: i < stepNum ? "#fff" : "#64748b",
                border: `2px solid ${i < stepNum ? "#6366f1" : "#334155"}`,
              }}>
                {i + 1}
              </div>
              {!mob && <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* ── ШАГ 1: Выбор лиги ── */}
      {step === "league" && (
        <div style={{ ...styles.card, cursor: "default" }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 13, color: "#94a3b8" }}>Спорт *</label>
              <select style={{ ...styles.select, width: "100%" }} value={sport} onChange={(e) => handleSportChange(e.target.value)}>
                <option value="">— Выберите —</option>
                {sportsList.map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 13, color: "#94a3b8" }}>Страна / Регион *</label>
              <select style={{ ...styles.select, width: "100%" }} value={country} onChange={(e) => handleCountryChange(e.target.value)} disabled={!sport}>
                <option value="">— Выберите —</option>
                {countries.map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 13, color: "#94a3b8" }}>Лига / Турнир *</label>
              <select style={{ ...styles.select, width: "100%" }} value={league} onChange={(e) => setLeague(e.target.value)} disabled={!country}>
                <option value="">— Выберите —</option>
                {leagues.map(([key, val]) => (
                  <option key={key} value={key}>{val}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            style={{ ...styles.primaryBtn, marginTop: 16, opacity: loading ? 0.5 : 1 }}
            onClick={handleLoadMatches}
            disabled={loading}
          >
            {loading ? "AI ищет матчи..." : "Показать ближайшие матчи"}
          </button>

          {message && (
            <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: "#ef444422", color: "#ef4444", fontSize: 14 }}>
              {message}
            </div>
          )}
        </div>
      )}

      {/* ── ШАГ 2: Выбор матча ── */}
      {step === "matches" && (
        <div style={{ ...styles.card, cursor: "default" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, margin: 0 }}>Ближайшие матчи</h3>
            <button style={styles.secondaryBtn} onClick={() => { setStep("league"); setMessage(""); }}>
              Назад
            </button>
          </div>

          {matchesNote && (
            <div style={{ padding: "8px 14px", borderRadius: 8, marginBottom: 16, background: "#f59e0b11", border: "1px solid #f59e0b33", color: "#f59e0b", fontSize: 13 }}>
              {matchesNote}
            </div>
          )}

          {matches.length === 0 ? (
            <div style={{ textAlign: "center", color: "#64748b", padding: 30 }}>Матчей не найдено</div>
          ) : (
            matches.map((m, i) => {
              const isSelected = selectedMatch === m;
              return (
                <div
                  key={i}
                  onClick={() => setSelectedMatch(m)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: mob ? "flex-start" : "center",
                    flexDirection: mob ? "column" : "row", gap: mob ? 4 : 0,
                    padding: "12px 16px", marginBottom: 8, borderRadius: 10,
                    background: isSelected ? "#6366f122" : "#0f1629",
                    border: `1px solid ${isSelected ? "#6366f1" : "#334155"}`,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: mob ? 14 : 15 }}>
                      {isSelected && <span style={{ color: "#6366f1" }}>● </span>}
                      {m.teamA} — {m.teamB}
                    </div>
                    {m.round && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{m.round}</div>}
                  </div>
                  <div style={{ fontSize: mob ? 12 : 14, color: "#818cf8", fontWeight: 500, whiteSpace: "nowrap" }}>
                    {formatMatchDate(m.date)}
                  </div>
                </div>
              );
            })
          )}

          {selectedMatch && (
            <div style={{ marginTop: 16 }}>
              <button
                style={styles.primaryBtn}
                onClick={() => { setStep("market"); setMessage(""); }}
              >
                Выбрать матч
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ШАГ 3: Выбор типа рынка ── */}
      {step === "market" && selectedMatch && (
        <div style={{ ...styles.card, cursor: "default" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: mob ? 14 : 16, margin: 0 }}>
              {selectedMatch.teamA} — {selectedMatch.teamB}
              {!mob && (
                <span style={{ color: "#818cf8", fontSize: 14, fontWeight: 400, marginLeft: 12 }}>
                  {formatMatchDate(selectedMatch.date)}
                </span>
              )}
              {mob && (
                <div style={{ color: "#818cf8", fontSize: 12, fontWeight: 400, marginTop: 4 }}>
                  {formatMatchDate(selectedMatch.date)}
                </div>
              )}
            </h3>
            <button style={styles.secondaryBtn} onClick={() => { setStep("matches"); setMessage(""); }}>
              Назад
            </button>
          </div>

          <label style={{ fontSize: 13, color: "#94a3b8" }}>Выберите тип рынка:</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, marginBottom: 16 }}>
            {marketTypes.map(([key, label]) => (
              <button
                key={key}
                style={{
                  padding: "10px 18px",
                  background: marketType === key ? "#6366f1" : "#0f1629",
                  color: marketType === key ? "#fff" : "#94a3b8",
                  border: `1px solid ${marketType === key ? "#6366f1" : "#334155"}`,
                  borderRadius: 8, cursor: "pointer", fontSize: 14,
                }}
                onClick={() => setMarketType(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            style={{ ...styles.primaryBtn, opacity: loading ? 0.5 : 1 }}
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? "AI генерирует рынок..." : "Создать рынок"}
          </button>

          {message && (
            <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: "#ef444422", color: "#ef4444", fontSize: 14 }}>
              {message}
            </div>
          )}
        </div>
      )}

      {/* ── ШАГ 4: Подтверждение ── */}
      {step === "confirm" && aiResult && (
        <div style={{ ...styles.card, cursor: "default" }}>
          <h3 style={{ fontSize: 18, margin: "0 0 8px" }}>{aiResult.question}</h3>
          {aiResult.description && (
            <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 16px" }}>{aiResult.description}</p>
          )}

          <label style={{ fontSize: 13, color: "#94a3b8" }}>Варианты исходов:</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, marginTop: 4 }}>
            {aiResult.outcomes.map((o, i) => (
              <div key={i} style={{
                padding: "8px 16px", background: "#6366f122",
                border: "1px solid #6366f155", borderRadius: 8,
                color: "#818cf8", fontSize: 14, fontWeight: 500,
              }}>
                {o}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 24, marginBottom: 16, fontSize: 14, flexWrap: "wrap" }}>
            <div>
              <span style={{ color: "#94a3b8" }}>Ставки до: </span>
              <b>{new Date(aiResult.betsEndDate).toLocaleString("ru-RU")}</b>
            </div>
            <div>
              <span style={{ color: "#94a3b8" }}>Разрешение: </span>
              <b>{new Date(aiResult.resolutionDate).toLocaleString("ru-RU")}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button style={styles.secondaryBtn} onClick={() => { setStep("market"); setAiResult(null); setMessage(""); }}>
              Назад
            </button>
            <button
              style={{ ...styles.primaryBtn, opacity: loading ? 0.5 : 1 }}
              onClick={handleCreate}
              disabled={loading}
            >
              {loading ? "Создание..." : "Подтвердить и создать"}
            </button>
          </div>

          {message && (
            <div style={{
              marginTop: 12, padding: "8px 14px", borderRadius: 8,
              background: message.includes("Ошибка") ? "#ef444422" : "#22c55e22",
              color: message.includes("Ошибка") ? "#ef4444" : "#22c55e",
              fontSize: 14,
            }}>
              {message}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// ПОРТФЕЛЬ
// ══════════════════════════════════════════════════════════════

function Portfolio({ account, userBets, markets, balance, onRefresh, onOpenMarket, mob }) {
  if (!account) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <h2 style={{ color: "#64748b" }}>Подключите кошелёк</h2>
        <button style={styles.walletBtn} onClick={showModal}>
          Подключить NEAR кошелёк
        </button>
      </div>
    );
  }

  // Группируем ставки по рынкам
  const betsByMarket = {};
  for (const bet of userBets) {
    if (!betsByMarket[bet.marketId]) betsByMarket[bet.marketId] = [];
    betsByMarket[bet.marketId].push(bet);
  }

  const marketIds = Object.keys(betsByMarket).map(Number);

  // Считаем общую сумму ставок
  const totalBet = userBets.reduce((sum, b) => sum + BigInt(b.amount), 0n);

  return (
    <>
      <h2 style={{ fontSize: 22, marginBottom: 20 }}>
        Мой портфель
        <button
          style={{ ...styles.secondaryBtn, marginLeft: 12 }}
          onClick={onRefresh}
        >
          Обновить
        </button>
      </h2>

      <div style={{ ...styles.statsRow, ...(mob ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } : {}) }}>
        <div style={{ ...styles.statCard, ...(mob ? { minWidth: 0 } : {}) }}>
          <div style={{ ...styles.statValue, fontSize: mob ? 18 : 24 }}>{formatNear(balance)}</div>
          <div style={styles.statLabel}>Баланс (NEAR)</div>
        </div>
        <div style={{ ...styles.statCard, ...(mob ? { minWidth: 0 } : {}) }}>
          <div style={{ ...styles.statValue, fontSize: mob ? 18 : 24 }}>{userBets.length}</div>
          <div style={styles.statLabel}>Ставок</div>
        </div>
        <div style={{ ...styles.statCard, ...(mob ? { minWidth: 0 } : {}) }}>
          <div style={{ ...styles.statValue, fontSize: mob ? 18 : 24 }}>{marketIds.length}</div>
          <div style={styles.statLabel}>Рынков</div>
        </div>
        <div style={{ ...styles.statCard, ...(mob ? { minWidth: 0 } : {}) }}>
          <div style={{ ...styles.statValue, fontSize: mob ? 18 : 24 }}>{formatNear(totalBet.toString())}</div>
          <div style={styles.statLabel}>Поставлено (NEAR)</div>
        </div>
      </div>

      {marketIds.length === 0 && (
        <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
          У вас пока нет ставок
        </div>
      )}

      {marketIds.map((mid) => {
        const bets = betsByMarket[mid];
        const market = markets.find((m) => m.id === mid);
        const marketQuestion = market?.question || `Рынок #${mid}`;
        const marketStatus = market?.status || "?";

        return (
          <div
            key={mid}
            style={styles.card}
            onClick={() => onOpenMarket(mid)}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#334155")}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={styles.badge(STATUS_COLORS[marketStatus] || "#94a3b8")}>
                {STATUS_LABELS[marketStatus] || marketStatus}
              </span>
            </div>
            <div style={styles.cardTitle}>{marketQuestion}</div>
            {bets.map((bet, i) => (
              <div
                key={i}
                style={{
                  fontSize: mob ? 12 : 13,
                  color: "#94a3b8",
                  display: "flex",
                  gap: mob ? 6 : 12,
                  marginTop: 4,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  Исход: <b style={{ color: "#e2e8f0" }}>{market?.outcomes?.[bet.outcome] || `#${bet.outcome}`}</b>
                </span>
                <span>{formatNear(bet.amount)} NEAR</span>
                <span>{bet.claimed ? "✓ Получено" : "Ожидание"}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
