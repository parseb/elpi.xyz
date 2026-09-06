# elpi (elpi.xyz) — Asset Onboarding Guide

**Version:** 1.0 — Milestone UV4  
**Protocol:** elpi (https://elpi.xyz)  
**Execution Venue:** Uniswap v4 on Base (`OH_UNISWAP`)

---

## 1. Executive Summary & Philosophy

A position in **elpi (elpi.xyz)** is a fixed agreement between two consenting parties over disclosed risks with per-position custody (`artefacts/MASTER_ARCHITECTURE.md` §0). Every term—including strike, expiry, oracle, execution venue, and `routeId`—is committed at mint via CREATE2 address derivation and is immutable thereafter.

Historical options protocols suffered from **untradeable onboarded tickers**: pools existed on paper but lacked sufficient liquidity depth to clear settlement swaps, causing settlement reverts. 

elpi solves this through **Pillar III (Continuous Clearing Auctions - CCA)** and **Pillar IV (Pre-Trade Liquidity Gating)**:
1. **Continuous Clearing Auctions (CCA):** Uniform-price batch auction bootstraps fair price discovery and seeds the canonical Uniswap v4 pool directly at clearing price.
2. **`OptionSettlementHook` Auto-Registration:** All canonical settlement pools are configured with `fee = 0x800000` (`DYNAMIC_FEE_FLAG`) and `hooks = OptionSettlementHook` to enforce the 0 AMM fee waiver (Invariant I4).
3. **QuoterV2 Pre-Trade Liquidity Verification:** LP profiles and taker mints are gated against live pool depth before any position is minted.

---

## 2. Invariant Anchor Table

| Invariant | Requirement | How Onboarding Satisfies It |
|---|---|---|
| **I1 (Bounded Insolvency)** | Collateral lives in an account bound 1:1 to one position. | Staged pool liquidity is converted to raw ERC-20 prior to minting. PositionAccounts only ever hold raw ERC-20. |
| **I2 (Immutability)** | `routeId = keccak256(abi.encode(PoolKey))` is committed at mint. | `routeId` is derived deterministically from the seeded pool key and registered in `UniswapV4VenueAdapter`. Route registration is strictly append-only. |
| **I3 (Venue-Free Recovery)** | `settleToLp` via `ExpiryCondition` never touches the venue or oracle. | Expiry settlement executes with identical gas (67,838 gas) whether Uniswap v4 is liquid, paused, or drained. |
| **I4 (Fee Base Protection)** | 1% protocol fee is withheld strictly from taker profits. | Canonical pool is seeded with `DYNAMIC_FEE_FLAG` and `OptionSettlementHook`, waiving AMM swap fees (`overrideFee = 0`) on settlement. |

---

## 3. Step-by-Step Onboarding Pipeline

```
Step 0: Prerequisites ──> Step 1: CCA Setup ──> Step 2: Auction Monitor
                                                       │
Step 4: LP Profile  <──  Step 3: Pool Seeding <────────┘
```

### Step 0 — Prerequisite Verification

Before creating a pool or auction, the asset must satisfy three criteria:
1. **Target ERC-20 Token:** Deployed and verified on Base mainnet (e.g. WETH `0x4200000000000000000000000000000000000006`). Rebasing and fee-on-transfer tokens are strictly excluded.
2. **Chainlink Price Feed & Cadence Hint (Q13 Rule):**
   - A live Chainlink or Redstone oracle feed must exist for the asset/settlement pair on Base.
   - **`cadenceHint` must be measured from real on-chain round history—never guessed.**
   - All published LP profiles must configure `maxPriceAge >= oracle.cadenceHint()`.
3. **Settlement Asset:** Canonical Base USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).

---

### Step 1 — Continuous Clearing Auction (CCA) Setup

To prevent MEV sniping, front-running, and illiquid pools at launch, order accumulation occurs via Continuous Clearing Auctions:
- **Auction Duration:** Recommended $\ge 1\text{ hour}$ (minimum 1200 Base blocks) to allow multi-block uniform price formation.
- **Price Bounds:** Configure minimum and maximum price brackets around expected fair value.
- **Target Seeding Configuration:**
  - `fee`: `0x800000` (`DYNAMIC_FEE_FLAG`).
  - `tickSpacing`: `60`.
  - `hooks`: `OptionSettlementHook` address (`0x...C8`).

---

### Step 2 — Auction Execution & Monitoring

During the auction window:
- Orders accumulate over multiple blocks.
- The protocol clears all bids and asks at a single uniform clearing price at close.
- The companion app monitors auction status via the API route:
  ```http
  GET /api/cca/{auctionId}
  ```
- Anti-sniping protection ensures no single transaction receives preferential execution order.

---

### Step 3 — Pool Seeding & Route Registration

Upon auction close:
1. **Automated Pool Seeding:** CCA proceeds automatically seed the canonical Uniswap v4 pool at the uniform clearing price.
2. **Compute Route ID:**
   ```solidity
   PoolKey memory key = PoolKey({
       currency0: Currency.wrap(min(token, usdc)),
       currency1: Currency.wrap(max(token, usdc)),
       fee: 0x800000,
       tickSpacing: 60,
       hooks: OptionSettlementHook(hookAddress)
   });
   bytes32 routeId = keccak256(abi.encode(key));
   ```
3. **Register Route in Venue Adapter:**
   Call `UniswapV4VenueAdapter.registerRoute(key, "")`. Once registered, the route is committed and immutable (Invariant I2).

---

### Step 4 — Liquidity Profile Publication & Pre-Trade Gating

LPs publish signed EIP-712 `LiquidityProfile` blobs specifying:
- Collateral and settlement assets
- Minimum and maximum option duration (hours)
- Total units capacity and rate per unit per hour
- `routeId` derived in Step 3

**Pre-Trade Liquidity Verification (`verifySettlementLiquidity`):**
Before the app allows an LP profile to be signed or a taker to mint, the app calls `verifySettlementLiquidity`:
- Simulates the settlement swap via Uniswap v4 `QuoterV2` (`quoteExactInputSingle`).
- Evaluates price impact against the configured `slippageBps`.
- **Hard Gate:** If expected output is less than the oracle settlement floor (`expectedOutput < oracleFloor`), the profile or mint is **blocked** (displaying a 🔴 Red indicator).

---

## 4. UI Wizard Reference

The onboarding flow is fully automated in the elpi app at `/onboard`:
- **URL:** `https://elpi.xyz/onboard` (or `http://localhost:3000/onboard` locally)
- Guides deployers and LPs step-by-step through validation, auction parameters, status monitoring, pool seeding, and gated profile publication.
