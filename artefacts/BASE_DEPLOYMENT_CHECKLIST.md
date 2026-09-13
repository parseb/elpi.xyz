# OptionCore — Base Mainnet Deployment Checklist

This document is the canonical operational checklist for deploying **OptionCore** to **Base Mainnet** (`chainId: 8453`) or **Base Sepolia** (`chainId: 84532`).

---

## Deployment Summary & Target Topology

| Component | Target Network | Implementation / Source |
|---|---|---|
| **Target Chain** | Base Mainnet | Chain ID `8453` (`https://mainnet.base.org`) |
| **ERC-6551 Registry** | Base Mainnet | `0x000000006551c19487814612e58FE06813775758` |
| **Settlement Asset** | Canonical USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| **Collateral Asset (WETH)** | Canonical WETH | `0x4200000000000000000000000000000000000006` |
| **Collateral Asset (WBTC)** | Canonical WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` |
| **Chainlink ETH/USD Feed** | Base Mainnet | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |
| **Chainlink BTC/USD Feed** | Base Mainnet | `0xcCa4841320c37E68674D3204ef36234Fd660608C` |
| **Uniswap V3 SwapRouter02** | Base Mainnet | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| **Order Book Storage** | Host SQLite | `better-sqlite3` at `app/data/profiles.db` |

---

## Checklist Index

- [Phase 1: Pre-Deployment & Environment Preparation](#phase-1-pre-deployment--environment-preparation)
- [Phase 2: Smart Contract Deployment & Verification](#phase-2-smart-contract-deployment--verification)
- [Phase 3: Frontend & Client Configuration](#phase-3-frontend--client-configuration)
- [Phase 4: SQLite Database & Server Infrastructure](#phase-4-sqlite-database--server-infrastructure)
- [Phase 5: Post-Deployment Verification & Live Smoke Test](#phase-5-post-deployment-verification--live-smoke-test)
- [Phase 6: Monitoring, Operations & Emergency Procedures](#phase-6-monitoring-operations--emergency-procedures)

---

## Phase 1: Pre-Deployment & Environment Preparation

### 1.1 Security & Access Controls
- [ ] **1.1.1 Deployer Wallet**: Dedicated deployment wallet created; private key kept secure and never committed to version control.
- [ ] **1.1.2 Deployer Gas Funding**: Funded deployer address with ~0.05–0.1 ETH on Base Mainnet for contract deployment and verification gas.
- [ ] **1.1.3 Protocol Fee Vault**: Dedicated multi-sig (e.g. Safe on Base) or hardware cold wallet confirmed as `FEE_VAULT`.
- [ ] **1.1.4 BaseScan API Key**: Obtained BaseScan / Etherscan API key for automated source code verification.

### 1.2 Environment Configuration (`.env`)
- [ ] **1.2.1 Copy Configuration Template**:
  ```bash
  cp .env.example .env
  ```
- [ ] **1.2.2 Populate Core Parameters**:
  - `MAINNET_RPC_URL`: Dedicated production RPC URL (Alchemy / QuickNode / Infura / `https://mainnet.base.org`).
  - `CHAIN_ID`: `8453`
  - `NEXT_PUBLIC_CHAIN_ID`: `8453`
  - `DEPLOYER_PRIVATE_KEY`: `0x...`
  - `FEE_VAULT`: Verified protocol treasury / Safe address.
  - `BASESCAN_API_KEY`: API key for verification.
  - `DATABASE_PATH`: `data/profiles.db`
- [ ] **1.2.3 Audit Asset & Infrastructure Overrides**:
  - Confirm `WETH_ADDRESS`, `USDC_ADDRESS`, `WBTC_ADDRESS` match Base canonical contracts.
  - Confirm `ETH_USD_FEED`, `BTC_USD_FEED`, `UNISWAP_V3_ROUTER` match live Base contracts.

### 1.3 Pre-Flight Test & Lint Quality Gates
Run all gates locally and ensure 100% green passing status before broadcasting:

- [ ] **1.3.1 Contract Compilation**:
  ```bash
  forge build
  ```
- [ ] **1.3.2 Unit & Regression Test Suite**:
  ```bash
  forge test
  ```
- [ ] **1.3.3 Live Base Mainnet Fork Verification**:
  ```bash
  BASE_RPC_URL="$MAINNET_RPC_URL" forge test --match-contract BaseForkTest -vv
  ```
- [ ] **1.3.4 Invariant & Fuzz Campaign**:
  ```bash
  forge test --match-contract PositionInvariantsTest -vv
  ```
- [ ] **1.3.5 Gas Gate Verification**:
  ```bash
  forge test --match-contract GasGateTest -vv
  ```
- [ ] **1.3.6 Static Analysis & Architecture Lints**:
  ```bash
  ./script/lints/run-all.sh
  ```

---

## Phase 2: Smart Contract Deployment & Verification

### 2.1 Broadcast Execution
- [ ] **2.1.1 Execute Mainnet Deployment Script**:
  ```bash
  ./script/deploy-mainnet.sh
  ```
  *(Alternatively: `forge script script/DeployMainnet.s.sol --rpc-url "$MAINNET_RPC_URL" --broadcast --verify --etherscan-api-key "$BASESCAN_API_KEY" -vvv`)*

### 2.2 Deployment Artifact & Order Confirmation
Verify that all contracts deployed in the correct sequence and addresses are captured in `script/output/mainnet-base.json`:

- [ ] **2.2.1 `AuthzModule`**: Authorization module for ERC-1271 & position checks.
- [ ] **2.2.2 `PositionAccount` (Implementation)**: Deployed with `AuthzModule` and `FEE_VAULT`.
- [ ] **2.2.3 `ConditionArbiter`**: Arbiter for condition evaluations.
- [ ] **2.2.4 Standard Conditions**:
  - `ExpiryCondition`
  - `TakerProfitCondition`
  - `DustCondition`
  - `NeverCondition`
- [ ] **2.2.5 `PositionManager`**: ERC-721 manager and mint orchestrator pointing to `PositionAccount` implementation.
- [ ] **2.2.6 `LPRouter`**: Multi-LP aggregation router pointing to `PositionManager`.
- [ ] **2.2.7 Adapters**:
  - `ChainlinkPriceOracleAdapter` (WETH/USDC)
  - `ChainlinkPriceOracleAdapter` (WBTC/USDC)
  - `UniswapV3VenueAdapter` (Uniswap V3 SwapRouter02)

### 2.3 BaseScan Verification Check
- [ ] **2.3.1 Contract Verification**: Search every deployed address on [BaseScan](https://basescan.org) and confirm green checkmark (Source code verified).
- [ ] **2.3.2 Manual Verification (if needed)**:
  ```bash
  forge verify-contract <DEPLOYED_ADDRESS> <CONTRACT_NAME> --chain 8453 --etherscan-api-key "$BASESCAN_API_KEY"
  ```

---

## Phase 3: Frontend & Client Configuration

### 3.1 Address & ABI Synchronization
- [ ] **3.1.1 Copy Mainnet Addresses**:
  ```bash
  cp script/output/mainnet-base.json app/src/generated/addresses.json
  ```
- [ ] **3.1.2 Sync ABIs**:
  ```bash
  ./script/sync-frontend.sh
  ```
- [ ] **3.1.3 Verify Address Mapping**:
  Inspect `app/src/config/addresses.ts` to confirm `addresses` exports point to the generated mainnet addresses.

### 3.2 Chain & Wallet Configuration
- [ ] **3.2.1 Target Chain Setting**:
  Ensure production environment has:
  ```bash
  NEXT_PUBLIC_TARGET_CHAIN=base
  NEXT_PUBLIC_CHAIN_ID=8453
  ```
- [ ] **3.2.2 Wagmi Chain Configuration**:
  Verify `app/src/config/wagmi.ts` and `app/src/config/chain.ts` resolve `targetChain` to `base` (Base Mainnet) rather than `anvilLocal`.

### 3.3 Next.js Production Build Gate
- [ ] **3.3.1 TypeScript & Next.js Build**:
  ```bash
  cd app && npm run build
  ```
- [ ] **3.3.2 Zero Build Errors**: Ensure 0 compilation, typecheck, or bundling errors.

---

## Phase 4: SQLite Database & Server Infrastructure

### 4.1 Server Runtime & Directory Preparation
- [ ] **4.1.1 Node.js Runtime**: Node.js 20+ LTS installed on production host.
- [ ] **4.1.2 Data Directory**: Ensure `app/data/` exists and has read/write permissions for the application process.
- [ ] **4.1.3 SQLite File Location**: Database file resolves to `app/data/profiles.db`.

### 4.2 SQLite Performance & Persistence
- [ ] **4.2.1 WAL Mode Enabled**: Confirm SQLite is operating in WAL mode (`PRAGMA journal_mode = WAL;`) with `PRAGMA synchronous = NORMAL;`.
- [ ] **4.2.2 Automated DB Backup**: Configure daily cron / backup snapshot of `app/data/profiles.db` to cold storage / offsite backup.

### 4.3 API Route & Cryptographic Security
- [ ] **4.3.1 Rate Limiting**: Confirm `app/src/lib/rateLimit.ts` sliding-window limiter is active on `/api/profiles`, `/api/quotes`, and `/api/agents/*`.
- [ ] **4.3.2 EIP-712 Signature Validation**: Confirm `app/src/lib/profileValidation.ts` verifies signatures with `chainId: 8453` and correct `PositionManager` / `LPRouter` verifying contracts.
- [ ] **4.3.3 Staleness Soft-Deletion**: Verify that invalid or expired profiles are flagged with `invalidated = 1` during retrieval and ingestion.

### 4.4 Genesis Liquidity Onboarding (Optional)
- [ ] **4.4.1 LP Signing**: Have initial LPs sign their EIP-712 profile blobs against Base Mainnet contracts.
- [ ] **4.4.2 Ingestion**: POST signed profiles to `/api/profiles` or batch seed via `/api/seed`.

---

## Phase 5: Post-Deployment Verification & Live Smoke Test

### 5.1 On-Chain Read Verification (via `cast call` or BaseScan)
- [ ] **5.1.1 PositionManager Implementation Check**:
  ```bash
  cast call <POSITION_MANAGER_ADDRESS> "accountImplementation()(address)" --rpc-url "$MAINNET_RPC_URL"
  ```
  *Must match deployed `PositionAccount` implementation.*
- [ ] **5.1.2 LPRouter PositionManager Check**:
  ```bash
  cast call <LP_ROUTER_ADDRESS> "positionManager()(address)" --rpc-url "$MAINNET_RPC_URL"
  ```
  *Must match deployed `PositionManager`.*
- [ ] **5.1.3 Fee Vault Verification**:
  ```bash
  cast call <POSITION_ACCOUNT_IMPL_ADDRESS> "feeVault()(address)" --rpc-url "$MAINNET_RPC_URL"
  ```
  *Must match configured `FEE_VAULT`.*
- [ ] **5.1.4 Chainlink Oracle Adapter Read**:
  ```bash
  cast call <WETH_ORACLE_ADAPTER_ADDRESS> "getPrice()(uint256,uint8)" --rpc-url "$MAINNET_RPC_URL"
  ```
  *Must return non-zero price and 6 decimals (matching USDC settlement).*

### 5.2 Micro-Transaction Smoke Test
Execute a test flow with minimal capital to validate end-to-end functionality:

- [ ] **5.2.1 LP Profile Creation**: LP signs a 1-day WETH put profile (e.g. 0.001 WETH capacity).
- [ ] **5.2.2 Taker Mint**: Taker mints 1 micro-position via `PositionManager.mint(...)`.
- [ ] **5.2.3 Token Bound Account (TBA) Verification**: Confirm ERC-6551 account address received the collateral WETH.
- [ ] **5.2.4 ERC-721 NFT Verification**: Confirm taker received the Position ERC-721 token.
- [ ] **5.2.5 Settlement / Unwind Execution**:
  - Trigger `settleToTaker` or `mutualUnwind`.
  - Confirm collateral/payout distribution.
  - Confirm protocol fee arrived at `FEE_VAULT`.

---

## Phase 6: Monitoring, Operations & Emergency Procedures

### 6.1 Alerts & Telemetry
- [ ] **6.1.1 On-Chain Event Webhooks**: Configured Alchemy / Tenderly / OpenZeppelin Defender alerts for:
  - `PositionMinted`
  - `PositionSettled`
  - `PositionUnwound`
  - `ApprovalRecorded`
- [ ] **6.1.2 Application Error Tracking**: Sentry / Datadog configured for Next.js app and API endpoints.
- [ ] **6.1.3 Host Metrics**: CPU, RAM, Disk usage, and SQLite database file size alerts.

### 6.2 L2 & Oracle Health Monitoring
- [ ] **6.2.1 Sequencer Health**: Track Base L2 sequencer uptime feed.
- [ ] **6.2.2 Oracle Freshness**: Monitor Chainlink ETH/USD and BTC/USD round updates against `CADENCE_HINT` (30 minutes).

### 6.3 Emergency Protocol & Runbook
- [ ] **6.3.1 LP Self-Revocation**: Documented procedure for LPs to soft-delete profiles via API `DELETE /api/profiles/[hash]` or cancel on-chain nonces.
- [ ] **6.3.2 UI Maintenance Banner**: Protocol operators have capability to enable read-only / maintenance mode on frontend.
- [ ] **6.3.3 Incident Response Channels**: Internal war room channel and security disclosure contact ready.

---

## Sign-Off Matrix

| Role | Name / Address | Date | Status |
|---|---|---|---|
| **Lead Engineer** | | | [ ] APPROVED |
| **Security Reviewer** | | | [ ] APPROVED |
| **DevOps / Infra Lead** | | | [ ] APPROVED |
| **Treasury / Multi-sig Signer** | | | [ ] APPROVED |
