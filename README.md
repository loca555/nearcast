# NearCast — Prediction Markets on NEAR

Decentralized prediction markets on NEAR Protocol with dual permissionless oracle system for automatic sports market resolution.

## How It Works

NearCast lets anyone create prediction markets on sports events. Users place bets, and after the match ends, anyone can trigger market resolution — winnings are distributed to correct predictors automatically.

### Dual Oracle System

```
                    +-----------------------------+
                    |      NearCast Contract       |
                    |  (nearcast-oracle.testnet)   |
                    +------+----------------+------+
                           |                |
               +-----------+                +-----------+
               v                                        v
   +-----------------------+              +-----------------------+
   |  Path 1: OutLayer TEE |              |  Path 2: Reclaim zkTLS|
   |  (hardware proof)     |              |  (cryptographic proof) |
   +----------+------------+              +----------+------------+
              |                                      |
              v                                      v
   +-----------------------+              +-----------------------+
   |  Intel TDX enclave    |              |  reclaim-protocol     |
   |  + ESPN API scores    |              |  .testnet             |
   |  via outlayer.testnet |              |  + ESPN API via zkFetch|
   +-----------------------+              +-----------------------+
```

Both paths are **fully permissionless** — anyone can trigger resolution, no trusted operator needed.

| | OutLayer TEE | Reclaim zkTLS |
|---|---|---|
| Trust model | Hardware (Intel TDX) | Cryptographic (ZK proof) |
| Proof verification | outlayer.testnet | reclaim-protocol.testnet |
| Data source | ESPN API | ESPN API |
| Cost | ~0.1 NEAR deposit (refunded) | 0 NEAR (only gas) |
| Requires wallet popup | Yes | No (via backend) |
| Can call from explorer | Yes | Yes |
| On-chain verification | TEE attestation | ZK proof verification |

### Common Resolution Flow

Both paths converge at `apply_resolution` in the smart contract:

```
verify proof on-chain --> cross-check scores --> apply_resolution --> distribute winnings
```

## Manual Resolution Guide

### Method 1: OutLayer TEE (via NEAR CLI)

Anyone can resolve a sports market by calling the contract directly:

```bash
near call nearcast-oracle.testnet request_resolution \
  '{"market_id": 0}' \
  --accountId YOUR_ACCOUNT.testnet \
  --deposit 0.1 \
  --gas 300000000000000 \
  --networkId testnet
```

- **market_id**: ID of the market (visible in UI or via `get_markets`)
- **deposit**: ~0.1 NEAR for OutLayer execution (unused portion refunded)
- The contract calls OutLayer TEE, which fetches ESPN scores and returns the result
- No special keys needed — use any NEAR account

### Method 2: Reclaim zkTLS (via NEAR CLI / Explorer)

The `resolve_with_reclaim_proof` method is permissionless — anyone can call it with a valid proof.

#### Step 1: Generate a Reclaim Proof

Register at https://dev.reclaimprotocol.org and get your `APP_ID` + `APP_SECRET`.

```bash
npm install @reclaimprotocol/zk-fetch
```

Create a script `generate-proof.mjs`:

```js
import { ReclaimClient } from "@reclaimprotocol/zk-fetch";

const APP_ID = "YOUR_APP_ID";
const APP_SECRET = "YOUR_APP_SECRET";

// ESPN event ID from the market's espnEventId field
const SPORT = "basketball";  // or soccer, hockey, football, baseball, mma
const LEAGUE = "nba";        // or eng.1, nhl, nfl, mlb, ufc
const ESPN_EVENT_ID = "401234567";

const url = `https://site.api.espn.com/apis/site/v2/sports/${SPORT}/${LEAGUE}/summary?event=${ESPN_EVENT_ID}`;
const client = new ReclaimClient(APP_ID, APP_SECRET);

const proof = await client.zkFetch(url, { method: "GET" }, {
  responseMatches: [
    { type: "regex", value: "\"homeAway\"\\s*:\\s*\"home\"[\\s\\S]{0,300}?\"score\"\\s*:\\s*\"(?<home_score>\\d+)\"" },
    { type: "regex", value: "\"homeAway\"\\s*:\\s*\"away\"[\\s\\S]{0,300}?\"score\"\\s*:\\s*\"(?<away_score>\\d+)\"" },
    { type: "regex", value: "\"name\"\\s*:\\s*\"(?<event_status>STATUS_[A-Z_]+)\"" },
  ],
});

// Extract scores from proof context
const context = JSON.parse(proof.claimData.context);
const { home_score, away_score, event_status } = context.extractedParameters;

console.log(`Score: ${home_score}:${away_score} (${event_status})`);

// Build contract-compatible proof structure
const contractProof = {
  claim_info: {
    provider: proof.claimData.provider,
    parameters: typeof proof.claimData.parameters === "string"
      ? proof.claimData.parameters
      : JSON.stringify(proof.claimData.parameters),
    context: typeof proof.claimData.context === "string"
      ? proof.claimData.context
      : JSON.stringify(proof.claimData.context),
  },
  signed_claim: {
    claim: {
      identifier: proof.claimData.identifier,
      owner: proof.claimData.owner,
      epoch: proof.claimData.epoch || 1,
      timestamp_s: proof.claimData.timestampS || Math.floor(Date.now() / 1000),
    },
    signatures: proof.signatures || [],
  },
};

// Build oracle result (determine winner from scores)
const home = parseInt(home_score);
const away = parseInt(away_score);
let winning_outcome;
if (home > away) winning_outcome = 0;       // Home team wins
else if (away > home) winning_outcome = 1;   // Away team wins
else winning_outcome = 2;                     // Draw (if applicable)

const oracleResult = JSON.stringify({
  winning_outcome,
  confidence: 1.0,
  reasoning: `Score ${home}:${away}`,
  home_score: home,
  away_score: away,
  event_status,
});

// Output the full call arguments
const args = {
  market_id: 5,  // <-- change to your market ID
  proof: contractProof,
  oracle_result: oracleResult,
};

console.log("\n--- NEAR CLI command ---");
console.log(`near call nearcast-oracle.testnet resolve_with_reclaim_proof '${JSON.stringify(args)}' --accountId YOUR_ACCOUNT.testnet --gas 300000000000000 --deposit 0 --networkId testnet`);
```

#### Step 2: Call the Contract

```bash
node generate-proof.mjs
```

Copy the output NEAR CLI command and execute it. Or paste the JSON args into NEAR Explorer (nearblocks.io) under the contract's Write methods.

#### What the Contract Verifies

1. Market exists and has ESPN event ID
2. Market status is "active" or "closed"
3. Resolution time has passed
4. Proof parameters contain the correct ESPN event ID
5. **On-chain verification**: cross-contract call to `reclaim-protocol.testnet/verify_proof`
6. Scores from proof context match the oracle_result
7. Calls `apply_resolution` to finalize

**No caller check** — any NEAR account can submit a valid proof.

## Features

- **Prediction Markets** — create and bet on sports event outcomes
- **Dual Oracle** — OutLayer TEE + Reclaim zkTLS for permissionless resolution
- **Sports Data** — real match schedules via ESPN API (free, no key required)
- **AI Market Generation** — AI creates market questions, outcomes, and deadlines
- **NEAR Wallet** — connect via MyNearWallet, deposit/withdraw balance
- **i18n** — Russian / English interface
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
│       ├── outlayer-relayer.js # OutLayer TEE resolution
│       ├── reclaim-resolver.js # Reclaim zkTLS resolution
│       ├── oracle.js          # Legacy AI oracle (disabled)
│       ├── ai-client.js       # Venice AI client
│       ├── market-validator.js # Sports config, AI market generation
│       ├── sports-api.js      # ESPN API integration
│       └── spending-tracker.js # API budget tracking
├── frontend/
│   ├── App.jsx                # React SPA (single-file)
│   ├── near-wallet.js         # NEAR Wallet Selector wrapper
│   └── index.html
├── contract-rs/               # NEAR smart contract (Rust)
├── scripts/
│   └── seed-markets.js        # Create markets from ESPN schedule
├── vite.config.js
└── package.json
```

**Stack:** Express + React 18 + NEAR API JS + Vite + SQLite

## Getting Started

### Prerequisites

- Node.js 18+
- NEAR testnet account with deployed contract

### Environment Variables

Create a `.env` file in the project root:

```env
# NEAR
NEAR_NETWORK=testnet
NEARCAST_CONTRACT=nearcast-oracle.testnet

# Oracle account (for backend resolution triggers)
ORACLE_ACCOUNT_ID=your-oracle.testnet
ORACLE_PRIVATE_KEY=ed25519:...

# Reclaim Protocol (for zkTLS proof generation)
RECLAIM_APP_ID=...
RECLAIM_APP_SECRET=...

# Venice AI (for market generation)
VENICE_API_KEY=your-venice-key
AI_MODEL=claude-sonnet-45
```

### Development

```bash
npm install
npm run dev
```

Starts backend (port 4001) and frontend dev server (port 3001) concurrently.

### Build Contract

```bash
cd contract-rs
bash build.sh    # cargo build + wasm-opt post-processing
```

Requires Rust toolchain with `wasm32-unknown-unknown` target and `wasm-opt` (install via `npm install -g binaryen`).

### Seed Markets

```bash
node scripts/seed-markets.js --limit 30
```

Creates markets from real ESPN schedule (7 days ahead).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/near-config` | NEAR network config |
| GET | `/api/markets` | List markets (`status`, `category`) |
| GET | `/api/markets/:id` | Market details |
| GET | `/api/markets/:id/odds` | Market odds |
| GET | `/api/markets/:id/bets` | Bets on a market |
| GET | `/api/user/:accountId/bets` | User's bets |
| GET | `/api/balance/:accountId` | Platform balance |
| GET | `/api/stats` | Platform statistics |
| GET | `/api/sports-config` | Available sports/leagues |
| POST | `/api/upcoming-matches` | Match schedule |
| POST | `/api/generate-market` | AI market generation |
| POST | `/api/trigger-espn-resolution/:id` | Trigger OutLayer resolution |
| POST | `/api/trigger-reclaim-resolution/:id` | Trigger zkTLS resolution |

## Contracts & Infrastructure

| Component | Address / Repo | Description |
|-----------|---------------|-------------|
| Smart Contract | `nearcast-oracle.testnet` | Rust, NEAR SDK 5.6, prediction markets + dual oracle |
| ESPN Worker | [loca555/nearcast-espn-oracle](https://github.com/loca555/nearcast-espn-oracle) | WASI P2 WASM, runs in OutLayer TEE |
| OutLayer | `outlayer.testnet` | Verifiable off-chain compute (Intel TDX) |
| Reclaim Protocol | `reclaim-protocol.testnet` | On-chain ZK proof verification |

## Research

- [LLM Oracle With Data Provenance](docs/llm-oracle-provenance.md) — theoretical protocol for resolving prediction markets using deterministic LLMs with cryptographic data provenance (TLS-notary, DECO, ZK proofs)

## License

MIT
