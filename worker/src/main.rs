/// NearCast ESPN Oracle — WASM-модуль для OutLayer TEE
///
/// Запускается внутри Intel TDX (Trusted Execution Environment).
/// Получает ESPN event ID, делает HTTP-запрос к ESPN API,
/// парсит счёт матча и определяет победителя.
///
/// Вход (stdin): JSON с метаданными рынка
/// Выход (stdout): JSON с результатом (<=900 байт)

use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use wasi_http_client::{Client, Method, Request};

// ── Входные данные (из stdin) ────────────────────────────────────

#[derive(Deserialize)]
struct Input {
    espn_event_id: String,
    sport: String,
    league: String,
    outcomes: Vec<String>,
    market_type: String, // "winner" | "over-under" | "both-score"
}

// ── Выходные данные (stdout, <=900 байт) ─────────────────────────

#[derive(Serialize)]
struct Output {
    winning_outcome: i32,
    confidence: f64,
    reasoning: String,
    home_score: i32,
    away_score: i32,
    event_status: String,
}

impl Output {
    fn error(msg: &str) -> Self {
        Output {
            winning_outcome: -1,
            confidence: 0.0,
            reasoning: msg.to_string(),
            home_score: -1,
            away_score: -1,
            event_status: "error".to_string(),
        }
    }

    fn not_finished(state: &str) -> Self {
        Output {
            winning_outcome: -1,
            confidence: 0.0,
            reasoning: format!("Event not completed (state: {})", state),
            home_score: -1,
            away_score: -1,
            event_status: state.to_string(),
        }
    }
}

// ── ESPN API структуры ───────────────────────────────────────────

/// ESPN summary API ответ — используем только нужные поля
#[derive(Deserialize)]
struct ESPNResponse {
    header: Option<Header>,
}

#[derive(Deserialize)]
struct Header {
    competitions: Option<Vec<Competition>>,
}

#[derive(Deserialize)]
struct Competition {
    status: Option<Status>,
    competitors: Option<Vec<Competitor>>,
}

#[derive(Deserialize)]
struct Status {
    #[serde(rename = "type")]
    status_type: Option<StatusType>,
}

#[derive(Deserialize)]
struct StatusType {
    completed: Option<bool>,
    state: Option<String>, // "pre" | "in" | "post"
}

#[derive(Deserialize)]
struct Competitor {
    #[serde(rename = "homeAway")]
    home_away: Option<String>,
    score: Option<String>,
    team: Option<Team>,
}

#[derive(Deserialize)]
struct Team {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

// ── Основная логика ──────────────────────────────────────────────

fn main() {
    let result = run();
    let output = match result {
        Ok(o) => o,
        Err(e) => Output::error(&format!("Fatal: {}", e)),
    };

    // Выводим результат в stdout (OutLayer читает stdout)
    print!("{}", serde_json::to_string(&output).unwrap_or_default());
    let _ = io::stdout().flush();
}

fn run() -> Result<Output, Box<dyn std::error::Error>> {
    // Читаем JSON из stdin
    let mut input_raw = String::new();
    io::stdin().read_to_string(&mut input_raw)?;
    let input: Input = serde_json::from_str(&input_raw)?;

    // Формируем URL ESPN summary API
    let url = format!(
        "https://site.api.espn.com/apis/site/v2/sports/{}/{}/summary?event={}",
        input.sport, input.league, input.espn_event_id
    );

    // HTTP GET к ESPN (внутри TEE — запрос невозможно подделать)
    let client = Client::new();
    let request = Request::new(Method::Get, &url);
    let response = client.send(request)?;

    if response.status() != 200 {
        return Ok(Output::error(&format!("ESPN HTTP {}", response.status())));
    }

    let body = String::from_utf8_lossy(response.body()).to_string();
    let espn: ESPNResponse = serde_json::from_str(&body)
        .map_err(|e| format!("ESPN JSON parse: {}", e))?;

    // Извлекаем данные о матче
    let comp = espn
        .header
        .and_then(|h| h.competitions)
        .and_then(|c| c.into_iter().next())
        .ok_or("No competition data in ESPN response")?;

    // Проверяем статус матча
    let state = comp
        .status
        .as_ref()
        .and_then(|s| s.status_type.as_ref())
        .and_then(|t| t.state.as_deref())
        .unwrap_or("unknown");

    let completed = comp
        .status
        .as_ref()
        .and_then(|s| s.status_type.as_ref())
        .and_then(|t| t.completed)
        .unwrap_or(false);

    if !completed || state != "post" {
        return Ok(Output::not_finished(state));
    }

    // Парсим счёт
    let competitors = comp.competitors.unwrap_or_default();
    let home = competitors
        .iter()
        .find(|c| c.home_away.as_deref() == Some("home"));
    let away = competitors
        .iter()
        .find(|c| c.home_away.as_deref() == Some("away"));

    let home_score: i32 = home
        .and_then(|c| c.score.as_ref())
        .and_then(|s| s.parse().ok())
        .unwrap_or(-1);
    let away_score: i32 = away
        .and_then(|c| c.score.as_ref())
        .and_then(|s| s.parse().ok())
        .unwrap_or(-1);

    if home_score < 0 || away_score < 0 {
        return Ok(Output::error("Could not parse scores from ESPN"));
    }

    // Определяем победителя по типу рынка
    let (winning_outcome, reasoning) = match input.market_type.as_str() {
        "winner" => resolve_winner(&input.outcomes, home_score, away_score),
        "over-under" => resolve_over_under(&input.outcomes, home_score, away_score),
        "both-score" => resolve_both_score(home_score, away_score),
        _ => (-1i32, format!("Unknown market type: {}", input.market_type)),
    };

    Ok(Output {
        winning_outcome,
        confidence: if winning_outcome >= 0 { 1.0 } else { 0.0 },
        reasoning,
        home_score,
        away_score,
        event_status: "final".to_string(),
    })
}

// ── Логика определения победителя ────────────────────────────────

/// Winner: 3-way (с ничьёй — футбол) или 2-way (баскетбол, теннис)
fn resolve_winner(outcomes: &[String], home: i32, away: i32) -> (i32, String) {
    if outcomes.len() == 3 {
        // 3-way: [HomeTeam, Draw, AwayTeam]
        if home > away {
            (0, format!("{} {} wins {}:{}", outcomes[0], home, away, outcomes[0]))
        } else if home < away {
            (2, format!("{} wins {}:{}", outcomes[2], home, away))
        } else {
            (1, format!("Draw {}:{}", home, away))
        }
    } else if outcomes.len() == 2 {
        // 2-way: [HomeTeam, AwayTeam]
        if home > away {
            (0, format!("{} wins {}:{}", outcomes[0], home, away))
        } else if home < away {
            (1, format!("{} wins {}:{}", outcomes[1], home, away))
        } else {
            // Ничья в 2-way рынке — void
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
        (0, format!("Total {}>{} ({}:{})", total, threshold, home, away))
    } else {
        (1, format!("Total {}<{} ({}:{})", total, threshold, home, away))
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
