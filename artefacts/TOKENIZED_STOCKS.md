# Base Tokenized Stocks (B20) Integration Guide

This document outlines the architectural compatibility, operational requirements, and curation standards for issuing and settling options on **Base Tokenized Stocks** (B20 standard) within the OptionCore protocol.

---

## 1. Overview of Base Tokenized Stocks & The B20 Standard

Coinbase and Base issue tokenized U.S. equities (e.g. **AAPL, NVDA, META, GOOGL**) on Base under an ADGM regulatory framework with 1:1 custody at Alpaca Securities.

### Core Technical Characteristics
* **Precompile Architecture:** B20 tokens are implemented as Base-native precompiles (`0xB20f...` factory) rather than standalone bytecode contracts, exposing standard ERC-20 method selectors (`transfer`, `transferFrom`, `balanceOf`, `decimals`, `approve`, `allowance`).
* **The Corporate Action Multiplier:** B20 uses an onchain `multiplier` variable to represent stock splits and dividends:
  $$\text{Scaled Balance} = \frac{\text{balanceOf}(\text{account}) \times \text{multiplier}}{10^{18}}$$
* **Oracle Feeds:** Chainlink provides official Total Return price feeds on Base combining equity share price and the B20 multiplier.

---

## 2. OptionCore Compatibility & Invariant Alignment

### A. The Multiplier vs. Rebasing (`DECISIONS.md` Q10)
* **The Invariant:** `PositionAccount` records collateral at mint (`Realized.recordedCollateral`) and deliberately never re-reads `balanceOf` during settlement (preventing fee-on-transfer and donation exploits).
* **Why B20 is Safe:** Traditional rebasing tokens modify `balanceOf` onchain without a transfer; a negative rebase causes `balanceOf(account) < recordedCollateral`, bricking settlement transfers. **B20 tokens NEVER modify `balanceOf` storage** when stock splits or dividends occur — they modify the `multiplier`.
* `PositionAccount` remains 100% solvent and executable across all corporate actions.

### B. Transfer Policy & Compliance Gating (`MASTER_ARCHITECTURE.md` §7.1)
* **Denylists (`isBlocked`, `paused`):** Fully compatible. Freshly generated ERC-6551 counterfactual accounts (`PositionAccount`) are never on denylists.
* **Allowlists:** Incompatible with per-position custody unless the token's allowlist policy allows transfers to arbitrary newly created contracts or whitelists the ERC-6551 proxy pattern.

### C. Oracle Feeds & Market Hours Handling (Q13 / OptionHood Bug #2)
* **Peg Disclosure (§3.4, Q6):** Chainlink equity feeds quote in `USD`, while OptionCore positions settle in `USDC`. `ChainlinkPriceOracleAdapter` must be deployed with `assumesPeg = true` and `peggedAsset = USDC`.
* **Cadence Hinting (Q13):** Equity markets close overnight and on weekends (>60 hours).
  * `ChainlinkPriceOracleAdapter` must declare a weekend-aware `cadenceHint` (e.g. `72 hours`).
  * `PositionManager` validates `pointers.maxPriceAge >= oracle.cadenceHint()`, preventing premature staleness reverts.

### D. Unit Scalars & Contract Sizing
* High-priced equities ($100–$1,000+) are traded via fractional unit scaling:
  $$\text{unitScalarNum} = 1, \quad \text{unitScalarDen} = 100 \implies 1\text{ Unit} = 0.01\text{ Shares}$$

---

## 3. Supported Settlement Venues on Base

| Venue | Adapter Contract | Route Identifier (`routeId`) |
|---|---|---|
| **Uniswap V3** | `UniswapV3VenueAdapter.sol` | Fee tier (e.g. `uint24(500)` for 0.05% pool) |
| **Aerodrome Slipstream** | `AerodromeVenueAdapter.sol` | Tick spacing (e.g. `int24(100)` or `int24(200)`) |

OptionCore's internal `_oracleFloor` calculation protects both LP remainder swaps and taker profit swaps against sandwich attacks or illiquid venue pools.

---

## 4. Onboarding Checklist for Curated Tokenized Stocks

1. **Verify Token Interface:** Confirm standard `decimals()` (typically 18) via `staticcall`.
2. **Verify Policy Model:** Confirm standard permissionless transfers on Base without mandatory recipient pre-allowlisting.
3. **Deploy Oracle Adapter:** Instantiate `ChainlinkPriceOracleAdapter(stockAddress, usdcAddress, chainlinkFeedAddress, usdcAddress, 72 hours)`.
4. **Deploy / Select Venue Adapter:** Confirm pool liquidity on Uniswap V3 or Aerodrome Slipstream.
5. **Run Fork Test:** Validate full mint $\to$ exercise $\to$ settle lifecycle in `test/fork/BaseTokenizedStocksFork.t.sol`.
