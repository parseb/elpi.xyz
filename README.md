# elpi (alpha.elpi.xyz) × Uniswap v4

[![Foundry Tests](https://img.shields.io/badge/Foundry-83%2F83%20Passed-brightgreen)](test/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Protocol](https://img.shields.io/badge/Live%20Dapp-elpi.xyz-ff007a)](https://elpi.xyz)

**[elpi (https://alpha.elpi.xyz)](https://alpha.elpi.xyz)** is a decentralized options protocol built on fixed agreements over disclosed risks. This repository provides the complete open-source Uniswap v4 integration (`OH_UNISWAP`), enabling flash-accounting settlement swaps and LP idle capital staging in Uniswap v4 pools.

---

## Submission Checklist

- **Public Open-Source Repository:** [https://github.com/parseb/elpi.xyz](https://github.com/parseb/elpi.xyz)
- **Developer Feedback File:** [`FEEDBACK.md`](./FEEDBACK.md) | [GitHub Direct Link](https://github.com/parseb/elpi.xyz/blob/master/FEEDBACK.md)
- **Uniswap Developer Feedback Form:** Submit via [https://developers.uniswap.org/hackathon-feedback](https://developers.uniswap.org/hackathon-feedback) including the link to `FEEDBACK.md`.

---

## Uniswap v4 Integration: Key Contracts & Line References

Reviewers and auditors can verify the Uniswap v4 integration through the following contracts and code locations:

### 1. `UniswapV4VenueAdapter.sol` — Flash-Accounting Execution Venue
**File:** [`src/adapters/UniswapV4VenueAdapter.sol`](src/adapters/UniswapV4VenueAdapter.sol)  
Implements `ISettlementVenue` and `IUnlockCallback`. Executes option settlement swaps using Uniswap v4 flash accounting with zero persistent token custody (strictly enforcing Invariant I1).

- **Route Registration (`registerRoute`):** [Lines 110–128](src/adapters/UniswapV4VenueAdapter.sol#L110-L128)  
  Registers canonical `PoolKey` under `routeId = keccak256(abi.encode(PoolKey))`, enforcing append-only immutability (Invariant I2).
- **Swap Entrypoint (`swap`):** [Lines 142–173](src/adapters/UniswapV4VenueAdapter.sol#L142-L173)  
  Pulls `tokenIn` transiently from calling `PositionAccount` and triggers `poolManager.unlock()`.
- **Flash Accounting Callback (`unlockCallback`):** [Lines 200–243](src/adapters/UniswapV4VenueAdapter.sol#L200-L243)  
  - *Caller Guard:* Verifies caller is canonical `poolManager` ([Line 201](src/adapters/UniswapV4VenueAdapter.sol#L201)).
  - *V4 Swap:* Invokes `poolManager.swap(...)` with exact-input `SwapParams` ([Lines 212–220](src/adapters/UniswapV4VenueAdapter.sol#L212-L220)).
  - *Slippage Enforcement:* Re-verifies `amountOut >= minAmountOut` ([Line 230](src/adapters/UniswapV4VenueAdapter.sol#L230)).
  - *Settlement Flow:* Calls `poolManager.sync()`, transfers tokenIn, and calls `poolManager.settle()` ([Lines 234–236](src/adapters/UniswapV4VenueAdapter.sol#L234-L236)).
  - *Zero-Custody Delivery:* Calls `poolManager.take()` to deliver `tokenOut` directly to the `PositionAccount` without intermediary hops ([Line 240](src/adapters/UniswapV4VenueAdapter.sol#L240)).

### 2. `V4LiquidityVault.sol` — LP Idle Collateral Staging
**File:** [`src/periphery/V4LiquidityVault.sol`](src/periphery/V4LiquidityVault.sol)  
LP-managed vault that stages uncommitted option collateral in Uniswap v4 concentrated liquidity pools to earn trading fees between options, extracting to raw ERC-20 at mint and re-staking upon settlement.

- **LP Deposit & Withdraw:** [`deposit`](src/periphery/V4LiquidityVault.sol#L161-L169) and [`withdraw`](src/periphery/V4LiquidityVault.sol#L174-L182).
- **1-Tx Atomic Extraction (`extractForMint`):** [Lines 193–201](src/periphery/V4LiquidityVault.sol#L193-L201)  
  Called by authorized `LPRouter` during `matchAndMint`; pulls liquidity from v4 and sends raw ERC-20 to router without approvals.
- **Post-Settlement Auto-Restake (`onPositionSettled`):** [Lines 212–227](src/periphery/V4LiquidityVault.sol#L212-L227)  
  Implements `ILPSettlementHook`; called within gas-isolated `try/catch` (`LP_HOOK_GAS = 300,000`), restaking proceeds or holding in `pendingAsset` on failure.
- **Router Payout Restake (`restakeFromRouter`):** [Lines 254–270](src/periphery/V4LiquidityVault.sol#L254-L270).
- **ERC-1271 Smart Contract Backer Signatures (`isValidSignature`):** [Lines 280–284](src/periphery/V4LiquidityVault.sol#L280-L284).
- **V4 Liquidity Unlock Operations (`unlockCallback`):** [Lines 292–304](src/periphery/V4LiquidityVault.sol#L292-L304)  
  Dispatches `_handleAddLiquidity` ([Lines 320–342](src/periphery/V4LiquidityVault.sol#L320-L342)) and `_handleRemoveLiquidity` ([Lines 345–361](src/periphery/V4LiquidityVault.sol#L345-L361)) via `poolManager.modifyLiquidity()`.

### 3. `V4LPRouterRestaker.sol` — Atomic Router Restaker
**File:** [`src/periphery/V4LPRouterRestaker.sol`](src/periphery/V4LPRouterRestaker.sol)  
- **Batch Restake:** [`batchRestake`](src/periphery/V4LPRouterRestaker.sol#L49-L58) for multi-vault restaking.
- **Atomic Settlement & Restake:** [`settleAndRestake`](src/periphery/V4LPRouterRestaker.sol#L66-L85) settles options and restakes capital into Uniswap v4 in a single transaction.

### 4. `PositionAccount.sol` — Core Protocol Integration Points
**File:** [`src/PositionAccount.sol`](src/PositionAccount.sol)  
- **Venue Swap Execution:** [`_swapViaVenue`](src/PositionAccount.sol#L96-L99).
- **Settlement Swap & In-Kind Fallback:** [`settleToTaker`](src/PositionAccount.sol#L150-L173).
- **LP Settlement Hook Notification:** [`settleToLp`](src/PositionAccount.sol#L214-L221) and [`mutualUnwind`](src/PositionAccount.sol#L228-L235).

### 5. Deployment & Stack Scripts
**File:** [`script/DeployV4Stack.s.sol`](script/DeployV4Stack.s.sol)  
Deploys `PoolManager`, `UniswapV4VenueAdapter`, registers the canonical pool route, and deploys `V4LiquidityVault` ([Lines 82–114](script/DeployV4Stack.s.sol#L82-L114)).

---

## Test Suite & Verification

The integration is covered by **83 passing tests** across 17 test suites, including unit, fuzz, invariant, and fork tests.

```bash
# Build contracts
forge build

# Run all 83 tests (unit, fuzz, invariant, fork)
forge test

# Run handler-based invariant fuzzing (64 runs x 2048 calls = 131,072 calls, 0 reverts)
forge test --match-contract UniswapV4InvariantTest -vv

# Check formatting
forge fmt --check
```

### Invariant Test Results (`test/invariant/UniswapV4Invariant.t.sol`)
- **`invariant_I1_adapterZeroPersistentBalance`**: 2,048 calls, 0 reverts — adapter balance is always 0.
- **`invariant_I2_routeImmutability`**: 2,048 calls, 0 reverts — registered routes cannot be mutated.
- **`invariant_I3_vaultPendingAssetNonNegative`**: 2,048 calls, 0 reverts — vault restake accounting is strictly non-negative.
