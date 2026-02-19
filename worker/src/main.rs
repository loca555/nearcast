/// NearCast ESPN Oracle — WASM-модуль для OutLayer TEE
///
/// Запускается внутри Intel TDX (Trusted Execution Environment).
/// Получает ESPN event ID, делает HTTP-запрос к ESPN API,
/// возвращает СЫРЫЕ данные (имена команд, счёт, статус).
///
/// Логика определения победителя — в смарт-контракте (on-chain).
///
/// Вход (stdin): JSON с ESPN event ID, sport, league
/// Выход (stdout): JSON с сырыми данными ESPN (<=900 байт)

use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use wasi_http_client::Client;

// ── Входные данные (из stdin) ────────────────────────────────────

#[derive(Deserialize)]
struct Input {
    espn_event_id: String,
    sport: String,
    league: String,
}

// ── Выходные данные (stdout, <=900 байт) ─────────────────────────
/// Сырые данные ESPN — контракт сам определит winning_outcome

#[derive(Serialize)]
struct Output {
    home_team: String,
    away_team: String,
    home_score: i32,
    away_score: i32,
    event_status: String, // "final" | "pre" | "in" | "error"
    error: String,        // пустая строка если всё ОК
}

impl Output {
    fn error(msg: &str) -> Self {
        Output {
            home_team: String::new(),
            away_team: String::new(),
            home_score: -1,
            away_score: -1,
            event_status: "error".to_string(),
            error: msg.to_string(),
        }
    }

    fn not_finished(state: &str) -> Self {
        Output {
            home_team: String::new(),
            away_team: String::new(),
            home_score: -1,
            away_score: -1,
            event_status: state.to_string(),
            error: String::new(),
        }
    }
}

// ── ESPN API структуры ───────────────────────────────────────────

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
    let response = Client::new()
        .get(&url)
        .send()?;

    if response.status() != 200 {
        return Ok(Output::error(&format!("ESPN HTTP {}", response.status())));
    }

    let body = String::from_utf8_lossy(&response.body()?).to_string();
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

    // Парсим счёт и имена команд
    let competitors = comp.competitors.unwrap_or_default();
    let home_comp = competitors
        .iter()
        .find(|c| c.home_away.as_deref() == Some("home"));
    let away_comp = competitors
        .iter()
        .find(|c| c.home_away.as_deref() == Some("away"));

    let home_score: i32 = home_comp
        .and_then(|c| c.score.as_ref())
        .and_then(|s| s.parse().ok())
        .unwrap_or(-1);
    let away_score: i32 = away_comp
        .and_then(|c| c.score.as_ref())
        .and_then(|s| s.parse().ok())
        .unwrap_or(-1);

    let home_team = home_comp
        .and_then(|c| c.team.as_ref())
        .and_then(|t| t.display_name.as_deref())
        .unwrap_or("")
        .to_string();
    let away_team = away_comp
        .and_then(|c| c.team.as_ref())
        .and_then(|t| t.display_name.as_deref())
        .unwrap_or("")
        .to_string();

    if home_score < 0 || away_score < 0 {
        return Ok(Output::error("Could not parse scores from ESPN"));
    }

    Ok(Output {
        home_team,
        away_team,
        home_score,
        away_score,
        event_status: "final".to_string(),
        error: String::new(),
    })
}
