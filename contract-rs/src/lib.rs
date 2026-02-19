/// NearCast — Prediction Market на NEAR с Permissionless ESPN Oracle
///
/// Контракт поддерживает:
/// - Создание рынков с опциональными ESPN метаданными
/// - Ставки с внутреннего баланса (pari-mutuel)
/// - Permissionless разрешение через OutLayer TEE (ESPN Oracle)
/// - Логика определения победителя ON-CHAIN (fuzzy match по именам команд)
/// - Аннулирование (void) с возвратом ставок

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, log, near, AccountId, BorshStorageKey, Gas, NearToken, Promise};
use serde::{Deserialize, Serialize};

// ── Константы ────────────────────────────────────────────────────

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MIN_BET: u128 = ONE_NEAR / 10; // 0.1 NEAR
const MAX_OUTCOMES: usize = 10;
const MIN_OUTCOMES: usize = 2;

/// Gas для вызова OutLayer request_execution
const GAS_FOR_OUTLAYER: Gas = Gas::from_tgas(200);
/// Gas для callback on_resolution_result (увеличен — теперь матчинг on-chain)
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(30);
/// Минимальный депозит для OutLayer (0.1 NEAR)
const OUTLAYER_MIN_DEPOSIT: u128 = ONE_NEAR / 10;

/// Gas для view-call к TLS Oracle (get_attestation)
const GAS_FOR_TLS_VIEW: Gas = Gas::from_tgas(10);
/// Gas для callback on_tls_attestation_result
const GAS_FOR_TLS_CALLBACK: Gas = Gas::from_tgas(20);

// ── Ключи хранилища ─────────────────────────────────────────────

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Markets,
    MarketBets,
    UserBets,
    Balances,
}

// ── Модели данных ────────────────────────────────────────────────

#[derive(Clone)]
#[near(serializers = [borsh, json])]
#[serde(rename_all = "camelCase")]
pub struct Market {
    pub id: u64,
    pub creator: AccountId,
    pub question: String,
    pub description: String,
    pub outcomes: Vec<String>,
    pub outcome_pools: Vec<U128>,
    pub total_pool: U128,
    pub category: String,
    pub created_at: u64,       // наносекунды
    pub bets_end_date: u64,    // наносекунды — дедлайн ставок
    pub resolution_date: u64,  // наносекунды — когда можно разрешить
    pub resolved_outcome: i32, // -1 = не разрешён, -2 = void
    pub status: String,        // "active" | "closed" | "resolved" | "voided"
    pub total_bets: u32,
    // ESPN метаданные для OutLayer permissionless resolution
    pub espn_event_id: String,
    pub sport: String,
    pub league: String,
    pub market_type: String, // "winner" | "over-under" | "both-score"
}

#[derive(Clone)]
#[near(serializers = [borsh, json])]
#[serde(rename_all = "camelCase")]
pub struct Bet {
    pub market_id: u64,
    pub user: AccountId,
    pub outcome: u32,
    pub amount: U128,
    pub timestamp: u64,
    pub claimed: bool,
}

/// Сырые данные ESPN из TEE Worker (stdout)
/// Worker возвращает только счёт и имена — без winning_outcome
#[derive(Serialize, Deserialize)]
#[serde(crate = "serde")]
struct EspnResult {
    home_team: String,
    away_team: String,
    home_score: i32,
    away_score: i32,
    event_status: String, // "final" | "pre" | "in" | "error"
    error: String,
}

/// Компактные данные ESPN из TLS Oracle response_data
#[derive(Serialize, Deserialize)]
#[serde(crate = "serde")]
struct TlsEspnData {
    /// Home team
    ht: String,
    /// Away team
    at: String,
    /// Home score
    hs: i32,
    /// Away score
    #[serde(rename = "as")]
    away_score: i32,
    /// Status: "final", "in", "pre"
    st: String,
    /// ESPN event ID
    eid: String,
}

/// Аттестация из TLS Oracle контракта (формат get_attestation)
#[derive(Deserialize)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
struct TlsAttestation {
    source_url: String,
    server_name: String,
    response_data: String,
}

/// Аргументы для callback on_tls_attestation_result
#[derive(Serialize, Deserialize)]
#[serde(crate = "serde")]
struct TlsResolutionCallbackArgs {
    market_id: u64,
}

/// Источник WASM для OutLayer request_execution
#[derive(Serialize)]
#[serde(crate = "serde")]
struct OutLayerSource {
    #[serde(rename = "GitHub")]
    github: Option<GitHubSource>,
}

#[derive(Serialize)]
#[serde(crate = "serde")]
struct GitHubSource {
    repo: String,
    commit: String,
    build_target: String,
}

/// Лимиты ресурсов для OutLayer
#[derive(Serialize)]
#[serde(crate = "serde")]
struct ResourceLimits {
    max_instructions: u64,
    max_memory_mb: u32,
    max_execution_seconds: u32,
}

/// Входные данные для WASM Worker (упрощённые — без outcomes/market_type)
#[derive(Serialize)]
#[serde(crate = "serde")]
struct WorkerInput {
    espn_event_id: String,
    sport: String,
    league: String,
}

/// Аргументы для callback on_resolution_result
#[derive(Serialize, Deserialize)]
#[serde(crate = "serde")]
struct ResolutionCallbackArgs {
    market_id: u64,
}

// ── Контракт ─────────────────────────────────────────────────────

#[near(contract_state)]
pub struct NearCast {
    owner: AccountId,
    oracle: AccountId,
    markets: IterableMap<u64, Market>,
    market_bets: LookupMap<u64, Vec<Bet>>,
    user_bets: LookupMap<AccountId, Vec<Bet>>,
    balances: LookupMap<AccountId, u128>,
    market_count: u64,
    total_volume: u128,
    /// GitHub репозиторий с WASM Worker для OutLayer
    outlayer_source_repo: String,
    /// Commit/branch для OutLayer source
    outlayer_source_commit: String,
    /// OutLayer контракт (outlayer.testnet или outlayer.near)
    outlayer_contract: AccountId,
    /// Reclaim Protocol контракт (deprecated, сохраняем для совместимости Borsh)
    reclaim_contract: AccountId,
    /// TLS Oracle контракт для альтернативного разрешения рынков
    tls_oracle_contract: AccountId,
}

impl Default for NearCast {
    fn default() -> Self {
        Self {
            owner: env::predecessor_account_id(),
            oracle: env::predecessor_account_id(),
            markets: IterableMap::new(StorageKey::Markets),
            market_bets: LookupMap::new(StorageKey::MarketBets),
            user_bets: LookupMap::new(StorageKey::UserBets),
            balances: LookupMap::new(StorageKey::Balances),
            market_count: 0,
            total_volume: 0,
            outlayer_source_repo: String::new(),
            outlayer_source_commit: "main".to_string(),
            outlayer_contract: "outlayer.testnet".parse().unwrap(),
            reclaim_contract: "reclaim-protocol.testnet".parse().unwrap(),
            tls_oracle_contract: "tls-oracle-v2.nearcast-oracle.testnet"
                .parse()
                .unwrap(),
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// ON-CHAIN ЛОГИКА ОПРЕДЕЛЕНИЯ ПОБЕДИТЕЛЯ
//
// Раньше это было в TEE Worker — теперь выполняется в контракте.
// Контракт знает outcomes рынка и получает сырые данные из ESPN.
// ══════════════════════════════════════════════════════════════════

/// Безопасное умножение и деление: a * b / c без overflow u128
/// Используем промежуточное деление чтобы результат поместился в u128
fn safe_mul_div(a: u128, b: u128, c: u128) -> u128 {
    // a * b / c = (a / c) * b + (a % c) * b / c
    // Если (a % c) * b тоже переполняет, делим ещё раз
    let whole = (a / c) * b;
    let rem = a % c;
    // rem < c, но rem * b может переполнить если оба > ~10^19
    // Проверяем: если rem * b безопасно — считаем напрямую
    if rem <= u128::MAX / b.max(1) {
        whole + rem * b / c
    } else {
        // Второй уровень: (rem * b) / c через деление rem
        // rem * b / c = rem * (b / c) + rem * (b % c) / c
        let b_div = b / c;
        let b_rem = b % c;
        whole + rem * b_div + rem * b_rem / c
    }
}

/// Нечёткое совпадение: проверяем что одна строка содержит другую
fn fuzzy_match(outcome: &str, espn_name: &str) -> bool {
    if outcome.is_empty() || espn_name.is_empty() {
        return false;
    }
    let o = outcome.to_lowercase();
    let e = espn_name.to_lowercase();
    // Точное совпадение
    if o == e {
        return true;
    }
    // Одно содержит другое (напр. "Olympiacos" содержится в "Olympiacos FC")
    if o.contains(&e) || e.contains(&o) {
        return true;
    }
    // Совпадение слов длиной >= 4 символа (напр. "Leverkusen" vs "Bayer Leverkusen")
    let o_words: Vec<&str> = o.split_whitespace().collect();
    let e_words: Vec<&str> = e.split_whitespace().collect();
    for ow in &o_words {
        if ow.len() >= 4 {
            for ew in &e_words {
                if ow == ew {
                    return true;
                }
            }
        }
    }
    false
}

/// Winner: 3-way (с ничьёй — футбол) или 2-way (баскетбол, теннис)
/// Матчим outcomes по именам команд из ESPN, а не по позиции в массиве.
fn resolve_winner(
    outcomes: &[String],
    home: i32,
    away: i32,
    home_name: &str,
    away_name: &str,
) -> (i32, String) {
    if outcomes.len() == 3 {
        // Находим индексы по именам ESPN команд
        let draw_idx = outcomes.iter().position(|o| {
            let lower = o.to_lowercase();
            lower == "draw" || lower == "ничья"
        });
        let home_idx = outcomes.iter().position(|o| {
            Some(outcomes.iter().position(|x| x == o).unwrap()) != draw_idx
                && fuzzy_match(o, home_name)
        });
        let away_idx = outcomes.iter().position(|o| {
            Some(outcomes.iter().position(|x| x == o).unwrap()) != draw_idx
                && fuzzy_match(o, away_name)
        });

        // Fallback: если не удалось найти по имени, берём оставшиеся по порядку
        let non_draw: Vec<usize> = (0..3).filter(|&i| Some(i) != draw_idx).collect();
        let home_idx = home_idx.unwrap_or(non_draw[0]);
        let away_idx = away_idx.unwrap_or(non_draw[1]);

        if home > away {
            (
                home_idx as i32,
                format!("{} wins {}:{}", outcomes[home_idx], home, away),
            )
        } else if home < away {
            (
                away_idx as i32,
                format!("{} wins {}:{}", outcomes[away_idx], away, home),
            )
        } else if let Some(di) = draw_idx {
            (di as i32, format!("Draw {}:{}", home, away))
        } else {
            (-1, format!("Draw {}:{} but no Draw outcome", home, away))
        }
    } else if outcomes.len() == 2 {
        // 2-way: матчим по именам ESPN команд
        let home_idx = outcomes
            .iter()
            .position(|o| fuzzy_match(o, home_name));
        let away_idx = outcomes
            .iter()
            .position(|o| fuzzy_match(o, away_name));

        let home_idx = home_idx.unwrap_or(0);
        let away_idx = away_idx.unwrap_or(1);

        if home > away {
            (
                home_idx as i32,
                format!("{} wins {}:{}", outcomes[home_idx], home, away),
            )
        } else if home < away {
            (
                away_idx as i32,
                format!("{} wins {}:{}", outcomes[away_idx], home, away),
            )
        } else {
            (-1, format!("Draw {}:{} in 2-way market", home, away))
        }
    } else {
        (-1, "Invalid outcomes count for winner".to_string())
    }
}

/// Over/Under: outcomes ["Over X.5", "Under X.5"]
fn resolve_over_under(outcomes: &[String], home: i32, away: i32) -> (i32, String) {
    let total = home + away;
    // Извлекаем порог из названия первого исхода (напр. "Over 2.5" → 2.5)
    let threshold = outcomes
        .first()
        .and_then(|o| {
            o.split_whitespace()
                .find_map(|word| word.parse::<f64>().ok())
        })
        .unwrap_or(2.5);

    if (total as f64) > threshold {
        (
            0,
            format!("Total {}>{} ({}:{})", total, threshold, home, away),
        )
    } else {
        (
            1,
            format!("Total {}<{} ({}:{})", total, threshold, home, away),
        )
    }
}

/// Both teams to score: [Yes, No]
fn resolve_both_score(home: i32, away: i32) -> (i32, String) {
    if home > 0 && away > 0 {
        (0, format!("Both scored ({}:{})", home, away))
    } else {
        (1, format!("Not both scored ({}:{})", home, away))
    }
}

/// Определяет winning_outcome из сырых данных ESPN + метаданных рынка
fn determine_winner(
    market: &Market,
    espn: &EspnResult,
) -> (i32, f64, String) {
    if espn.event_status != "final" {
        return (-1, 0.0, format!("Event not completed (status: {})", espn.event_status));
    }

    if !espn.error.is_empty() {
        return (-1, 0.0, format!("ESPN error: {}", espn.error));
    }

    if espn.home_score < 0 || espn.away_score < 0 {
        return (-1, 0.0, "Could not parse scores from ESPN".to_string());
    }

    let (winning_outcome, reasoning) = match market.market_type.as_str() {
        "winner" => resolve_winner(
            &market.outcomes,
            espn.home_score,
            espn.away_score,
            &espn.home_team,
            &espn.away_team,
        ),
        "over-under" => resolve_over_under(
            &market.outcomes,
            espn.home_score,
            espn.away_score,
        ),
        "both-score" => resolve_both_score(espn.home_score, espn.away_score),
        _ => (-1, format!("Unknown market type: {}", market.market_type)),
    };

    let confidence = if winning_outcome >= 0 { 1.0 } else { 0.0 };
    (winning_outcome, confidence, reasoning)
}

// ══════════════════════════════════════════════════════════════════

#[near]
impl NearCast {
    /// Инициализация контракта (ignore_state — для миграции)
    #[init(ignore_state)]
    pub fn new(oracle: Option<AccountId>) -> Self {
        let owner = env::predecessor_account_id();
        Self {
            owner: owner.clone(),
            oracle: oracle.unwrap_or(owner),
            markets: IterableMap::new(StorageKey::Markets),
            market_bets: LookupMap::new(StorageKey::MarketBets),
            user_bets: LookupMap::new(StorageKey::UserBets),
            balances: LookupMap::new(StorageKey::Balances),
            market_count: 0,
            total_volume: 0,
            outlayer_source_repo: String::new(),
            outlayer_source_commit: "main".to_string(),
            outlayer_contract: "outlayer.testnet".parse().unwrap(),
            reclaim_contract: "reclaim-protocol.testnet".parse().unwrap(),
            tls_oracle_contract: "tls-oracle-v2.nearcast-oracle.testnet"
                .parse()
                .unwrap(),
        }
    }

    // ══════════════════════════════════════════════════════════════
    // ВНУТРЕННИЙ БАЛАНС — deposit / withdraw
    // ══════════════════════════════════════════════════════════════

    /// Пополнение внутреннего баланса
    #[payable]
    pub fn deposit(&mut self) {
        let sender = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount > 0, "Прикрепите NEAR для пополнения");

        let current = self.balances.get(&sender).copied().unwrap_or(0);
        self.balances.set(sender.clone(), Some(current + amount));

        log!("Депозит: {} пополнил баланс на {} yoctoNEAR", sender, amount);
    }

    /// Вывод средств с внутреннего баланса на кошелёк
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let sender = env::predecessor_account_id();
        let withdraw_amount: u128 = amount.into();
        assert!(withdraw_amount > 0, "Сумма должна быть положительной");

        let current = self.balances.get(&sender).copied().unwrap_or(0);
        assert!(current >= withdraw_amount, "Недостаточно средств на балансе");

        self.balances.set(sender.clone(), Some(current - withdraw_amount));

        log!("Вывод: {} выводит {} yoctoNEAR", sender, withdraw_amount);
        Promise::new(sender).transfer(NearToken::from_yoctonear(withdraw_amount))
    }

    // ══════════════════════════════════════════════════════════════
    // СОЗДАНИЕ РЫНКА
    // ══════════════════════════════════════════════════════════════

    pub fn create_market(
        &mut self,
        question: String,
        description: String,
        outcomes: Vec<String>,
        category: String,
        bets_end_date: String,
        resolution_date: String,
        espn_event_id: Option<String>,
        sport: Option<String>,
        league: Option<String>,
        market_type: Option<String>,
    ) -> u64 {
        let sender = env::predecessor_account_id();
        let now = env::block_timestamp();

        let bets_end: u64 = bets_end_date.parse().expect("Невалидный bets_end_date");
        let resolution: u64 = resolution_date.parse().expect("Невалидный resolution_date");

        // Валидация
        assert!(
            !question.is_empty() && question.len() <= 500,
            "Вопрос: от 1 до 500 символов"
        );
        assert!(description.len() <= 2000, "Описание: до 2000 символов");
        assert!(
            outcomes.len() >= MIN_OUTCOMES && outcomes.len() <= MAX_OUTCOMES,
            "Количество исходов: от {} до {}",
            MIN_OUTCOMES,
            MAX_OUTCOMES
        );
        assert!(bets_end > now, "Дедлайн ставок должен быть в будущем");
        assert!(
            resolution > bets_end,
            "Дата разрешения должна быть после дедлайна ставок"
        );

        for (i, o) in outcomes.iter().enumerate() {
            assert!(
                !o.is_empty() && o.len() <= 200,
                "Каждый исход: от 1 до 200 символов"
            );
            for j in (i + 1)..outcomes.len() {
                assert!(o != &outcomes[j], "Исходы должны быть уникальными");
            }
        }

        let id = self.market_count;
        self.market_count += 1;

        let outcome_pools = vec![U128(0); outcomes.len()];

        let market = Market {
            id,
            creator: sender,
            question: question.clone(),
            description,
            outcomes: outcomes.clone(),
            outcome_pools,
            total_pool: U128(0),
            category,
            created_at: now,
            bets_end_date: bets_end,
            resolution_date: resolution,
            resolved_outcome: -1,
            status: "active".to_string(),
            total_bets: 0,
            espn_event_id: espn_event_id.unwrap_or_default(),
            sport: sport.unwrap_or_default(),
            league: league.unwrap_or_default(),
            market_type: market_type.unwrap_or_else(|| "winner".to_string()),
        };

        self.markets.insert(id, market);
        self.market_bets.set(id, Some(Vec::new()));

        log!(
            "Рынок создан: #{} — \"{}\" ({} исходов)",
            id,
            question,
            outcomes.len()
        );
        id
    }

    // ══════════════════════════════════════════════════════════════
    // СТАВКИ (списание с внутреннего баланса)
    // ══════════════════════════════════════════════════════════════

    pub fn place_bet(&mut self, market_id: u64, outcome: u32, amount: U128) {
        let bet_amount: u128 = amount.into();
        let sender = env::predecessor_account_id();
        let now = env::block_timestamp();

        assert!(bet_amount >= MIN_BET, "Минимальная ставка: 0.1 NEAR");

        let balance = self.balances.get(&sender).copied().unwrap_or(0);
        assert!(
            balance >= bet_amount,
            "Недостаточно средств. Пополните депозит."
        );
        self.balances.set(sender.clone(), Some(balance - bet_amount));

        let mut market = self.markets.get(&market_id).expect("Рынок не найден").clone();

        assert!(market.status == "active", "Рынок не принимает ставки");
        assert!(now < market.bets_end_date, "Время ставок истекло");
        assert!(
            (outcome as usize) < market.outcomes.len(),
            "Недопустимый исход"
        );

        let pool: u128 = market.outcome_pools[outcome as usize].into();
        market.outcome_pools[outcome as usize] = U128(pool + bet_amount);
        let total: u128 = market.total_pool.into();
        market.total_pool = U128(total + bet_amount);
        market.total_bets += 1;

        self.markets.insert(market_id, market);

        let bet = Bet {
            market_id,
            user: sender.clone(),
            outcome,
            amount: U128(bet_amount),
            timestamp: now,
            claimed: false,
        };

        let mut bets = self.market_bets.get(&market_id).cloned().unwrap_or_default();
        bets.push(bet.clone());
        self.market_bets.set(market_id, Some(bets));

        let mut user_bets = self.user_bets.get(&sender).cloned().unwrap_or_default();
        user_bets.push(bet);
        self.user_bets.set(sender.clone(), Some(user_bets));

        self.total_volume += bet_amount;

        log!(
            "Ставка: {} поставил {} на исход #{} рынка #{}",
            sender,
            bet_amount,
            outcome,
            market_id
        );
    }

    // ══════════════════════════════════════════════════════════════
    // ESPN ORACLE — permissionless разрешение через OutLayer TEE
    //
    // Кто угодно может вызвать request_resolution с депозитом 0.1 NEAR.
    // Контракт вызовет OutLayer, WASM Worker в TEE получит счёт из ESPN,
    // и контракт ON-CHAIN определит победителя по именам команд.
    // ══════════════════════════════════════════════════════════════

    /// Permissionless: кто угодно вызывает для рынков с ESPN данными
    #[payable]
    pub fn request_resolution(&mut self, market_id: u64) -> Promise {
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(
            deposit >= OUTLAYER_MIN_DEPOSIT,
            "Минимальный депозит: 0.1 NEAR для OutLayer"
        );
        assert!(
            !self.outlayer_source_repo.is_empty(),
            "OutLayer source не настроен"
        );

        let market = self.markets.get(&market_id).expect("Рынок не найден").clone();
        assert!(
            !market.espn_event_id.is_empty(),
            "Рынок не спортивный (нет espn_event_id)"
        );
        assert!(
            market.status == "active" || market.status == "closed",
            "Рынок уже разрешён или аннулирован"
        );

        let now = env::block_timestamp();
        assert!(
            now >= market.resolution_date,
            "Время разрешения ещё не наступило"
        );

        // Входные данные для Worker — только ESPN координаты
        let worker_input = WorkerInput {
            espn_event_id: market.espn_event_id.clone(),
            sport: market.sport.clone(),
            league: market.league.clone(),
        };
        let input_data = serde_json::to_string(&worker_input).unwrap();

        // Формируем source для OutLayer
        let source = OutLayerSource {
            github: Some(GitHubSource {
                repo: self.outlayer_source_repo.clone(),
                commit: self.outlayer_source_commit.clone(),
                build_target: "wasm32-wasip2".to_string(),
            }),
        };

        let limits = ResourceLimits {
            max_instructions: 1_000_000_000,
            max_memory_mb: 128,
            max_execution_seconds: 60,
        };

        // Аргументы для OutLayer request_execution
        let args = serde_json::json!({
            "source": source,
            "resource_limits": limits,
            "input_data": input_data,
            "response_format": "Json",
        });

        let callback_args = ResolutionCallbackArgs { market_id };

        log!(
            "OutLayer запрос для рынка #{} (ESPN: {})",
            market_id,
            market.espn_event_id
        );

        // Cross-contract call: OutLayer → callback
        Promise::new(self.outlayer_contract.clone())
            .function_call(
                "request_execution".to_string(),
                serde_json::to_vec(&args).unwrap(),
                NearToken::from_yoctonear(deposit),
                GAS_FOR_OUTLAYER,
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_resolution_result".to_string(),
                    serde_json::to_vec(&callback_args).unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_CALLBACK,
                ),
            )
    }

    /// Callback от OutLayer — парсит сырые данные ESPN, определяет победителя ON-CHAIN
    #[private]
    pub fn on_resolution_result(&mut self, market_id: u64) -> String {
        assert_eq!(
            env::promise_results_count(),
            1,
            "Ожидается один результат"
        );

        let result = env::promise_result_checked(0, 1_000_000);
        match result {
            Ok(data) => {
                let result_str =
                    String::from_utf8(data).unwrap_or_else(|_| "invalid utf8".to_string());

                match serde_json::from_str::<EspnResult>(&result_str) {
                    Ok(espn_result) => {
                        // Получаем рынок для доступа к outcomes и market_type
                        let market = match self.markets.get(&market_id) {
                            Some(m) => m.clone(),
                            None => {
                                log!("OutLayer: рынок #{} не найден", market_id);
                                return format!("Market #{} not found", market_id);
                            }
                        };

                        // Определяем победителя ON-CHAIN
                        let (winning_outcome, confidence, reasoning) =
                            determine_winner(&market, &espn_result);

                        self.apply_resolution(
                            market_id,
                            winning_outcome,
                            confidence,
                            &reasoning,
                            &espn_result.event_status,
                            espn_result.home_score,
                            espn_result.away_score,
                        );

                        log!(
                            "OutLayer: рынок #{} — исход={}, счёт={}:{}, {}",
                            market_id,
                            winning_outcome,
                            espn_result.home_score,
                            espn_result.away_score,
                            reasoning
                        );
                        format!(
                            "Resolved: outcome={}, score={}:{}, {}",
                            winning_outcome,
                            espn_result.home_score,
                            espn_result.away_score,
                            reasoning
                        )
                    }
                    Err(e) => {
                        log!(
                            "OutLayer: ошибка парсинга для рынка #{}: {}",
                            market_id,
                            e
                        );
                        format!("Parse error: {}", e)
                    }
                }
            }
            Err(_) => {
                log!("OutLayer: вызов не удался для рынка #{}", market_id);
                "OutLayer call failed".to_string()
            }
        }
    }

    /// Применяет результат к рынку
    fn apply_resolution(
        &mut self,
        market_id: u64,
        winning_outcome: i32,
        confidence: f64,
        reasoning: &str,
        event_status: &str,
        home_score: i32,
        away_score: i32,
    ) {
        let mut market = match self.markets.get(&market_id) {
            Some(m) => m.clone(),
            None => return,
        };

        if market.status != "active" && market.status != "closed" {
            return;
        }

        if event_status != "final" {
            log!(
                "OutLayer: матч не завершён для рынка #{} (status: {})",
                market_id,
                event_status
            );
            return;
        }

        if winning_outcome == -1 || confidence < 0.3 {
            market.resolved_outcome = -2;
            market.status = "voided".to_string();
            self.markets.insert(market_id, market);
            log!(
                "Рынок #{} аннулирован через OutLayer: {}",
                market_id,
                reasoning
            );
        } else if winning_outcome >= 0
            && (winning_outcome as usize) < market.outcomes.len()
        {
            market.resolved_outcome = winning_outcome;
            market.status = "resolved".to_string();

            let outcome_name = market.outcomes[winning_outcome as usize].clone();
            self.markets.insert(market_id, market);
            log!(
                "Рынок #{} разрешён через OutLayer: исход #{} (\"{}\") | {}:{} | {}",
                market_id,
                winning_outcome,
                outcome_name,
                home_score,
                away_score,
                reasoning
            );
        }
    }

    // ══════════════════════════════════════════════════════════════
    // TLS ORACLE — альтернативное разрешение через MPC-TLS + ZK proof
    //
    // Relayer вызывает resolve_with_tls_attestation, передавая attestation_id
    // и распарсенные off-chain данные. Контракт верифицирует данные через
    // cross-contract view call к TLS Oracle (сравнивает с response_data).
    // ══════════════════════════════════════════════════════════════

    /// Разрешить рынок через TLS Oracle аттестацию
    ///
    /// Делает cross-contract view call к TLS Oracle для верификации данных.
    /// Любой может вызвать — permissionless (аналог request_resolution).
    pub fn resolve_with_tls_attestation(
        &mut self,
        market_id: u64,
        attestation_id: u64,
        home_score: i32,
        away_score: i32,
        home_team: String,
        away_team: String,
        event_status: String,
    ) -> Promise {
        let market = self
            .markets
            .get(&market_id)
            .expect("Рынок не найден")
            .clone();
        assert!(
            !market.espn_event_id.is_empty(),
            "Рынок не спортивный (нет espn_event_id)"
        );
        assert!(
            market.status == "active" || market.status == "closed",
            "Рынок уже разрешён или аннулирован"
        );

        let now = env::block_timestamp();
        assert!(
            now >= market.resolution_date,
            "Время разрешения ещё не наступило"
        );

        log!(
            "TLS Oracle запрос для рынка #{} (attestation #{})",
            market_id,
            attestation_id
        );

        // Аргументы для callback — передаём ожидаемые данные для верификации
        let callback_args = serde_json::json!({
            "market_id": market_id,
            "attestation_id": attestation_id,
            "expected_home_score": home_score,
            "expected_away_score": away_score,
            "expected_home_team": home_team,
            "expected_away_team": away_team,
            "expected_event_status": event_status,
        });

        // Cross-contract view call к TLS Oracle: get_attestation(id)
        let view_args = serde_json::json!({ "id": attestation_id });

        Promise::new(self.tls_oracle_contract.clone())
            .function_call(
                "get_attestation".to_string(),
                serde_json::to_vec(&view_args).unwrap(),
                NearToken::from_yoctonear(0),
                GAS_FOR_TLS_VIEW,
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_tls_attestation_result".to_string(),
                    serde_json::to_vec(&callback_args).unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_TLS_CALLBACK,
                ),
            )
    }

    /// Callback от TLS Oracle — верифицирует аттестацию и разрешает рынок
    #[private]
    pub fn on_tls_attestation_result(
        &mut self,
        market_id: u64,
        attestation_id: u64,
        expected_home_score: i32,
        expected_away_score: i32,
        expected_home_team: String,
        expected_away_team: String,
        expected_event_status: String,
    ) -> String {
        assert_eq!(
            env::promise_results_count(),
            1,
            "Ожидается один результат"
        );

        let result = env::promise_result_checked(0, 1_000_000);
        match result {
            Ok(data) => {
                let result_str =
                    String::from_utf8(data).unwrap_or_else(|_| "invalid utf8".to_string());

                // Парсим аттестацию из TLS Oracle
                let attestation: TlsAttestation = match serde_json::from_str(&result_str) {
                    Ok(a) => a,
                    Err(e) => {
                        log!(
                            "TLS Oracle: ошибка парсинга аттестации #{}: {}",
                            attestation_id,
                            e
                        );
                        return format!("Attestation parse error: {}", e);
                    }
                };

                // Верификация: server_name должен быть ESPN
                if attestation.server_name != "site.api.espn.com" {
                    log!(
                        "TLS Oracle: неверный server_name '{}' (ожидался site.api.espn.com)",
                        attestation.server_name
                    );
                    return "Invalid server_name".to_string();
                }

                // Верификация: source_url должен содержать espn_event_id рынка
                let market = match self.markets.get(&market_id) {
                    Some(m) => m.clone(),
                    None => return format!("Market #{} not found", market_id),
                };

                if !attestation.source_url.contains(&market.espn_event_id) {
                    log!(
                        "TLS Oracle: source_url не содержит event_id '{}'. URL: {}",
                        market.espn_event_id,
                        attestation.source_url
                    );
                    return "source_url does not match ESPN event".to_string();
                }

                // Парсим response_data — компактный формат ESPN
                let espn_data: TlsEspnData = match serde_json::from_str(&attestation.response_data)
                {
                    Ok(d) => d,
                    Err(e) => {
                        log!(
                            "TLS Oracle: ошибка парсинга response_data: {}",
                            e
                        );
                        return format!("response_data parse error: {}", e);
                    }
                };

                // Верификация: сравниваем данные из аттестации с переданными relayer
                if espn_data.hs != expected_home_score
                    || espn_data.away_score != expected_away_score
                {
                    log!(
                        "TLS Oracle: данные не совпадают! Аттестация: {}:{}, ожидалось: {}:{}",
                        espn_data.hs,
                        espn_data.away_score,
                        expected_home_score,
                        expected_away_score
                    );
                    return "Score mismatch between attestation and request".to_string();
                }

                // Конвертируем в EspnResult для determine_winner
                let espn_result = EspnResult {
                    home_team: espn_data.ht.clone(),
                    away_team: espn_data.at.clone(),
                    home_score: espn_data.hs,
                    away_score: espn_data.away_score,
                    event_status: if espn_data.st == "final" {
                        "final".to_string()
                    } else {
                        espn_data.st.clone()
                    },
                    error: String::new(),
                };

                // Определяем победителя ON-CHAIN (используем ту же логику)
                let (winning_outcome, confidence, reasoning) =
                    determine_winner(&market, &espn_result);

                self.apply_resolution(
                    market_id,
                    winning_outcome,
                    confidence,
                    &format!("[TLS Oracle #{}] {}", attestation_id, reasoning),
                    &espn_result.event_status,
                    espn_result.home_score,
                    espn_result.away_score,
                );

                log!(
                    "TLS Oracle: рынок #{} — исход={}, счёт={}:{}, {}",
                    market_id,
                    winning_outcome,
                    espn_result.home_score,
                    espn_result.away_score,
                    reasoning
                );

                format!(
                    "Resolved via TLS Oracle: outcome={}, score={}:{}, {}",
                    winning_outcome,
                    espn_result.home_score,
                    espn_result.away_score,
                    reasoning
                )
            }
            Err(_) => {
                log!(
                    "TLS Oracle: view call не удался для аттестации #{}",
                    attestation_id
                );
                "TLS Oracle view call failed".to_string()
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // ПОЛУЧЕНИЕ ВЫИГРЫША / ВОЗВРАТ
    // ══════════════════════════════════════════════════════════════

    pub fn claim_winnings(&mut self, market_id: u64) {
        let sender = env::predecessor_account_id();

        let market = self.markets.get(&market_id).expect("Рынок не найден").clone();
        assert!(
            market.status == "resolved" || market.status == "voided",
            "Рынок ещё не разрешён"
        );

        let mut bets = self.market_bets.get(&market_id).cloned().unwrap_or_default();
        let mut payout: u128 = 0;
        let mut has_claimed = false;
        let mut bet_indices: Vec<usize> = Vec::new();

        if market.status == "voided" {
            for (i, bet) in bets.iter().enumerate() {
                if bet.user == sender {
                    if bet.claimed {
                        has_claimed = true;
                        break;
                    }
                    let amt: u128 = bet.amount.into();
                    payout += amt;
                    bet_indices.push(i);
                }
            }
        } else {
            for (i, bet) in bets.iter().enumerate() {
                if bet.user == sender && bet.outcome == market.resolved_outcome as u32 {
                    if bet.claimed {
                        has_claimed = true;
                        break;
                    }
                    let amt: u128 = bet.amount.into();
                    payout += amt;
                    bet_indices.push(i);
                }
            }

            if payout > 0 {
                let total_pool: u128 = market.total_pool.into();
                let winning_pool: u128 =
                    market.outcome_pools[market.resolved_outcome as usize].into();
                if winning_pool > 0 {
                    // Безопасный расчёт без overflow u128:
                    // payout * total_pool может переполнить (yoctoNEAR ~ 10^24)
                    // Делим через промежуточный масштаб
                    payout = safe_mul_div(payout, total_pool, winning_pool);
                }
            }
        }

        assert!(!has_claimed, "Выигрыш уже получен");
        assert!(payout > 0, "Нет ставок для получения");

        for &idx in &bet_indices {
            bets[idx].claimed = true;
        }
        self.market_bets.set(market_id, Some(bets));

        let mut user_bets = self.user_bets.get(&sender).cloned().unwrap_or_default();
        for ub in user_bets.iter_mut() {
            if ub.market_id == market_id {
                if market.status == "voided" || ub.outcome == market.resolved_outcome as u32 {
                    ub.claimed = true;
                }
            }
        }
        self.user_bets.set(sender.clone(), Some(user_bets));

        let current = self.balances.get(&sender).copied().unwrap_or(0);
        self.balances.set(sender.clone(), Some(current + payout));

        let action = if market.status == "voided" {
            "Возврат"
        } else {
            "Выигрыш"
        };
        log!(
            "{}: {} получил {} yoctoNEAR с рынка #{}",
            action,
            sender,
            payout,
            market_id
        );
    }

    // ══════════════════════════════════════════════════════════════
    // АДМИНИСТРАТИВНЫЕ МЕТОДЫ
    // ══════════════════════════════════════════════════════════════

    /// Настройка OutLayer — GitHub repo с WASM Worker
    pub fn set_outlayer_config(
        &mut self,
        source_repo: String,
        source_commit: Option<String>,
        outlayer_contract: Option<AccountId>,
    ) {
        assert!(
            env::predecessor_account_id() == self.owner,
            "Только владелец"
        );
        self.outlayer_source_repo = source_repo.clone();
        if let Some(commit) = source_commit {
            self.outlayer_source_commit = commit;
        }
        if let Some(contract) = outlayer_contract {
            self.outlayer_contract = contract;
        }
        log!(
            "OutLayer настроен: repo={}, commit={}, contract={}",
            source_repo,
            self.outlayer_source_commit,
            self.outlayer_contract
        );
    }

    /// Настройка TLS Oracle контракта
    pub fn set_tls_oracle_config(&mut self, tls_oracle_contract: AccountId) {
        assert!(
            env::predecessor_account_id() == self.owner,
            "Только владелец"
        );
        self.tls_oracle_contract = tls_oracle_contract.clone();
        log!("TLS Oracle настроен: {}", tls_oracle_contract);
    }

    // ══════════════════════════════════════════════════════════════
    // VIEW МЕТОДЫ
    // ══════════════════════════════════════════════════════════════

    pub fn get_balance(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_market(&self, market_id: u64) -> Option<Market> {
        let mut market = self.markets.get(&market_id)?.clone();
        let now = env::block_timestamp();
        if market.status == "active" && now >= market.bets_end_date {
            market.status = "closed".to_string();
        }
        Some(market)
    }

    pub fn get_markets(
        &self,
        from_index: Option<u64>,
        limit: Option<u64>,
        category: Option<String>,
        status: Option<String>,
    ) -> Vec<Market> {
        let skip = from_index.unwrap_or(0);
        let max = limit.unwrap_or(50) as usize;
        let now = env::block_timestamp();
        let mut results: Vec<Market> = Vec::new();
        let mut skipped: u64 = 0;

        let mut id = self.market_count;
        while id > 0 && results.len() < max {
            id -= 1;
            let mut market = match self.markets.get(&id) {
                Some(m) => m.clone(),
                None => continue,
            };

            if market.status == "active" && now >= market.bets_end_date {
                market.status = "closed".to_string();
            }

            if let Some(ref cat) = category {
                if cat != "все" && market.category != *cat {
                    continue;
                }
            }
            if let Some(ref st) = status {
                if st != "все" && market.status != *st {
                    continue;
                }
            }

            if skipped < skip {
                skipped += 1;
                continue;
            }

            results.push(market);
        }

        results
    }

    pub fn get_odds(&self, market_id: u64) -> Option<serde_json::Value> {
        let market = self.markets.get(&market_id)?;
        let total_pool: u128 = market.total_pool.into();

        let odds: Vec<f64> = market
            .outcome_pools
            .iter()
            .map(|pool| {
                let p: u128 = (*pool).into();
                if p == 0 || total_pool == 0 {
                    0.0
                } else {
                    (total_pool as f64 * 1000.0 / p as f64).round() / 1000.0
                }
            })
            .collect();

        Some(serde_json::json!({
            "outcomes": market.outcomes,
            "odds": odds,
            "pools": market.outcome_pools,
            "totalPool": market.total_pool,
        }))
    }

    pub fn get_market_bets(&self, market_id: u64) -> Vec<Bet> {
        self.market_bets.get(&market_id).cloned().unwrap_or_default()
    }

    pub fn get_user_bets(&self, account_id: AccountId) -> Vec<Bet> {
        self.user_bets.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn get_stats(&self) -> serde_json::Value {
        serde_json::json!({
            "totalMarkets": self.market_count,
            "totalVolume": U128(self.total_volume),
            "owner": self.owner,
            "oracle": self.oracle,
            "outlayerSourceRepo": self.outlayer_source_repo,
            "outlayerContract": self.outlayer_contract,
            "tlsOracleContract": self.tls_oracle_contract,
        })
    }

    pub fn get_outlayer_config(&self) -> serde_json::Value {
        serde_json::json!({
            "source_repo": self.outlayer_source_repo,
            "source_commit": self.outlayer_source_commit,
            "outlayer_contract": self.outlayer_contract,
        })
    }
}
