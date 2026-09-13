# Base Deployment — OptionCore

This document describes the Base-only deployment architecture of OptionCore. It
complements `MASTER_ARCHITECTURE.md` (the full design specification) and
`DECISIONS.md` (the resolved/open question register) with the operational
specifics of running the protocol exclusively on Base.

## Why Base-only

The core protocol contracts (`src/`) are chain-agnostic — they use dynamic
`block.chainid` for EIP-712 domain separators, account derivation, and lifecycle
checks. However, the conceptual "mainnet hub" (Mode B/C in `DECISIONS.md` Q9)
was never built. OptionCore's liquidity discovery layer is a set of **signed
EIP-712 profile blobs** stored in an application-side database, not an on-chain
registry. This means the protocol can run on any single EVM chain without any
cross-chain infrastructure, and Base is that chain.

Base was chosen for:
- Low gas cost (L2 execution environment, ~$0.01 per ERC-20 transfer)
- Mature infrastructure (Chainlink oracles, Uniswap V3 deployed and liquid)
- Growing DeFi ecosystem

## Deployed Infrastructure

All contracts deploy to a single Base instance. The adapter layer is already
fork-verified against live Base mainnet infrastructure (`test/fork/BaseFork.t.sol`):

| Component | Address source | Notes |
|---|---|---|
| `ChainlinkPriceOracleAdapter` | Chainlink ETH/USD on Base | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |
| `UniswapV3VenueAdapter` | Uniswap V3 SwapRouter02 on Base | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| `PositionManager` | Deployed by `script/deploy-local.sh` | Core mint orchestrator + ERC-721 ledger |
| `PositionAccount` | Created per-position by PositionManager | Holds collateral, executes settlement |
| `ConditionArbiter` | Deployed once | ERC-1271 arbiter for automated settlement |
| `LPRouter` | Deployed once | Multi-LP aggregation (up to 8 backers) |

## Liquidity Discovery — SQLite

LP profiles and backer quotes are stored in a local **SQLite database**
(`better-sqlite3`) instead of browser `localStorage`. This provides:

- **Shared order book**: All clients see the same profiles, not just the browser
  that created them.
- **Indexed queries**: Profiles can be filtered by collateral asset, LP address,
  duration range, and remaining capacity.
- **Persistence**: Profiles survive browser refreshes and server restarts.
- **Competitive moat**: The profile database is proprietary application state,
  not replicated on-chain.

### Schema

```
profiles: profile_hash, lp, collateral, settlement, min/max_hours,
          total_units, price_per_unit, option_type, signed_blob, invalidated

quotes:   quote_hash, backer, collateral, settlement, min/max_hours,
          max_units, price_per_unit, option_type, signed_blob, invalidated
```

### API Routes

| Route | Method | Description |
|---|---|---|
| `/api/profiles` | GET | List active profiles (optional `?collateral=` filter) |
| `/api/profiles` | POST | Insert a signed profile |
| `/api/profiles/[hash]` | DELETE | Soft-delete a profile |
| `/api/quotes` | GET | List active backer quotes |
| `/api/quotes` | POST | Insert a signed quote |
| `/api/quotes/[hash]` | DELETE | Soft-delete a quote |
| `/api/seed` | POST | Bulk-insert seed profiles/quotes |

### Capacity Enrichment

The frontend reads `consumedUnits` from `PositionManager` and
`consumedUnitsForQuote` from `LPRouter` on each page load, combining them with
the SQLite-stored `totalUnits`/`maxUnits` to show **remaining capacity** in the
market view. This is a client-side join, not a background poller — simple and
accurate for the current scale.

## Deployment Target

Recommended infrastructure for early-stage deployment:

- **VPS**: Hetzner CX22 (~€4/mo) or equivalent — 2 vCPU, 4 GB RAM
- **Stack**: Node.js 20+ running the Next.js app with `better-sqlite3`
- **Storage**: SQLite file at `app/data/profiles.db` (WAL mode, NORMAL sync)
- **No managed database**: SQLite is in-process, no connection pool or network hop

## What's Not Deployed

- **Mainnet hub** (Q9 Mode B/C): Never built. Liquidity discovery is app-side SQLite.
- **Cross-chain replication**: Not needed for a single-chain deployment.
- **Arbitrum adapters**: Q9's L1-fee items are moot — Base-only.

## Running Locally

```bash
# Full local devnet: Anvil fork + deploy + seed + frontend + console
./script/dev.sh

# Or manually:
anvil --fork-url https://mainnet.base.org
./script/deploy-local.sh
cd app && npm run dev
./script/seed-liquidity.sh
```

The seed script POSTs profiles/quotes directly to the running app's
`/api/seed` endpoint, which inserts them into SQLite.

## Mainnet Deployment Readiness Checklist

### 1. Smart Contracts & Security Verification
- [x] **NatSpec Documentation**: Full NatSpec comments (`@notice`, `@param`, `@return`, `@dev`) and `@author parseb` tags added across all core smart contracts (`PositionManager`, `PositionAccount`, `LPRouter`, `ConditionArbiter`, `AuthzModule`).
- [x] **Unit & Integration Test Suite**: Passed 100% of unit, arbiter, authz, router, position account, and gas tests via `forge test`.
- [x] **Fork Verification**: Verified protocol functionality against live Base Mainnet fork (`test/fork/BaseFork.t.sol`).
- [x] **Deployment Automation**: Created `script/DeployMainnet.s.sol` and `script/deploy-mainnet.sh` supporting automated deployment and contract verification on Base.

### 2. API & Infrastructure Security
- [x] **Sliding-Window Rate Limiting**: Integrated `app/src/lib/rateLimit.ts` returning standard `X-RateLimit-*` headers across all API routes (`/api/profiles`, `/api/quotes`, `/api/agents/*`, `/api/seed`).
- [x] **EIP-712 Cryptographic Signature Verification**: Implemented EIP-712 signature verification (`app/src/lib/profileValidation.ts`) via `viem` to guarantee quote and liquidity profile authenticity.
- [x] **Staleness Validation & Self-Healing DB**: Automatic filtering and SQLite soft-deletion (`invalidated = 1`) of stale or malformed liquidity entries during retrieval and pre-ingestion checks.
- [x] **Agent x402 Payment Integration**: Endpoint rate limiting and input validation applied to AI agent allocation and mint endpoints (`/api/agents/allocate`, `/api/agents/mint`).

### 3. Production Environment & Pre-Flight
- [x] **Environment Configuration**: Created `.env.example` defining all required Base Mainnet RPC URLs, deployer private key placeholders, fee vault address, and BaseScan API keys.
- [x] **Next.js Production Build**: Verified production build status (`npm run build`) with zero compilation errors.
- [ ] **RPC Endpoint Provisioning**: Populate `.env` with live Base Mainnet RPC URL (e.g. Alchemy, QuickNode, or public RPC).
- [ ] **Deployer Funding**: Fund `DEPLOYER_PRIVATE_KEY` wallet with Base Mainnet ETH for contract deployment gas.
- [ ] **Fee Vault Setup**: Verify multisig/wallet address for `FEE_VAULT` to receive protocol fee shares.
- [ ] **Contract Deployment**: Execute `./script/deploy-mainnet.sh` and update `app/src/config/addresses.ts` with deployed contract addresses.

See [`BASE_DEPLOYMENT_CHECKLIST.md`](file:///home/pb/Desktop/OPTIONS/OptionCore-base/BASE_DEPLOYMENT_CHECKLIST.md) for the complete, step-by-step operational checklist and verification runbook.

