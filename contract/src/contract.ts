import {
  NearBindgen,
  near,
  call,
  view,
  initialize,
  UnorderedMap,
  LookupMap,
  NearPromise,
  assert,
} from "near-sdk-js";

// ── Константы ────────────────────────────────────────────────

const ONE_NEAR = BigInt("1000000000000000000000000");
const MIN_BET = ONE_NEAR / BigInt(10); // 0.1 NEAR
const MAX_OUTCOMES = 10;
const MIN_OUTCOMES = 2;

// ── Модели данных ────────────────────────────────────────────

class Market {
  id: number;
  creator: string;
  question: string;
  description: string;
  outcomes: string[];
  outcomePools: string[]; // yoctoNEAR как строки
  totalPool: string;
  category: string;
  createdAt: string;
  betsEndDate: string; // timestamp (наносекунды) — дедлайн ставок
  resolutionDate: string; // timestamp (наносекунды) — когда оракул может разрешить
  resolvedOutcome: number; // -1 = не разрешён, -2 = void (матч отменён)
  status: string; // "active" | "closed" | "resolved" | "voided"
  totalBets: number;
  // ESPN метаданные для permissionless OutLayer resolution
  espnEventId: string; // ESPN event ID (напр. "401547417")
  sport: string; // ESPN sport path (напр. "soccer")
  league: string; // ESPN league path (напр. "eng.1")
  marketType: string; // "winner" | "over-under" | "both-score"

  constructor(fields: Partial<Market> = {}) {
    this.id = fields.id || 0;
    this.creator = fields.creator || "";
    this.question = fields.question || "";
    this.description = fields.description || "";
    this.outcomes = fields.outcomes || [];
    this.outcomePools = fields.outcomePools || [];
    this.totalPool = fields.totalPool || "0";
    this.category = fields.category || "другое";
    this.createdAt = fields.createdAt || "0";
    this.betsEndDate = fields.betsEndDate || "0";
    this.resolutionDate = fields.resolutionDate || "0";
    this.resolvedOutcome = fields.resolvedOutcome ?? -1;
    this.status = fields.status || "active";
    this.totalBets = fields.totalBets || 0;
    this.espnEventId = fields.espnEventId || "";
    this.sport = fields.sport || "";
    this.league = fields.league || "";
    this.marketType = fields.marketType || "winner";
  }
}

class Bet {
  marketId: number;
  user: string;
  outcome: number;
  amount: string; // yoctoNEAR
  timestamp: string;
  claimed: boolean;

  constructor(fields: Partial<Bet> = {}) {
    this.marketId = fields.marketId || 0;
    this.user = fields.user || "";
    this.outcome = fields.outcome || 0;
    this.amount = fields.amount || "0";
    this.timestamp = fields.timestamp || "0";
    this.claimed = fields.claimed || false;
  }
}

// ── Контракт ─────────────────────────────────────────────────

@NearBindgen({})
class NearCast {
  owner: string = "";
  oracle: string = "";
  markets: UnorderedMap<string> = new UnorderedMap<string>("m");
  marketBets: UnorderedMap<string> = new UnorderedMap<string>("b"); // marketId -> Bet[]
  userBets: LookupMap<string> = new LookupMap<string>("u"); // accountId -> Bet[]
  balances: LookupMap<string> = new LookupMap<string>("bal"); // accountId -> yoctoNEAR
  marketCount: number = 0;
  totalVolume: string = "0";

  @initialize({})
  init({ oracle }: { oracle?: string }): void {
    this.owner = near.predecessorAccountId();
    this.oracle = oracle || near.predecessorAccountId();
    this.marketCount = 0;
  }

  // ══════════════════════════════════════════════════════════
  // ВНУТРЕННИЙ БАЛАНС — deposit / withdraw
  // ══════════════════════════════════════════════════════════

  // Пополнение внутреннего баланса (единственный payable метод для юзеров)
  @call({ payableFunction: true })
  deposit(): void {
    const sender = near.predecessorAccountId();
    const amount = near.attachedDeposit();
    assert(amount > BigInt(0), "Прикрепите NEAR для пополнения");

    const current = BigInt(this.balances.get(sender) || "0");
    this.balances.set(sender, (current + amount).toString());

    near.log(`Депозит: ${sender} пополнил баланс на ${amount} yoctoNEAR`);
  }

  // Вывод средств с внутреннего баланса на кошелёк
  @call({})
  withdraw({ amount }: { amount: string }): NearPromise {
    const sender = near.predecessorAccountId();
    const withdrawAmount = BigInt(amount);
    assert(withdrawAmount > BigInt(0), "Сумма должна быть положительной");

    const current = BigInt(this.balances.get(sender) || "0");
    assert(current >= withdrawAmount, "Недостаточно средств на балансе");

    this.balances.set(sender, (current - withdrawAmount).toString());

    near.log(`Вывод: ${sender} выводит ${withdrawAmount} yoctoNEAR`);
    return NearPromise.new(sender).transfer(withdrawAmount);
  }

  // ══════════════════════════════════════════════════════════
  // СОЗДАНИЕ РЫНКА
  // ══════════════════════════════════════════════════════════

  @call({})
  create_market({
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
  }: {
    question: string;
    description: string;
    outcomes: string[];
    category: string;
    betsEndDate: string; // timestamp в наносекундах
    resolutionDate: string; // timestamp в наносекундах
    espnEventId?: string; // ESPN event ID для OutLayer resolution
    sport?: string; // ESPN sport path
    league?: string; // ESPN league path
    marketType?: string; // тип рынка
  }): number {
    const sender = near.predecessorAccountId();
    const now = near.blockTimestamp();

    // Валидация
    assert(
      question.length > 0 && question.length <= 500,
      "Вопрос должен быть от 1 до 500 символов"
    );
    assert(
      description.length <= 2000,
      "Описание не может превышать 2000 символов"
    );
    assert(
      outcomes.length >= MIN_OUTCOMES && outcomes.length <= MAX_OUTCOMES,
      `Количество исходов: от ${MIN_OUTCOMES} до ${MAX_OUTCOMES}`
    );
    assert(
      BigInt(betsEndDate) > now,
      "Дедлайн ставок должен быть в будущем"
    );
    assert(
      BigInt(resolutionDate) > BigInt(betsEndDate),
      "Дата разрешения должна быть после дедлайна ставок"
    );

    // Проверяем уникальность исходов
    const uniqueOutcomes = new Set(outcomes);
    assert(
      uniqueOutcomes.size === outcomes.length,
      "Исходы должны быть уникальными"
    );

    // Проверяем что исходы не пустые
    for (const o of outcomes) {
      assert(
        o.length > 0 && o.length <= 200,
        "Каждый исход: от 1 до 200 символов"
      );
    }

    const id = this.marketCount;
    this.marketCount += 1;

    // Инициализируем пулы нулями
    const outcomePools = outcomes.map(() => "0");

    const market = new Market({
      id,
      creator: sender,
      question,
      description,
      outcomes,
      outcomePools,
      totalPool: "0",
      category: category || "другое",
      createdAt: now.toString(),
      betsEndDate,
      resolutionDate,
      resolvedOutcome: -1,
      status: "active",
      totalBets: 0,
      espnEventId: espnEventId || "",
      sport: sport || "",
      league: league || "",
      marketType: marketType || "winner",
    });

    this.markets.set(id.toString(), JSON.stringify(market));
    this.marketBets.set(id.toString(), JSON.stringify([]));

    near.log(`Рынок создан: #${id} — "${question}" (${outcomes.length} исходов)`);
    return id;
  }

  // ══════════════════════════════════════════════════════════
  // СТАВКИ (списание с внутреннего баланса)
  // ══════════════════════════════════════════════════════════

  @call({})
  place_bet({
    market_id,
    outcome,
    amount,
  }: {
    market_id: number;
    outcome: number;
    amount: string; // yoctoNEAR
  }): void {
    const betAmount = BigInt(amount);
    const sender = near.predecessorAccountId();
    const now = near.blockTimestamp();

    assert(betAmount >= MIN_BET, "Минимальная ставка: 0.1 NEAR");

    // Проверяем и списываем с внутреннего баланса
    const balance = BigInt(this.balances.get(sender) || "0");
    assert(balance >= betAmount, "Недостаточно средств на балансе. Пополните депозит.");
    this.balances.set(sender, (balance - betAmount).toString());

    // Загружаем рынок
    const marketJson = this.markets.get(market_id.toString());
    assert(marketJson !== null, "Рынок не найден");
    const market: Market = JSON.parse(marketJson!);

    // Проверки
    assert(market.status === "active", "Рынок не принимает ставки");
    assert(
      now < BigInt(market.betsEndDate),
      "Время ставок истекло"
    );
    assert(
      outcome >= 0 && outcome < market.outcomes.length,
      "Недопустимый исход"
    );

    // Обновляем пулы
    const currentPool = BigInt(market.outcomePools[outcome]);
    market.outcomePools[outcome] = (currentPool + betAmount).toString();
    market.totalPool = (BigInt(market.totalPool) + betAmount).toString();
    market.totalBets += 1;

    this.markets.set(market_id.toString(), JSON.stringify(market));

    // Создаём ставку
    const bet = new Bet({
      marketId: market_id,
      user: sender,
      outcome,
      amount: betAmount.toString(),
      timestamp: now.toString(),
      claimed: false,
    });

    // Добавляем в ставки рынка
    const betsJson = this.marketBets.get(market_id.toString()) || "[]";
    const bets: Bet[] = JSON.parse(betsJson);
    bets.push(bet);
    this.marketBets.set(market_id.toString(), JSON.stringify(bets));

    // Добавляем в ставки пользователя
    const userBetsJson = this.userBets.get(sender) || "[]";
    const userBets: Bet[] = JSON.parse(userBetsJson);
    userBets.push(bet);
    this.userBets.set(sender, JSON.stringify(userBets));

    // Обновляем общий объём
    this.totalVolume = (BigInt(this.totalVolume) + betAmount).toString();

    near.log(
      `Ставка: ${sender} поставил ${betAmount} на исход #${outcome} ("${market.outcomes[outcome]}") рынка #${market_id}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // РАЗРЕШЕНИЕ РЫНКА (только оракул)
  // ══════════════════════════════════════════════════════════

  @call({})
  resolve_market({
    market_id,
    winning_outcome,
    reasoning,
  }: {
    market_id: number;
    winning_outcome: number;
    reasoning?: string;
  }): void {
    const sender = near.predecessorAccountId();
    assert(
      sender === this.oracle || sender === this.owner,
      "Только оракул или владелец может разрешать рынки"
    );

    const marketJson = this.markets.get(market_id.toString());
    assert(marketJson !== null, "Рынок не найден");
    const market: Market = JSON.parse(marketJson!);

    assert(
      market.status === "active" || market.status === "closed",
      "Рынок уже разрешён или аннулирован"
    );
    assert(
      winning_outcome >= 0 && winning_outcome < market.outcomes.length,
      "Недопустимый исход"
    );

    // Проверяем что время разрешения наступило
    const now = near.blockTimestamp();
    assert(
      now >= BigInt(market.resolutionDate),
      "Время разрешения ещё не наступило"
    );

    market.resolvedOutcome = winning_outcome;
    market.status = "resolved";

    this.markets.set(market_id.toString(), JSON.stringify(market));

    near.log(
      `Рынок #${market_id} разрешён: победил исход #${winning_outcome} ("${market.outcomes[winning_outcome]}")${reasoning ? ` — ${reasoning}` : ""}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // VOID — аннулирование рынка (матч отменён/перенесён)
  // Все ставки возвращаются. Только оракул/владелец.
  // ══════════════════════════════════════════════════════════

  @call({})
  void_market({
    market_id,
    reasoning,
  }: {
    market_id: number;
    reasoning?: string;
  }): void {
    const sender = near.predecessorAccountId();
    assert(
      sender === this.oracle || sender === this.owner,
      "Только оракул или владелец может аннулировать рынки"
    );

    const marketJson = this.markets.get(market_id.toString());
    assert(marketJson !== null, "Рынок не найден");
    const market: Market = JSON.parse(marketJson!);

    assert(
      market.status === "active" || market.status === "closed",
      "Рынок уже разрешён или аннулирован"
    );

    market.resolvedOutcome = -2;
    market.status = "voided";

    this.markets.set(market_id.toString(), JSON.stringify(market));

    near.log(
      `Рынок #${market_id} аннулирован (void)${reasoning ? ` — ${reasoning}` : ""}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // ESPN ORACLE — разрешение через верифицированные данные ESPN
  // Вызывается ботом-релеером после проверки через OutLayer TEE
  // ══════════════════════════════════════════════════════════

  @call({})
  submit_resolution({
    market_id,
    winning_outcome,
    confidence,
    reasoning,
    home_score,
    away_score,
    event_status,
  }: {
    market_id: number;
    winning_outcome: number;
    confidence: number;
    reasoning?: string;
    home_score: number;
    away_score: number;
    event_status: string;
  }): void {
    const sender = near.predecessorAccountId();
    assert(
      sender === this.oracle || sender === this.owner,
      "Только оракул или владелец может отправлять результаты ESPN"
    );

    const marketJson = this.markets.get(market_id.toString());
    assert(marketJson !== null, "Рынок не найден");
    const market: Market = JSON.parse(marketJson!);

    assert(
      market.espnEventId.length > 0,
      "Рынок не является спортивным (нет espnEventId)"
    );
    assert(
      market.status === "active" || market.status === "closed",
      "Рынок уже разрешён или аннулирован"
    );

    const now = near.blockTimestamp();
    assert(
      now >= BigInt(market.resolutionDate),
      "Время разрешения ещё не наступило"
    );
    assert(
      event_status === "final",
      "Событие ещё не завершено"
    );

    // Void если нет результата или низкая уверенность
    if (winning_outcome === -1 || confidence < 0.3) {
      market.resolvedOutcome = -2;
      market.status = "voided";
      this.markets.set(market_id.toString(), JSON.stringify(market));
      near.log(
        `Рынок #${market_id} аннулирован через ESPN Oracle: ${reasoning || "нет данных"}`
      );
      return;
    }

    assert(
      winning_outcome >= 0 && winning_outcome < market.outcomes.length,
      "Недопустимый исход"
    );

    market.resolvedOutcome = winning_outcome;
    market.status = "resolved";
    this.markets.set(market_id.toString(), JSON.stringify(market));

    near.log(
      `Рынок #${market_id} разрешён через ESPN Oracle: исход #${winning_outcome} ("${market.outcomes[winning_outcome]}") | Счёт: ${home_score}:${away_score}${reasoning ? ` — ${reasoning}` : ""}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // ПОЛУЧЕНИЕ ВЫИГРЫША / ВОЗВРАТ (зачисление на внутренний баланс)
  // Работает для resolved (выигрыш) и voided (возврат) рынков
  // ══════════════════════════════════════════════════════════

  @call({})
  claim_winnings({ market_id }: { market_id: number }): void {
    const sender = near.predecessorAccountId();

    const marketJson = this.markets.get(market_id.toString());
    assert(marketJson !== null, "Рынок не найден");
    const market: Market = JSON.parse(marketJson!);

    assert(
      market.status === "resolved" || market.status === "voided",
      "Рынок ещё не разрешён и не аннулирован"
    );

    const betsJson = this.marketBets.get(market_id.toString()) || "[]";
    const allBets: Bet[] = JSON.parse(betsJson);

    let payout = BigInt(0);
    let hasClaimed = false;
    const userBetIndices: number[] = [];

    if (market.status === "voided") {
      // Void — возвращаем все ставки пользователя
      for (let i = 0; i < allBets.length; i++) {
        const bet = allBets[i];
        if (bet.user === sender) {
          if (bet.claimed) { hasClaimed = true; break; }
          payout += BigInt(bet.amount);
          userBetIndices.push(i);
        }
      }
    } else {
      // Resolved — выигрыш только для правильного исхода
      for (let i = 0; i < allBets.length; i++) {
        const bet = allBets[i];
        if (bet.user === sender && bet.outcome === market.resolvedOutcome) {
          if (bet.claimed) { hasClaimed = true; break; }
          payout += BigInt(bet.amount);
          userBetIndices.push(i);
        }
      }

      // Пересчитываем выигрыш: (ставка / пул победителей) * весь пул
      if (payout > BigInt(0)) {
        const totalPool = BigInt(market.totalPool);
        const winningPool = BigInt(market.outcomePools[market.resolvedOutcome]);
        payout = (payout * totalPool) / winningPool;
      }
    }

    assert(!hasClaimed, "Выигрыш уже получен");
    assert(payout > BigInt(0), "У вас нет ставок для получения на этом рынке");

    // Помечаем ставки как полученные
    for (const idx of userBetIndices) {
      allBets[idx].claimed = true;
    }
    this.marketBets.set(market_id.toString(), JSON.stringify(allBets));

    // Обновляем ставки пользователя
    const userBetsJson = this.userBets.get(sender) || "[]";
    const userBets: Bet[] = JSON.parse(userBetsJson);
    for (const ub of userBets) {
      if (ub.marketId === market_id) {
        if (market.status === "voided" || ub.outcome === market.resolvedOutcome) {
          ub.claimed = true;
        }
      }
    }
    this.userBets.set(sender, JSON.stringify(userBets));

    // Зачисляем на внутренний баланс
    const currentBalance = BigInt(this.balances.get(sender) || "0");
    this.balances.set(sender, (currentBalance + payout).toString());

    const action = market.status === "voided" ? "Возврат" : "Выигрыш";
    near.log(
      `${action}: ${sender} получил ${payout} yoctoNEAR на баланс с рынка #${market_id}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // АДМИНИСТРАТИВНЫЕ МЕТОДЫ
  // ══════════════════════════════════════════════════════════

  @call({})
  set_oracle({ oracle_id }: { oracle_id: string }): void {
    assert(
      near.predecessorAccountId() === this.owner,
      "Только владелец может менять оракула"
    );
    this.oracle = oracle_id;
    near.log(`Оракул установлен: ${oracle_id}`);
  }

  // ══════════════════════════════════════════════════════════
  // VIEW МЕТОДЫ (бесплатные, без подписи)
  // ══════════════════════════════════════════════════════════

  @view({})
  get_balance({ account_id }: { account_id: string }): string {
    return this.balances.get(account_id) || "0";
  }

  @view({})
  get_market({ market_id }: { market_id: number }): Market | null {
    const json = this.markets.get(market_id.toString());
    if (!json) return null;

    const market: Market = JSON.parse(json);

    // Автоматически обновляем статус если время ставок истекло
    const now = near.blockTimestamp();
    if (market.status === "active" && now >= BigInt(market.betsEndDate)) {
      market.status = "closed";
    }

    return market;
  }

  @view({})
  get_markets({
    from_index,
    limit,
    category,
    status,
  }: {
    from_index?: number;
    limit?: number;
    category?: string;
    status?: string;
  }): Market[] {
    const skip = from_index || 0;
    const max = limit || 50;
    const now = near.blockTimestamp();
    const results: Market[] = [];
    let skipped = 0;

    // Итерируем по ID в обратном порядке (новые первыми)
    // Без toArray() — прямой доступ по ключу, экономим газ
    for (let id = this.marketCount - 1; id >= 0 && results.length < max; id--) {
      const json = this.markets.get(id.toString());
      if (!json) continue;

      const market: Market = JSON.parse(json);

      // Автоматически обновляем статус
      if (market.status === "active" && now >= BigInt(market.betsEndDate)) {
        market.status = "closed";
      }

      // Фильтры
      if (category && category !== "все" && market.category !== category) continue;
      if (status && status !== "все" && market.status !== status) continue;

      // Пагинация — пропускаем первые skip совпадений
      if (skipped < skip) {
        skipped++;
        continue;
      }

      results.push(market);
    }

    return results;
  }

  @view({})
  get_odds({ market_id }: { market_id: number }): {
    outcomes: string[];
    odds: number[];
    pools: string[];
    totalPool: string;
  } | null {
    const json = this.markets.get(market_id.toString());
    if (!json) return null;

    const market: Market = JSON.parse(json);
    const totalPool = BigInt(market.totalPool);

    const odds = market.outcomePools.map((pool) => {
      const p = BigInt(pool);
      if (p === BigInt(0) || totalPool === BigInt(0)) return 0;
      // Коэффициент = totalPool / outcomePool
      return Number((totalPool * BigInt(1000)) / p) / 1000;
    });

    return {
      outcomes: market.outcomes,
      odds,
      pools: market.outcomePools,
      totalPool: market.totalPool,
    };
  }

  @view({})
  get_market_bets({ market_id }: { market_id: number }): Bet[] {
    const json = this.marketBets.get(market_id.toString());
    if (!json) return [];
    return JSON.parse(json);
  }

  @view({})
  get_user_bets({ account_id }: { account_id: string }): Bet[] {
    const json = this.userBets.get(account_id);
    if (!json) return [];
    return JSON.parse(json);
  }

  @view({})
  get_stats(): {
    totalMarkets: number;
    totalVolume: string;
    owner: string;
    oracle: string;
  } {
    return {
      totalMarkets: this.marketCount,
      totalVolume: this.totalVolume,
      owner: this.owner,
      oracle: this.oracle,
    };
  }
}
