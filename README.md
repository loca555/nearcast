# NearCast — Prediction Markets on NEAR

Децентрализованная платформа предсказаний на блокчейне NEAR с двойной системой оракулов для автоматического разрешения рынков.

## How It Works

NearCast позволяет создавать рынки предсказаний на спортивные события. Пользователи делают ставки, а после завершения матча рынок автоматически разрешается — и выигрыш распределяется победителям.

### Двойная система оракулов

```
                    ┌─────────────────────────┐
                    │     NearCast Contract    │
                    │   (nearcast-oracle.testnet)   │
                    └─────────┬───────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼                               ▼
   ┌──────────────────┐            ┌──────────────────┐
   │   ESPN Oracle    │            │    AI Oracle      │
   │  (спортивные)    │            │  (остальные)      │
   └────────┬─────────┘            └────────┬─────────┘
            │                               │
            ▼                               ▼
   ┌──────────────────┐            ┌──────────────────┐
   │  OutLayer TEE    │            │    Venice AI      │
   │  Intel TDX       │            │  Claude Sonnet 4.5│
   │  + ESPN API      │            │  + Web Search     │
   └──────────────────┘            └──────────────────┘
```

**ESPN Oracle** — для спортивных рынков с привязкой к матчу (ESPN Event ID):
- WASM Worker запускается в Intel TDX (Trusted Execution Environment) через [OutLayer](https://outlayer.fastnear.com)
- Worker делает HTTP-запрос к ESPN API, парсит финальный счёт и определяет победителя
- Результат криптографически подтверждён аппаратным TEE — подделать невозможно
- **Permissionless** — кто угодно может вызвать разрешение, не нужен доверенный оператор
- Worker: [github.com/loca555/nearcast-espn-oracle](https://github.com/loca555/nearcast-espn-oracle)

**AI Oracle** — для рынков без ESPN привязки:
- AI (Claude Sonnet 4.5 через Venice AI) проверяет результат через веб-поиск
- Автоматически запускается каждые 5 минут на backend-сервере
- Требует доверие к оператору сервера

### Permissionless Resolution (ESPN Oracle)

Любой может разрешить спортивный рынок — через UI или напрямую через NEAR CLI:

```bash
near call nearcast-oracle.testnet request_resolution '{"market_id": 0}' \
  --accountId YOUR_ACCOUNT.testnet \
  --deposit 0.5 \
  --gas 300000000000000 \
  --networkId testnet
```

Вызывающий оплачивает OutLayer (~0.001 NEAR), неиспользованный депозит возвращается автоматически. Не требуется ни доступ к UI, ни ключи оператора.

## Features

- **Prediction Markets** — create and bet on sports event outcomes
- **AI Oracle** — automatic market resolution using Venice AI (Claude Sonnet 4.5)
- **Sports Data** — real match schedules via ESPN API (free, no key required)
- **ESPN Oracle** — permissionless sports market resolution via OutLayer TEE + ESPN scores
- **AI Market Generation** — AI creates market questions, outcomes, and deadlines from a selected match
- **NEAR Wallet** — connect via MyNearWallet, deposit/withdraw balance
- **i18n** — Russian / English interface with language toggle
- **Themes** — dark and light mode
- **Mobile-friendly** — responsive layout

## Architecture

```
nearcast/
├── backend/
│   ├── server.js              # Express server (API + static files)
│   ├── config.js              # Environment configuration
│   ├── routes/api.js          # REST API routes
│   └── services/
│       ├── near.js            # NEAR blockchain read/write
│       ├── oracle.js          # AI oracle (auto-resolve markets)
│       ├── ai-client.js       # Venice AI client (OpenAI-compatible)
│       ├── market-validator.js # Sports config, AI market generation
│       ├── sports-api.js      # ESPN API integration
│       └── spending-tracker.js # API budget tracking (SQLite)
├── frontend/
│   ├── App.jsx                # React SPA (single-file)
│   ├── near-wallet.js         # NEAR Wallet Selector wrapper
│   └── index.html
├── contract-rs/               # NEAR smart contract (Rust)
├── worker/                    # ESPN Oracle WASM worker (OutLayer TEE)
├── vite.config.js
└── package.json
```

**Stack:** Express + React 18 + NEAR API JS + Vite + SQLite (better-sqlite3)

## Getting Started

### Prerequisites

- Node.js 18+
- NEAR testnet account with deployed contract
- Venice AI API key

### Environment Variables

Create a `.env` file in the project root:

```env
# NEAR
NEAR_NETWORK=testnet
NEARCAST_CONTRACT=your-contract.testnet

# Oracle
ORACLE_ACCOUNT_ID=your-oracle.testnet
ORACLE_PRIVATE_KEY=ed25519:...

# Venice AI
VENICE_API_KEY=your-venice-key
AI_MODEL=claude-sonnet-45

# Budget
API_BUDGET_LIMIT=5
```

### Development

```bash
npm install
npm run dev
```

This starts both backend (port 4001) and frontend dev server (port 3001) concurrently.

### Production Build

```bash
npm run build   # builds frontend into backend/public/
npm start       # serves everything from Express on port 4001
```

## Deployment (Render.com)

The app is configured for Render free tier as a single web service:

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Environment:** Node

Set the environment variables listed above in the Render dashboard.

> Free tier sleeps after 15 min of inactivity. The server includes a self-ping every 14 min to stay awake. SQLite data resets on redeploy — core data (markets, bets) lives on NEAR blockchain.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/near-config` | NEAR network config |
| GET | `/api/markets` | List markets (query: `status`, `category`) |
| GET | `/api/markets/:id` | Market details |
| GET | `/api/markets/:id/odds` | Market odds |
| GET | `/api/markets/:id/bets` | Bets on a market |
| GET | `/api/user/:accountId/bets` | User's bets |
| GET | `/api/balance/:accountId` | User's platform balance |
| GET | `/api/stats` | Platform statistics |
| GET | `/api/sports-config` | Available sports/leagues |
| POST | `/api/upcoming-matches` | AI-powered match schedule |
| POST | `/api/generate-market` | AI-generated market for a match |
| GET | `/api/oracle/budget` | API spending summary |
| GET | `/api/oracle/logs` | Oracle resolution logs |

## Contracts & Workers

| Component | Address / Repo | Description |
|-----------|---------------|-------------|
| Smart Contract | `nearcast-oracle.testnet` | Rust, NEAR SDK 5.6, prediction markets + OutLayer integration |
| ESPN Worker | [loca555/nearcast-espn-oracle](https://github.com/loca555/nearcast-espn-oracle) | WASI P2 WASM, runs in OutLayer TEE |
| OutLayer | `outlayer.testnet` | Verifiable off-chain compute (Intel TDX) |

## License

MIT
