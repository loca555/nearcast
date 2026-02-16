# NearCast — Prediction Markets on NEAR

Decentralized prediction market platform on NEAR blockchain with an AI oracle for automatic market resolution.

## Features

- **Prediction Markets** — create and bet on sports event outcomes
- **AI Oracle** — automatic market resolution using Venice AI (Claude Sonnet 4.5)
- **Sports Data** — real match schedules via API-Sports
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
│       ├── sports-api.js      # API-Sports integration
│       └── spending-tracker.js # API budget tracking (SQLite)
├── frontend/
│   ├── App.jsx                # React SPA (single-file)
│   ├── near-wallet.js         # NEAR Wallet Selector wrapper
│   └── index.html
├── contract/                  # NEAR smart contract (Rust)
├── vite.config.js
└── package.json
```

**Stack:** Express + React 18 + NEAR API JS + Vite + SQLite (better-sqlite3)

## Getting Started

### Prerequisites

- Node.js 18+
- NEAR testnet account with deployed contract
- Venice AI API key
- API-Sports key (optional, for live schedules)

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

# API-Sports (optional)
API_SPORTS_KEY=your-api-sports-key

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

## License

MIT
