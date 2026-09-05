# OH_UNISWAP_SPECIFICATION.md

**Document purpose:** End-to-end specification for integrating the Uniswap v4 ecosystem
(Uniswap v4 AMM, `IPoolManager` hooks, Continuous Clearing Auctions, and the Uniswap
Trading API) into OptionCore without violating any of the four invariants or requiring
changes to the verified core contracts (`PositionAccount`, `PositionManager`,
`AuthzModule`, `ConditionArbiter`, any `ICondition`).

**Working title:** OptionCore × Uniswap v4 ("OH_UNISWAP")

**Revision:** 1 — September 2026.

**Status:** Specification only. No source changes have been made.

---

## Table of Contents

0. [Philosophy: the constraint that shapes every decision](#0-philosophy)
1. [Invariant anchor table](#1-invariant-anchor-table)
2. [Integration map — what touches what](#2-integration-map)
3. [Pillar I — Uniswap v4 as execution venue](#3-pillar-i)
   - 3.1 [UniswapV4VenueAdapter](#31-uniswapv4venueadapter)
   - 3.2 [OptionSettlementHook](#32-optionsettlementhook)
   - 3.3 [routeId encoding for v4 pools](#33-routeid-encoding)
   - 3.4 [Caveats and failure modes](#34-caveats)
4. [Pillar II — V4-staged LP capital (idle yield)](#4-pillar-ii)
   - 4.1 [Capital flow overview](#41-capital-flow-overview)
   - 4.2 [V4LiquidityVault](#42-v4liquidityvault)
   - 4.3 [LPRouter integration](#43-lprouter-integration)
   - 4.4 [ILPSettlementHook auto-redeposit](#44-ilpsettlementhook-auto-redeposit)
   - 4.5 [Caveats](#45-caveats)
5. [Pillar III — CCA for asset onboarding](#5-pillar-iii)
   - 5.1 [What CCA solves for OptionCore](#51-what-cca-solves)
   - 5.2 [Onboarding flow](#52-onboarding-flow)
   - 5.3 [Clustered expiry batch clearing](#53-batch-clearing)
6. [Pillar IV — Uniswap Trading API in the app layer](#6-pillar-iv)
   - 6.1 [Pre-trade liquidity verification](#61-pre-trade-liquidity-verification)
   - 6.2 [Dynamic routeId selection](#62-dynamic-routeid-selection)
   - 6.3 [Premium estimation improvement](#63-premium-estimation)
7. [Implementation path — ordered milestones](#7-implementation-path)
8. [Testing strategy](#8-testing-strategy)
   - 8.1 [Unit tests](#81-unit-tests)
   - 8.2 [Fork tests](#82-fork-tests)
   - 8.3 [Invariant / fuzz campaign additions](#83-invariant-additions)
   - 8.4 [Gas-gate compliance](#84-gas-gate-compliance)
9. [Frontend, UX, and market chart guidance](#9-frontend-ux)
   - 9.1 [Market depth and price chart](#91-market-depth-and-price-chart)
   - 9.2 [Mint flow UX additions](#92-mint-flow-ux)
   - 9.3 [LP dashboard additions](#93-lp-dashboard)
   - 9.4 [Settlement flow UX](#94-settlement-flow-ux)
10. [Known caveats register](#10-known-caveats)
11. [Open questions](#11-open-questions)

---

## 0. Philosophy

OptionCore's thesis (MASTER_ARCHITECTURE.md §0):

> **A position is a fixed agreement between two consenting parties over disclosed risks.
> The protocol defines the position format, registers and coordinates counterparties,
> provides a referee, guarantees the taker the payout they were quoted, and takes 1% of
> profitable settlement. Every term — including which oracle and which venue — is fixed at
> mint by address derivation and is thereafter unchangeable by anyone.**

Every Uniswap v4 integration decision in this specification is checkable against that
sentence and the four invariants derived from it (§1). **If a proposed integration
requires touching a core contract, it must clear a very high bar: it may only add a
generic, router-agnostic seam, never router-specific logic.** The one precedent in the
codebase is `ILPSettlementHook` — a best-effort notification with a gas cap and a
`try/catch`, not a gating dependency.

**Three natural extension points exist. The entire Uniswap integration lives inside them:**

| Extension point | Contract | How it is used here |
|---|---|---|
| **Venue boundary** | `ISettlementVenue` with opaque `bytes32 routeId` | `UniswapV4VenueAdapter` + `OptionSettlementHook` |
| **Multi-LP capital boundary** | `LPRouter` + `ILPSettlementHook` | `V4LiquidityVault` for idle yield |
| **App / discovery boundary** | Next.js companion app, API routes, SQLite | Uniswap Trading API, CCA tooling |

---

## 1. Invariant anchor table

Every design decision in §§3–6 references one or more of these invariants.

| ID | Statement | Source | Threatened by Uniswap if... |
|---|---|---|---|
| **I1** | Collateral lives in an account bound 1:1 to one position. Settling A cannot touch B's collateral. Insolvency is bounded to a single position. | MASTER_ARCHITECTURE.md §0, L112–115 | ...LP capital is backed by a shared AMM pool position whose insolvency could drain multiple option positions simultaneously. |
| **I2** | Every term of a position — including `venue` and `routeId` — is immutable, committed by CREATE2 address derivation via `TermsLib.termsSalt`. None can change after mint. | MASTER_ARCHITECTURE.md §0, L116–133; `src/libraries/TermsLib.sol` | ...an upgradeable Uniswap v4 hook allows its logic to change post-mint, effectively amending a live position's venue semantics. |
| **I3** | At least one settlement path — `SETTLE_TO_LP` via `ExpiryCondition` — never depends on the oracle, venue, arbiter, or any external contract. It is computable from `block.timestamp` alone. | MASTER_ARCHITECTURE.md §0, L134–148; `PositionAccount.settleToLp` L393–408 | ...collateral is locked inside a Uniswap v4 `PositionManager` position that requires `PoolManager.modifyLiquidity()` to extract, introducing a venue dependency on the only oracle-free recovery path. |
| **I4** | `feeBps` is a term of the position (<=100, 1%). The account withholds it from every taker-directed outflow on every path, rounded up. No admin can alter it. | MASTER_ARCHITECTURE.md §0, L149–155; `PositionAccount._feeAndPayout` L207–212 | ...Uniswap swap fees consume settlement proceeds before the account can apply `feeBps`, distorting the fee base. Mitigated by the 0-fee hook waiver (§3.2). |

**Derived constraint from I3 (critical):** `PositionAccount` must always hold collateral
as raw ERC-20 tokens — never as Uniswap v4 LP positions, ERC-6909 claims, or any other
AMM-native representation. The `V4LiquidityVault` (§4.2) is architecturally outside the
account boundary; it extracts to raw ERC-20 before mint and receives raw ERC-20 after
settlement.

---

## 2. Integration map

```
                    ┌────────────────────────────────────────────────────┐
                    │         UNISWAP v4 ECOSYSTEM                        │
                    │                                                      │
                    │  ┌─────────────┐   ┌──────────────────────────────┐ │
                    │  │ PoolManager │   │ Trading API / Universal       │ │
                    │  │ (flash acct)│   │ Router (off-chain + on-chain) │ │
                    │  └──────┬──────┘   └──────────────┬───────────────┘ │
                    │         │                           │                │
                    │  ┌──────▼────────┐   ┌─────────────▼────┐          │
                    │  │ OptionSettl-  │   │ CCA (Continuous  │          │
                    │  │ ementHook     │   │ Clearing Auctions)│          │
                    │  └──────┬────────┘   └──────────────────┘          │
                    └─────────┼────────────────────────────────────────────┘
                              │
     ┌────────────────────────┼──────────────────────────────────┐
     │  NEW PERIPHERY         │                                   │
     │                        │                                   │
     │  ┌─────────────────────▼──────────┐  ┌────────────────────┐│
     │  │  UniswapV4VenueAdapter          │  │  V4LiquidityVault  ││
     │  │  (implements ISettlementVenue)  │  │  (implements       ││
     │  │  src/adapters/                  │  │   ILPSettlementHook││
     │  └─────────────────────┬──────────┘  │   + ERC-1271)      ││
     │                         │             └───────────┬────────┘│
     └─────────────────────────┼─────────────────────────┼─────────┘
                               │                          │
     ┌─────────────────────────┼──────────────────────────┼─────────┐
     │  EXISTING CORE (UNCHANGED)                         │          │
     │                         │                          │          │
     │  ┌──────────────────────▼──────┐  ┌───────────────▼────────┐ │
     │  │     PositionAccount         │  │       LPRouter          │ │
     │  │  Calls venue.swap(...)      │  │  matchAndMint pulls     │ │
     │  │  via ISettlementVenue       │  │  ERC-20 from vault      │ │
     │  │  (I3: settleToLp is         │  │  onPositionSettled ->   │ │
     │  │   venue-free regardless)    │  │  vault re-stakes into   │ │
     │  └─────────────────────────────┘  │  v4 pool automatically  │ │
     │                                    └────────────────────────┘ │
     │  PositionManager · AuthzModule · ConditionArbiter              │
     │  TakerProfitCondition · ExpiryCondition  (all UNCHANGED)       │
     └────────────────────────────────────────────────────────────────┘
                               │
     ┌─────────────────────────┼─────────────────────────────────────┐
     │  APP LAYER (app/)       │                                      │
     │  Uniswap API route probe -> routeId selection                  │
     │  QuoterV2 off-chain simulation -> liquidity gate               │
     │  CCA status tracker -> asset onboarding flow                   │
     │  Market depth chart (v4 pool tick data)                        │
     └────────────────────────────────────────────────────────────────┘
```

---

## 3. Pillar I — Uniswap v4 as execution venue

### 3.1 UniswapV4VenueAdapter

**File:** `src/adapters/UniswapV4VenueAdapter.sol`
**Implements:** `ISettlementVenue`
**Core contracts changed:** None.

The adapter wraps Uniswap v4's `IPoolManager.unlock()` flash-accounting pattern,
replacing the current `UniswapV3VenueAdapter`. All existing call sites —
`PositionAccount.initialSwapAndRecord` and `PositionAccount._settleToTakerCall` /
`_settleToTakerPut` — continue calling `ISettlementVenue.swap` identically.

#### Interface contract (unchanged)

```solidity
// ISettlementVenue — src/interfaces/ISettlementVenue.sol (unchanged)
interface ISettlementVenue {
    /// @notice minAmountOut MUST have been derived from IPriceOracle.price, never from
    ///         this venue's own quote. Enforced by PositionAccount._oracleFloor.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 routeId
    ) external returns (uint256 amountOut);

    function quote(address tokenIn, address tokenOut, uint256 amountIn, bytes32 routeId)
        external view returns (uint256);
}
```

#### Full adapter implementation skeleton

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager}     from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}  from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}          from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}         from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}     from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath}         from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20}           from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISettlementVenue} from "../interfaces/ISettlementVenue.sol";

/// @title UniswapV4VenueAdapter
/// @notice ISettlementVenue adapter over Uniswap v4 PoolManager (flash-accounting).
///         routeId = keccak256(abi.encode(PoolKey)) — see §3.3.
///         Invariant I2: immutable. PoolManager address is an immutable constructor arg.
contract UniswapV4VenueAdapter is ISettlementVenue, IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    /// @dev Pool key registry: routeId -> PoolKey.
    ///      Populated by registerRoute(); read-only thereafter (I2).
    mapping(bytes32 => PoolKey) public poolKeyOf;
    /// @dev Optional hook call data per route (passed to PoolManager.swap hookData).
    mapping(bytes32 => bytes)   public hookDataOf;

    struct SwapCallbackData {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes32 routeId;
        address recipient;   // PositionAccount — output delivered directly to it
    }

    error SwapExpired(uint256 deadline, uint256 current);
    error SlippageExceeded(uint256 received, uint256 minimum);
    error UnknownRoute(bytes32 routeId);
    error RouteAlreadyRegistered(bytes32 routeId);
    error OnlyPoolManager();
    error ZeroAddress();

    event RouteRegistered(bytes32 indexed routeId, PoolKey key);

    constructor(address poolManager_) {
        if (poolManager_ == address(0)) revert ZeroAddress();
        poolManager = IPoolManager(poolManager_);
    }

    /// @notice Register a PoolKey under routeId = keccak256(abi.encode(key)).
    ///         Idempotent only if key matches existing registration.
    ///         A registered route can never have its PoolKey changed (I2 enforcement).
    function registerRoute(PoolKey calldata key, bytes calldata hookData) external {
        bytes32 routeId = keccak256(abi.encode(key));
        PoolKey storage existing = poolKeyOf[routeId];
        if (existing.tickSpacing != 0) {
            require(
                Currency.unwrap(existing.currency0) == Currency.unwrap(key.currency0) &&
                Currency.unwrap(existing.currency1) == Currency.unwrap(key.currency1) &&
                existing.fee == key.fee &&
                existing.tickSpacing == key.tickSpacing &&
                address(existing.hooks) == address(key.hooks),
                "RouteAlreadyRegistered"
            );
            return;
        }
        poolKeyOf[routeId] = key;
        hookDataOf[routeId] = hookData;
        emit RouteRegistered(routeId, key);
    }

    /// @inheritdoc ISettlementVenue
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 routeId
    ) external override returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert SwapExpired(deadline, block.timestamp);
        PoolKey memory key = poolKeyOf[routeId];
        // tickSpacing == 0 is the sentinel for an unregistered route.
        // Valid v4 pools always have non-zero tickSpacing.
        if (key.tickSpacing == 0) revert UnknownRoute(routeId);

        // Pull tokenIn from the calling PositionAccount into this adapter.
        // Held transiently only — zero balance after this call returns.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        bytes memory result = poolManager.unlock(
            abi.encode(SwapCallbackData({
                tokenIn:      tokenIn,
                tokenOut:     tokenOut,
                amountIn:     amountIn,
                minAmountOut: minAmountOut,
                routeId:      routeId,
                recipient:    msg.sender   // output goes directly to PositionAccount
            }))
        );
        amountOut = abi.decode(result, (uint256));
    }

    /// @inheritdoc ISettlementVenue
    /// @dev Advisory only — real pre-trade quotes use Uniswap QuoterV2 off-chain (§6.1).
    function quote(address, address, uint256, bytes32) external pure override returns (uint256) {
        return 0;
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        SwapCallbackData memory d = abi.decode(rawData, (SwapCallbackData));
        PoolKey memory key = poolKeyOf[d.routeId];
        bytes memory hData = hookDataOf[d.routeId];

        bool zeroForOne = Currency.unwrap(key.currency0) == d.tokenIn;

        BalanceDelta delta = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne:        zeroForOne,
                amountSpecified:   -int256(d.amountIn),   // negative = exact input
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            hData
        );

        uint256 amountOut = zeroForOne
            ? uint256(int256(delta.amount1()))
            : uint256(int256(delta.amount0()));

        if (amountOut < d.minAmountOut) revert SlippageExceeded(amountOut, d.minAmountOut);

        // Flash-accounting settlement:
        // Settle tokenIn: transfer from this adapter into PoolManager's accounting.
        IERC20(d.tokenIn).safeTransfer(address(poolManager), d.amountIn);
        poolManager.settle();

        // Take tokenOut: deliver directly to the PositionAccount.
        poolManager.take(
            zeroForOne ? key.currency1 : key.currency0,
            d.recipient,
            amountOut
        );

        return abi.encode(amountOut);
    }
}
```

#### Key design decisions

1. **Flash accounting, no ERC-20 hop.** `poolManager.settle()` and `poolManager.take()`
   handle token flows inside the unlock context. The adapter never holds a persistent
   balance.
2. **Output delivered directly to `PositionAccount` (`recipient = msg.sender`).** Mirrors
   the `AerodromeVenueAdapter` pattern (`recipient: msg.sender`).
3. **`minAmountOut` double-enforced.** Already set by `PositionAccount._oracleFloor`
   before the call; the adapter enforces it again at `amountOut < d.minAmountOut`.
4. **Route registry is append-only.** An existing `routeId` mapping can never be changed,
   only re-confirmed with the identical key. Changing a pool's semantics requires a new
   `PoolKey` → new `routeId` → new LP profile (I2 holds transitively).

---

### 3.2 OptionSettlementHook

**File:** `src/hooks/OptionSettlementHook.sol`
**Attaches to:** The Uniswap v4 pool used for option settlement swaps.
**Core contracts changed:** None.

The hook lives at a deterministic address encoded in `PoolKey.hooks`, committed into
`routeId` at position mint (I2). It cannot be upgraded without changing `routeId`.

#### Hook flags required

| Flag | Why |
|---|---|
| `BEFORE_SWAP` | Fee waiver + sender verification + internal netting |
| `BEFORE_SWAP_RETURNS_DELTA` | Net-zero internal crosses bypass the AMM curve |
| `AFTER_SWAP` | Volatility tracking (informational, cannot revert) |

#### `beforeSwap` logic (annotated pseudocode)

```solidity
function beforeSwap(
    address sender,
    PoolKey calldata key,
    IPoolManager.SwapParams calldata params,
    bytes calldata hookData
) external override returns (bytes4, BeforeSwapDelta, uint24) {

    // 1. Sender verification: confirm caller is a PositionAccount bound to a
    //    known PositionManager. Uses ERC-6551's token() introspection.
    //
    //    Why this approach vs TermsLib.deriveAccount?
    //    - TermsLib.deriveAccount requires the full Economics + Pointers calldata,
    //      which the adapter does not have (adapters receive only routeId, not the
    //      position's full terms). Passing full terms as hookData would be 400+ bytes.
    //    - IERC6551Account.token() is a cheap view call (~1500 gas) returning
    //      (homeChainId, tokenContract, tokenId). We verify tokenContract is in
    //      knownPositionManagers — a registry populated at hook deployment.
    //    - A malicious contract could implement token() with fake values; however,
    //      the attacker gains only a 0-fee swap on the pool. They cannot affect any
    //      PositionAccount's collateral (I1). The fee waiver's worst-case loss is
    //      AMM fee revenue — acceptable for the intended use.
    try IERC6551Account(sender).token() returns (uint256, address tokenContract, uint256) {
        if (!knownPositionManagers[tokenContract]) revert InvalidOptionAccount(sender);
    } catch {
        revert InvalidOptionAccount(sender);
    }

    // 2. Zero-fee waiver.
    //    Return overrideFee=0 to charge 0 bps on this swap.
    //    Requires the PoolKey.fee to have DYNAMIC_FEE_FLAG set (0x800000).
    //    This eliminates AMM fee deadweight on settlement, preserving
    //    the intent of I4 (OptionCore feeBps is the sole fee on taker outflows).
    uint24 overrideFee = 0;

    // 3. Internal flow netting (EIP-1153 transient storage — Cancun).
    //    If an opposing flow exists in the transient netting buffer (same tx):
    //      - Cross at current sqrtPriceX96 (midpoint, no curve impact)
    //      - Return custom BeforeSwapDelta bypassing the AMM curve entirely
    //      - Emit NetCross(posA, posB, asset, amount) event
    //    If no opposing flow: store this flow, proceed with normal AMM swap.
    //    Buffer is automatically cleared at transaction boundary (transient).

    return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), overrideFee);
}
```

#### Internal flow netting (transient storage)

```solidity
// EIP-1153 transient storage — reset at transaction boundary, zero SSTORE cost.
// foundry.toml already pins evm_version = "cancun".
mapping(bytes32 => NettingEntry) transient pendingNets;

struct NettingEntry {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    address recipient;
    bool    exists;
}
// Netting key: keccak256(abi.encode(tokenIn, tokenOut)) — canonical ordering
// Opposing flow key: keccak256(abi.encode(tokenOut, tokenIn))
```

Structurally opposing flows within OptionCore:
- PUT mint: sells `collateralAsset` → buys `settlementAsset`
- PUT settlement (LP remainder): sells `settlementAsset` → buys `collateralAsset`
- CALL settlement (taker profit): sells `collateralAsset` → buys `settlementAsset`

When two opposing flows arrive in the same multicall transaction, the hook matches them
at the pool's current midpoint price, bypassing the AMM curve entirely — no fee, no
price impact. Without netting, swaps fall through to normal AMM with the 0-fee waiver.

#### `afterSwap` (informational only)

```solidity
function afterSwap(
    address, PoolKey calldata, IPoolManager.SwapParams calldata,
    BalanceDelta delta, bytes calldata
) external override returns (bytes4, int128) {
    emit SwapExecuted(block.timestamp, delta.amount0(), delta.amount1());
    return (BaseHook.afterSwap.selector, 0);
}
```

#### Deployment requirement: hook address mining

The `PoolKey.hooks` address must satisfy Uniswap v4's flag bitmap. Required flags
(`BEFORE_SWAP | BEFORE_SWAP_RETURNS_DELTA | AFTER_SWAP`) correspond to specific bit
positions in the hook address. Use `forge script` + Uniswap v4 hook mining utilities
to find a salt that produces an address with the correct prefix bits.

---

### 3.3 routeId encoding

In the existing codebase `routeId` is opaque to core, adapter-interpreted:
- `UniswapV3VenueAdapter`: `uint24(uint256(routeId))` → fee tier
- `AerodromeVenueAdapter`: `int24(int256(uint256(routeId)))` → tick spacing

For `UniswapV4VenueAdapter`:

```
routeId = keccak256(abi.encode(PoolKey{
    currency0,   // token with lexicographically lower address
    currency1,   // token with higher address
    fee,         // uint24 — DYNAMIC_FEE_FLAG (0x800000) for hook-enabled pools
    tickSpacing, // int24
    hooks        // address of OptionSettlementHook (or address(0) for UV1)
}))
```

This is identical to Uniswap v4's own `PoolIdLibrary.toId()` formula. The `routeId` is
therefore the canonical Uniswap v4 pool identifier, no additional derivation needed.

**App formula** (`app/src/lib/routeId.ts`):

```typescript
import { encodeAbiParameters, keccak256 } from 'viem';

export function computeRouteId(poolKey: PoolKey): `0x${string}` {
    return keccak256(encodeAbiParameters(
        [
            { name: 'currency0',   type: 'address' },
            { name: 'currency1',   type: 'address' },
            { name: 'fee',         type: 'uint24'  },
            { name: 'tickSpacing', type: 'int24'   },
            { name: 'hooks',       type: 'address' },
        ],
        [poolKey.currency0, poolKey.currency1, poolKey.fee,
         poolKey.tickSpacing, poolKey.hooks]
    ));
}
```

---

### 3.4 Caveats

| Caveat | Impact | Mitigation |
|---|---|---|
| Hook address must be deployed before any position mint | A position cannot be minted until the hook is live at its committed address. | Deploy hook via deterministic CREATE2 before opening LP profiles. CI lint: verify `hookAddress.code.length > 0` in fork tests. |
| Upgradeable hooks violate I2 | An admin upgrading hook logic post-mint effectively amends a live position's venue semantics. | Only immutable hooks (no UUPS/TransparentProxy) in CURATED tier. Curation review template must check for proxy patterns via `cast code`. |
| `PoolManager.unlock` reentrancy surface | `unlockCallback` is called by PoolManager; a malicious pool could attempt reentrancy. | `onlyPoolManager` guard. Adapter holds no persistent balance — re-entering gains nothing. |
| PoolManager unavailability blocks pre-expiry settlement | If PoolManager is paused or pool is locked, `settleToTaker` reverts. | I3 unaffected: `settleToLp` (post-expiry) and `mutualUnwind` never call the venue. Both recovery paths remain live. |
| Fee waiver requires DYNAMIC_FEE_FLAG in PoolKey.fee | Pools without this flag cannot have their fee overridden by a hook. | All OptionSettlementHook-attached pools must be created with `fee = DYNAMIC_FEE_FLAG`. Enforced in `registerRoute` with a `require(key.fee & 0x800000 != 0)` check. |
| hookData adds calldata bytes per settlement | Encoded `hookDataOf[routeId]` is passed to `poolManager.swap`. Adds ~200–400 bytes per call. | Gas gate re-run required (§8.4). Preliminary estimate: +5–15k gas. Comfortably within 15% gate. |

---

## 4. Pillar II — V4-staged LP capital (idle yield)

### 4.1 Capital flow overview

**The problem:** An LP's collateral sits as raw ERC-20 in their wallet while uncommitted
(earning 0%), and as raw ERC-20 inside a `PositionAccount` while the option is live (also
0%). Options run hours to days. Idle capital cost is material for large LP books.

**The invariant constraint (I1 + I3):** Collateral *inside* `PositionAccount` must remain
pure ERC-20. The account cannot hold Uniswap v4 LP positions because:
- Extracting them requires `PoolManager.modifyLiquidity()` — venue-dependent (I3 violation).
- Shared pool insolvency could affect multiple accounts (I1 violation).

**The solution: stage capital outside the account boundary.**

```
Phase 1 — Uncommitted:  LP wallet → V4LiquidityVault (earns AMM fees in v4 pool)
Phase 2 — Committed:    V4LiquidityVault → PositionAccount (pure ERC-20, I1/I3 safe)
Phase 3 — Post-settle:  PositionAccount → LP (via ILPSettlementHook.onPositionSettled)
                        → V4LiquidityVault (re-stakes automatically)
```

**The invariants hold because:**
- Inside `PositionAccount`: always pure ERC-20 (I1, I3 unaffected).
- V4LiquidityVault failures cannot strand PositionAccount collateral (I1 isolation).
- If re-staking fails after settlement, the LP receives raw ERC-20 — a UX degradation,
  not a safety issue.

### 4.2 V4LiquidityVault

**File:** `src/periphery/V4LiquidityVault.sol`
**Implements:** `ILPSettlementHook`, `IERC1271` (so it can be `BackerQuote.backer`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager}       from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}    from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}            from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IERC20}             from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}          from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA}              from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ILPSettlementHook}  from "../interfaces/ILPSettlementHook.sol";
import {IERC1271}           from "../interfaces/IERC1271.sol";

/// @title V4LiquidityVault
/// @notice LP-managed vault staging collateral in Uniswap v4 between options.
///         Invariants I1 and I3: capital inside PositionAccount is always raw ERC-20.
///         This vault only touches it before mint (extraction) and after settlement
///         (re-staking). It is architecturally outside the PositionAccount boundary.
///
/// @dev The vault owner (an LP address or multisig) controls deposit/withdrawal.
///      When used as a BackerQuote.backer, LPRouter verifies signatures via ERC-1271.
///      The vault pre-approves LPRouter for collateral pulls at matchAndMint time.
contract V4LiquidityVault is ILPSettlementHook, IERC1271, IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    PoolKey       public immutable poolKey;
    int24         public immutable tickLower;
    int24         public immutable tickUpper;
    address       public immutable owner;
    address       public immutable lpRouter;

    /// @dev ERC-20 received via onPositionSettled that hasn't been re-staked yet.
    ///      Recoverable by the owner if re-staking perpetually fails.
    mapping(address => uint256) public pendingAsset;

    error OnlyOwner();
    error OnlyLPRouter();
    error OnlyPoolManager();

    event Deposited(address indexed asset, uint256 amount);
    event Withdrawn(address indexed asset, uint256 amount);
    event ExtractedForMint(address indexed asset, uint256 amount);
    event RestakeAttempted(address indexed asset, uint256 amount, bool success);

    constructor(
        address poolManager_,
        PoolKey memory key_,
        int24 tickLower_,
        int24 tickUpper_,
        address owner_,
        address lpRouter_
    ) {
        poolManager = IPoolManager(poolManager_);
        poolKey     = key_;
        tickLower   = tickLower_;
        tickUpper   = tickUpper_;
        owner       = owner_;
        lpRouter    = lpRouter_;
    }

    /// @notice Deposit collateral and add it as v4 liquidity.
    function deposit(address asset, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        _addLiquidity(asset, amount);
        emit Deposited(asset, amount);
    }

    /// @notice Remove liquidity and withdraw to owner.
    function withdraw(address asset, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        _removeLiquidity(asset, amount);
        IERC20(asset).safeTransfer(owner, amount);
        emit Withdrawn(asset, amount);
    }

    /// @notice Remove v4 liquidity converting it to raw ERC-20 so LPRouter can pull
    ///         it via transferFrom at matchAndMint time.
    ///         v1: called by LPRouter before matchAndMint (2-tx sequence).
    function extractForMint(address asset, uint256 amount) external {
        if (msg.sender != lpRouter) revert OnlyLPRouter();
        _removeLiquidity(asset, amount);
        emit ExtractedForMint(asset, amount);
    }

    /// @notice Receives settlement proceeds and re-stakes them into the v4 pool.
    ///         Best-effort: if re-staking fails, proceeds accumulate in pendingAsset.
    ///         Any revert here is caught by PositionAccount._notifyLp's try/catch —
    ///         this hook can NEVER block settlement (I3 design principle).
    function onPositionSettled(uint256, address asset, uint256 amount) external override {
        pendingAsset[asset] += amount;
        bool success = true;
        try this._restake(asset, amount) {
            pendingAsset[asset] -= amount;
        } catch {
            success = false;
        }
        emit RestakeAttempted(asset, amount, success);
    }

    /// @dev Called only by this contract via try/call. External to allow try/catch.
    function _restake(address asset, uint256 amount) external {
        require(msg.sender == address(this), "OnlySelf");
        _addLiquidity(asset, amount);
    }

    /// @notice Owner can manually re-stake accumulated pendingAsset.
    function manualRestake(address asset) external {
        if (msg.sender != owner) revert OnlyOwner();
        uint256 amount = pendingAsset[asset];
        if (amount == 0) return;
        pendingAsset[asset] = 0;
        _addLiquidity(asset, amount);
    }

    /// @inheritdoc IERC1271
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external view override returns (bytes4)
    {
        (address signer,) = ECDSA.tryRecover(hash, signature);
        if (signer == owner) return 0x1626ba7e;
        return 0xffffffff;
    }

    function _addLiquidity(address asset, uint256 amount) internal {
        IERC20(asset).safeIncreaseAllowance(address(poolManager), amount);
        poolManager.unlock(abi.encode(uint8(0), asset, amount)); // action=0: add
    }

    function _removeLiquidity(address asset, uint256 amount) internal {
        poolManager.unlock(abi.encode(uint8(1), asset, amount)); // action=1: remove
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (uint8 action, address asset, uint256 amount) = abi.decode(data, (uint8, address, uint256));
        if (action == 0) {
            // Add liquidity via LiquidityAmounts library — full impl in source
        } else {
            // Remove liquidity — returns ERC-20 to this vault
        }
        return "";
    }
}
```

### 4.3 LPRouter integration

`LPRouter.matchAndMint` requires **no code changes**. The integration is pure composition:

1. Vault signs a `BackerQuote` with `backer = address(vault)`.
2. `LPRouter._verifyQuoteSignature` verifies via `vault.isValidSignature` (ERC-1271 path,
   already supported in `_verifyQuoteSignature` L130–142).
3. `LPRouter._pullCollateral` calls `IERC20(collateralAsset).safeTransferFrom(vault, ...)`.
4. LP app calls `vault.extractForMint(asset, amount)` before `matchAndMint` (2-tx, v1).
5. `PositionManager.mint` pulls raw ERC-20 from `LPRouter → PositionAccount`. **I1 + I3 hold.**

### 4.4 ILPSettlementHook auto-redeposit

After any settlement path, `PositionAccount._notifyLp` calls:

```solidity
// PositionAccount.sol L223–226 (unchanged)
function _notifyLp(address lp, uint256 positionId, address asset, uint256 amount) private {
    if (amount == 0 || lp.code.length == 0) return;
    try ILPSettlementHook(lp).onPositionSettled{gas: LP_HOOK_GAS}(positionId, asset, amount) {} catch {}
}
// LP_HOOK_GAS = 300_000 (PositionAccount.sol L52)
```

`LP_HOOK_GAS = 300_000` is sufficient for `V4LiquidityVault.onPositionSettled`:
- `try/catch` wrapper: ~200 gas
- `_addLiquidity` via `unlock()`: ~80–120k gas for a v4 liquidity operation
- Total estimated: ~120k gas < 300k budget

**When LPRouter is `economics.lp`** (multi-backer scenario): `LPRouter.onPositionSettled`
runs instead, crediting per-backer `claimable` balances. Each vault calls
`LPRouter.withdraw()` to receive proceeds, then re-stakes manually (or via an off-chain
keeper). For v1 this is manual; v2 can add a `LPRouter.withdrawAndRestake(positionId, vault)`
helper requiring no core changes.

### 4.5 Caveats

| Caveat | Impact | Mitigation |
|---|---|---|
| **Impermanent loss (IL)** on staged capital | LP takes on IL risk during staging period | App displays current pool composition and estimated IL before BackerQuote publication. See §9.3. |
| Two-token extraction from pool position | LP may receive a mix of currency0 + currency1 on extraction if pool price has moved | Configure vault with single-sided liquidity (out-of-range on one asset) if only one token is needed as collateral. |
| 2-tx extraction window race | Price can move between `extractForMint` and `matchAndMint`, changing available ERC-20 | App enforces tight submission window. BackerQuote capacity checks provide safety bound. |
| Vault bug is LP-risk, not system-risk | A buggy vault can lose the LP's capital | I1 is unaffected — PositionAccount never holds vault-backed assets. Vault audited separately. |
| Rebasing / fee-on-transfer collateral (Q10 applies) | Both vault and PositionAccount affected | Curation-layer exclusion. Never stage rebasing tokens in the vault for option collateral. |

---

## 5. Pillar III — Continuous Clearing Auctions (CCA) for asset onboarding

### 5.1 What CCA solves

OptionHood's post-audit finding: two of three onboarded tickers were untradeable — pools
existed but lacked liquidity. `ISettlementVenue.quote()` is advisory for this reason.

CCA (Continuous Clearing Auctions) provides:
1. **Fair price discovery.** Uniform-price clearing over multiple blocks eliminates
   sniping and first-block timing advantages.
2. **Bootstrapped pool liquidity.** CCA proceeds automatically seed the canonical v4
   pool at clearing price — the pool OptionCore uses for settlement swaps.
3. **Oracle anchor.** CCA clearing price serves as the initial reference for the first
   Chainlink feed observation window, anchoring `maxPriceAge` validation at first mint.

### 5.2 Onboarding flow

```
Step 0 — Prerequisites
  ├── Tokenized asset (ERC-20) deployed and verified on target chain
  ├── Chainlink / oracle feed verified for the asset/settlement pair
  │    cadenceHint measured from real round history — never guessed (Q13 rule)
  └── ChainlinkPriceOracleAdapter deployed; pegAssumption() disclosed if applicable

Step 1 — CCA setup (Uniswap interface, no-code)
  ├── Configure: token pair, auction duration (>=1h recommended), price bounds
  ├── Set post-auction target: auto-seed canonical v4 pool with OptionSettlementHook
  └── Launch via Uniswap CCA interface

Step 2 — Auction runs
  ├── Orders accumulate over multiple blocks (anti-sniping)
  ├── Protocol clears at uniform price at auction close
  └── App monitors CCA status (Uniswap API: GET /cca/{auction_id}/status)

Step 3 — Pool seeding (automatic at CCA close)
  ├── CCA proceeds → canonical v4 pool seeded at clearing price
  ├── OptionSettlementHook registered on pool (§3.2)
  └── UniswapV4VenueAdapter.registerRoute(poolKey, hookData) called by deployer

Step 4 — Adapter deployment and curation submission
  ├── Deploy ChainlinkPriceOracleAdapter for the new asset
  ├── Submit to ModuleRegistry curation queue (5-day timelock for CURATED tier)
  └── App: asset listed as "Pending Curation" — LP profiles allowed but flagged uncurated

Step 5 — LP profile publication (first time for this asset)
  ├── profile.oracle = chainlinkAdapter, profile.venue = v4adapter
  ├── profile.routeId = computeRouteId(poolKey)   (§3.3 formula)
  ├── profile.maxPriceAge >= oracle.cadenceHint()  (Q13 floor, enforced on-chain)
  └── App verifies pool depth via QuoterV2 before allowing profile publish

Step 6 — First mint (normal flow)
  └── All invariants apply from this point forward
```

### 5.3 Clustered expiry batch clearing

When many options expire in the same block, a keeper bot can call `settleToLp` on all
expired positions in a single multicall transaction. `settleToLp` with `ExpiryCondition`:
- Is oracle-free (I3 upheld)
- Is public and permissionless once `block.timestamp >= expiry`
- Is safe to batch with no inter-position dependencies (I1 guarantees isolation)

Keeper bot implementation is off-chain; no protocol change required.

---

## 6. Pillar IV — Uniswap Trading API in the app layer

### 6.1 Pre-trade liquidity verification

The existing `ISettlementVenue.quote()` correctly returns 0 (advisory, per-spec). Real
pre-trade verification uses the Uniswap QuoterV2 off-chain view call:

```typescript
// app/src/lib/routeVerification.ts

interface LiquidityCheckResult {
    executable:     boolean;    // can settle at oracle floor?
    expectedOutput: bigint;     // QuoterV2 simulated amountOut
    priceImpactBps: number;     // estimated price impact in bps
    warning:        string | null;
}

/// Simulate the settlement swap before a position is minted.
/// Uses Uniswap v4 QuoterV2 (view call, no gas cost).
/// Returns executable=false if pool depth is insufficient.
/// This is the fix for OptionHood's "untradeable tickers" finding.
export async function verifySettlementLiquidity(params: {
    tokenIn:     Address;
    tokenOut:    Address;
    amountIn:    bigint;       // collateralAmount for CALL; expected profit for PUT
    oracleFloor: bigint;       // IPriceOracle.price() result, oracle-derived minAmountOut
    slippageBps: number;
    poolKey:     PoolKey;
}): Promise<LiquidityCheckResult> {
    // Call QuoterV2.quoteExactInputSingle with the v4 PoolKey
    // If amountOut < oracleFloor: executable=false, display blocking warning
    // If amountOut >= oracleFloor: executable=true, display price impact
}
```

**Where it is called:**
1. **LP profile publication** — reject profiles where liquidity check fails.
2. **Taker mint page** — display live liquidity warning (non-blocking but visible).
3. **LP dashboard** — per-profile liquidity health indicator (§9.3).

### 6.2 Dynamic routeId selection

`routeId` is committed at LP profile signing (I2). Route selection happens when the LP
publishes their profile, not at mint time. The app queries the Uniswap Trading API to
discover the best single-hop v4 pool for the asset pair:

```typescript
// app/src/lib/routeSelection.ts

export async function selectBestRoute(
    collateralAsset: Address,
    settlementAsset: Address,
    typicalSwapAmount: bigint,
): Promise<{ routeId: Hex; poolKey: PoolKey; rationale: string }> {
    // 1. Query Uniswap API for best v4 single-hop routes
    // 2. Sort by liquidity depth and price impact
    // 3. Verify selected routeId is registered in UniswapV4VenueAdapter.poolKeyOf
    //    (if not: block LP profile until deployer calls registerRoute)
    // 4. Return routeId for inclusion in LiquidityProfile
}
```

### 6.3 Premium estimation improvement

Premium is currently `units × durationHours × pricePerUnitPerHour` (LP-set flat rate).
The app can display real-time premium context using the v4 pool's implied volatility
(from `sqrtPriceX96` TWAP) alongside the LP's flat rate. This is informational only —
no on-chain logic changes.

---

## 7. Implementation path — ordered milestones

Each milestone is independently deployable and testable. No milestone requires changes
to verified core contracts.

### Milestone UV1 — Uniswap v4 Venue Adapter (no hook)

**Goal:** Replace `UniswapV3VenueAdapter` as the default for new Base profiles.
Use v4 pools without custom hook (plain fee pool, no dynamic fee, no MEV protection).

**Deliverables:**
- `src/adapters/UniswapV4VenueAdapter.sol`
- `test/unit/UniswapV4VenueAdapterTest.t.sol`
- `test/fork/UniswapV4VenueFork.t.sol` — fork-verified against live Base v4 pool
- App: `routeVerification.ts` updated to v4 QuoterV2
- App: `routeSelection.ts` prefers v4 single-hop routes
- `BASE_DEPLOYMENT.md` updated with `UniswapV4VenueAdapter` address

**Pre-deploy checklist:**
- [ ] Confirm `PoolManager` address on Base mainnet via `cast code`
- [ ] Confirm QuoterV2 address on Base mainnet via `cast code`
- [ ] Run gas gate (§8.4) and record v4 delta before merge
- [ ] Formal audit of `UniswapV4VenueAdapter`

---

### Milestone UV2 — OptionSettlementHook (fee waiver + MEV protection)

**Goal:** Deploy hook against the UV1 pool. Enable 0-fee waivers. Add `PositionAccount`
sender verification.

**Deliverables:**
- `src/hooks/OptionSettlementHook.sol`
- Hook address mining script
- `test/unit/OptionSettlementHookTest.t.sol`
- `test/fork/OptionSettlementHookFork.t.sol`
- App: `routeId` derivation updated to include hook address
- ModuleRegistry submission: curate hook-enabled pool

**Note on routeId change:** UV2 pools have `fee = DYNAMIC_FEE_FLAG` and
`hooks = hookAddress`, producing a different `routeId` from UV1 pools. UV1 and UV2
positions are both valid simultaneously — each committed to their respective `routeId`
at mint (I2 holds for both).

**Core contract changes: none required.** hookData is stored per-route in
`hookDataOf[routeId]` and passed by the adapter at swap time. `PositionAccount`,
`PositionManager`, and all conditions remain unchanged.

---

### Milestone UV3 — V4LiquidityVault (idle capital yield)

**Goal:** Enable LPs to stage collateral in v4 and earn AMM fees while uncommitted.

**Deliverables:**
- `src/periphery/V4LiquidityVault.sol`
- `test/unit/V4LiquidityVaultTest.t.sol`
- `test/fork/V4LiquidityVaultFork.t.sol` — full lifecycle test
- App: LP dashboard vault management UI (§9.3)
- App: `extractForMint` transaction flow UX
- Docs: LP yield mechanics, IL risk disclosure

---

### Milestone UV4 — CCA integration + asset onboarding flow

**Goal:** CCA status monitoring integrated; LP profile publication gated on pool depth.

**Deliverables:**
- App: CCA status tracker API route
- App: asset onboarding wizard UI
- App: `verifySettlementLiquidity` integrated into profile publish flow
- Docs: asset onboarding guide

---

### Milestone UV5 — Market chart, frontend polish, and LP dashboard

**Goal:** Full frontend specification per §9.

**Deliverables:**
- `app/src/components/MarketChart.tsx`
- `app/src/app/lp/vault/page.tsx` (vault management panel)
- Settlement flow UX additions
- Real-time price subscription via WebSocket RPC

---

## 8. Testing strategy

### 8.1 Unit tests

#### `test/unit/UniswapV4VenueAdapterTest.t.sol`

```solidity
// 1.  swap() with mock PoolManager — verify amountOut returned correctly
// 2.  swap() with expired deadline → SwapExpired revert
// 3.  swap() with unknown routeId → UnknownRoute revert
// 4.  swap() where amountOut < minAmountOut → SlippageExceeded revert
// 5.  unlockCallback() called by non-PoolManager → OnlyPoolManager revert
// 6.  registerRoute() stores PoolKey and hookData; retrieval matches
// 7.  registerRoute() with same routeId + different key → revert
// 8.  routeId derivation: keccak256(abi.encode(key)) matches expected
// 9.  Flash accounting: adapter holds zero balance after swap() returns
// 10. zeroForOne direction: both token orderings covered
```

#### `test/unit/OptionSettlementHookTest.t.sol`

```solidity
// 1. beforeSwap() from valid PositionAccount → 0 fee override, proceeds normally
// 2. beforeSwap() from EOA (no code) → InvalidOptionAccount revert
// 3. beforeSwap() from contract with token() returning unknown PositionManager → revert
// 4. beforeSwap() from contract with token() returning known PositionManager → success
// 5. Internal netting: two opposing flows in same tx → net cross, no AMM curve
// 6. afterSwap() records event, never reverts
// 7. Hook flags: verify required bits set in hook address
// 8. Fee waiver: swap charges 0 fee (requires DYNAMIC_FEE_FLAG pool)
```

#### `test/unit/V4LiquidityVaultTest.t.sol`

```solidity
// 1. deposit() stakes ERC-20 as v4 liquidity; vault ERC-20 balance becomes 0
// 2. extractForMint() by LPRouter → removes liquidity → ERC-20 available
// 3. extractForMint() by non-LPRouter → OnlyLPRouter revert
// 4. onPositionSettled() re-stakes received ERC-20 (happy path)
// 5. onPositionSettled() re-staking failure → pendingAsset updated, no revert
// 6. isValidSignature() validates owner-signed BackerQuote hashes (ERC-1271)
// 7. Full lifecycle: deposit → extractForMint → matchAndMint mock → onPositionSettled
// 8. I1 isolation: vault failure does NOT affect a mock PositionAccount's balance
// 9. manualRestake(): owner recovers pendingAsset after re-staking failures
```

#### `test/unit/LPRouterV4VaultTest.t.sol`

Adapts `LPRouterTest.t.sol` to use `V4LiquidityVault` as a backer:

```solidity
// 1. matchAndMint with vault as BackerQuote.backer (ERC-1271 path)
// 2. settleToTaker → onPositionSettled on vault → re-stake
// 3. settleToLp (post-expiry, oracle reverts) → onPositionSettled → re-stake
// 4. mutualUnwind → onPositionSettled → re-stake
// 5. Vault re-staking failure does NOT block settlement (try/catch absorbed)
// 6. I3: settleToLp gas is identical whether vault re-staking succeeds or reverts
```

### 8.2 Fork tests

#### `test/fork/UniswapV4VenueFork.t.sol`

```solidity
// Fork: Base mainnet (BASE_RPC_URL environment variable)
// Skip if fork unavailable (follows existing fork test pattern in this repo)
//
// 1. Deploy UniswapV4VenueAdapter pointing at live PoolManager
// 2. Register WETH/USDC pool with real PoolKey from Base deployment
// 3. Fund test account with WETH; approve adapter
// 4. Call adapter.swap(WETH, USDC, 1e18, oracleFloor, deadline, routeId)
// 5. Assert: USDC received >= oracleFloor
// 6. Assert: adapter holds zero WETH and zero USDC post-call
// 7. Assert: amountOut matches QuoterV2 simulation within 1%
```

#### `test/fork/OptionSettlementHookFork.t.sol`

```solidity
// Fork: Base mainnet (UV2 milestone — hook deployed)
//
// 1. Deploy hook at mined address; create DYNAMIC_FEE_FLAG v4 pool with hook
// 2. Mint option position referencing hook-attached pool as venue
// 3. Advance price; trigger settleToTaker
// 4. Assert: AMM fee = 0 (hook waiver confirmed via pool fee events)
// 5. Assert: PositionAccount balance = 0 post-settlement
// 6. Assert: taker received >= minPayoutToTaker
// 7. Adversarial: non-PositionAccount calls swap on same pool → does NOT get waiver
```

#### `test/fork/V4LiquidityVaultFork.t.sol`

```solidity
// Fork: Base mainnet
//
// 1. Deploy V4LiquidityVault for a test LP
// 2. LP deposits WETH → verify v4 liquidity position minted
// 3. LPRouter calls extractForMint → WETH extracted to vault ERC-20 balance
// 4. matchAndMint with vault as backer → PositionAccount holds raw WETH
// 5. Settle position → verify onPositionSettled called → vault re-stakes
// 6. LP withdraws → WETH + earned fees received
// 7. I3 regression: vault re-staking revert does NOT affect settleToLp gas figure
```

### 8.3 Invariant additions

**Handler additions** (`test/invariant/handlers/UniswapV4Handler.sol`):

```solidity
// randomSwap: calls UniswapV4VenueAdapter.swap with random amounts/tokens
// randomHookCall: calls OptionSettlementHook directly from non-PositionAccount
//   (MUST revert — assertion: InvalidOptionAccount)
// randomVaultDeposit / randomVaultExtract
// randomOnPositionSettled: calls vault.onPositionSettled from arbitrary address
//   (must not revert; must not change PositionAccount state)
```

**Additional invariant assertions:**

```
P_V4_I1:  After vault.extractForMint(),
           PositionAccount.realized.recordedCollateral
           == IERC20(collateralAsset).balanceOf(account)
           within rounding tolerance.
           Verifies: extraction delivers real ERC-20, not a vault claim.

P_V4_I3:  After settleToLp (ExpiryCondition path),
           no call was made to poolManager or any v4 contract.
           Verifies: oracle-free path is truly venue-free.

P_V4_FEE: After settleToTaker with OptionSettlementHook active,
           FeeVault received exactly ceil(payout * feeBps / 10000).
           No additional fee collected by hook.
           Verifies: fee waiver does not interfere with I4.
```

### 8.4 Gas-gate compliance

Pre-register expected deltas **before running** (GAS.md protocol: write before seeing numbers):

| Action | V3 Measured | V4 Expected Delta | Source |
|---|---|---|---|
| `mint` (CALL) | 240,406 | +5k to +15k | `poolKeyOf` SLOAD, `unlock()` overhead |
| `mint` (PUT) | 344,660 | +20k to +40k | Full v4 flash-accounting for creation swap |
| `settleToTaker` | 181,228 | +20k to +40k | v4 flash accounting + `unlockCallback` |
| `settleToLp` | 67,838 | **+0** | I3: `settleToLp` never calls venue |
| `mutualUnwind` | 114,004 | **+0** | `mutualUnwind` never calls venue |

**Decision rule (unchanged from GAS.md):** if per-position overhead exceeds 15% of the
representative premium on a given chain, v4 does not ship on that chain.

At current baselines ($200 mainnet, $2 L2):
- Mainnet worst case: 280k gas × 4.10 gwei × $2,000/1e9 ≈ $2.30. Premium $200. **~1.15%. Passes.**
- Base L2 worst case: 280k gas × 0.005 gwei × $2,000/1e9 ≈ $0.003 + L1 data fee (~$0.10). **~5%. Passes.**

**Critical regression (must not break):**
Run `settleToLp` with an oracle mock configured to `revert()` unconditionally.
Gas figure MUST be bit-for-bit identical to the healthy-oracle run (original: 67,838).
This verifies I3 holds empirically, not just by assertion.

---

## 9. Frontend, UX, and market chart guidance

### 9.1 Market depth and price chart

**Data sources:**
- **Price history:** Uniswap v4 pool `Swap` events → OHLCV at 1h/4h/1d intervals.
  Supplement with Chainlink `AnswerUpdated` events for oracle-anchored reference price.
- **Market depth:** v4 `PoolManager` tick-level liquidity via `eth_call` to
  `poolManager.getLiquidity(poolId, tickLower, tickUpper)` across ±10% range.
- **IV context (informational):** Historical price variance over a TWAP window.

**Chart component spec (`app/src/components/MarketChart.tsx`):**

```
Panel 1 — Price chart (primary, 60% height)
  • Candlestick OHLCV (1h / 4h / 1d granularity selector)
  • Chainlink oracle price as dotted line (the authoritative settlement price)
  • Entry price: horizontal dashed line at current oracle price (entryPrice at mint)
  • Expiry marker: vertical line at current timestamp + durationHours
  • Profit zone: green shading above entry (CALL) or red below (PUT)
    based on user-selected option type
  • Real-time WebSocket update on each Swap event from the v4 pool

Panel 2 — Market depth (25% height)
  • Bid/ask depth curve from tick-level v4 liquidity data
  • "Settlement zone" highlight: price range within slippageBps of oracle mid
  • Position size indicator: vertical bar showing amountIn relative to pool depth
  • Red warning banner if verifySettlementLiquidity() returns executable=false

Panel 3 — Volume and yield (15% height)
  • 24h trading volume in the settlement pool
  • Current LP fee APR (fee revenue / liquidity, annualized) — shown to LPs
  • Total open interest: sum of units across all active positions on this asset
```

**Implementation stack:**
- Charting: `lightweight-charts` (TradingView — minimal, license-compatible)
- Real-time: `viem.watchContractEvent` on `PoolManager.Swap` (filter by poolId)
- Depth data: `eth_call` batch via viem `multicall`; cache 30 seconds
- Historical: Uniswap v4 subgraph (The Graph) for OHLCV back-fill

### 9.2 Mint flow UX additions

**Step 1 — Asset and venue selection:**
- Show matched v4 pool with `OptionSettlementHook` badge (UV2+ pools).
- "Verified Pool" badge if pool+hook in ModuleRegistry CURATED tier.
- "Unverified" warning with `ackUnverifiedTerms` checkbox otherwise.

**Step 2 — Terms review (pre-signing):**
- **Venue liquidity indicator** (live `verifySettlementLiquidity` result):
  - 🟢 Green: "Sufficient liquidity for this position size."
  - 🟡 Yellow: "Thin liquidity — settlement may fail if price moves >X%."
  - 🔴 Red (blocking): "Insufficient liquidity — cannot mint against this pool."
- **Fee breakdown table:**

  | Item | Amount |
  |---|---|
  | Premium (paid now) | `units × hours × rate` settlement asset |
  | AMM fee at settlement | 0 bps (waived by OptionSettlementHook) |
  | Protocol fee (if settled profitably) | `feeBps`% of payout |
  | Estimated net payout at current price | `(livePrice - entryPrice) × units × scalar - fee` |

**Step 3 — Confirm and sign:**
- Show `entryPrice` (current oracle price, normalized to 1e18 → human-readable)
- Show `expiry` in local time
- Show `routeId` as short hash, expandable to full pool details (tokens, fee, hook)
- Confirm button disabled until liquidity check passes

### 9.3 LP dashboard additions

**New panel: Vault management (`app/src/app/lp/vault/page.tsx`)**

```
┌─────────────────────────────────────────────────────────────────────┐
│  V4 Liquidity Vault                              [Connect Vault]     │
├─────────────────────────────────────────────────────────────────────┤
│  Pool:   WETH/USDC — OptionSettlementHook                            │
│  Range:  [-887272] to [887272]  Current price: $2,048                │
│                                                                       │
│  Deposited:    3.0 WETH                                              │
│  Pool value:   2.1 WETH + 1,843 USDC   (after IL)                   │
│  Earned fees:  12.40 USDC (7d)  |  Est. APR: 6.2%                   │
│                                                                       │
│  Impermanent loss:  -1.4% vs HODL WETH   [Explain IL]               │
│                                                                       │
│  Status:   ● 2.1 WETH equivalent available for minting              │
│            ○ 0.9 WETH committed (position #1247, expires in 4h)      │
│                                                                       │
│  Pending re-stake: 0 WETH  (re-staking healthy)                      │
│  [Manual Restake]  if auto-restake has failed entries                 │
│                                                                       │
│  [Deposit]  [Withdraw]  [Extract for Next Mint]                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Per-profile liquidity health monitor (new column in profiles table):**

| Asset pair | Pool | Depth vs Max Size | Last Check | Action |
|---|---|---|---|---|
| WETH/USDC | v4+Hook | 🟢 847% | 2 min ago | — |
| AAPL/USDC | v4+Hook | 🟡 43% | 2 min ago | Reduce units |
| TSLA/USDC | v3 | 🔴 8% | 2 min ago | Pause profile |

Depth vs Size = (pool depth within `slippageBps` range) / (max collateral per position).
"Pause profile" calls `reduceCommitment(profileHash, consumedUnits)`.

### 9.4 Settlement flow UX

1. **Live price widget:** Real-time oracle price with last-updated indicator. Turns
   orange within 10% of `maxPriceAge`. Turns red if oracle is stale. Shows time until
   expiry.

2. **Profit calculator:** `pnl = (livePrice - entryPrice) × units × scalar / scalar`.
   Updates in real-time. Shows net payout after `feeBps`. Matches `TakerProfitCondition`
   formula exactly.

3. **Settlement liquidity check:** Before signing, shows whether the settlement swap
   can fill at current pool depth. Informational — does not block signing but warns if
   settlement will likely revert at current price.

4. **`minPayoutToTaker` slider:** Taker drags slider to set minimum acceptable payout
   (`SettleToTakerParams.minPayoutToTaker`). Range: oracle midpoint payout ×
   (1 - slippageBps/10000) to oracle midpoint payout × 100%.

5. **Settlement path display:**
   - LP co-signed: "Direct 2-of-2 settlement (LP + Taker) — fastest path"
   - LP not present: "Arbiter-assisted (Taker + ConditionArbiter) — permissionless"

---

## 10. Known caveats register

| # | Caveat | Severity | Mitigation |
|---|---|---|---|
| C1 | Hook address committed at mint (I2). A buggy hook cannot be patched for live positions. | HIGH | Only immutable hooks in CURATED tier. Per-position isolation (I1) bounds any hook exploit to positions on that specific routeId. Extensive pre-deploy testing (§8). |
| C2 | DYNAMIC_FEE_FLAG pools (UV2) have a different routeId from standard pools (UV1). | MEDIUM | Document clearly. App shows pool version in profile display. Both routeIds remain valid simultaneously. |
| C3 | v4 flash accounting has a more complex reentrancy surface than v3 `transferFrom`. | MEDIUM | `onlyPoolManager` guard. Adapter holds no persistent balance. Formal audit required before UV1 mainnet deploy. |
| C4 | `V4LiquidityVault.onPositionSettled` uses up to 300k gas. A complex v4 pool with expensive hook callbacks could exceed this. | MEDIUM | Measure `_addLiquidity` gas on target pool. If >250k, a new `PositionAccount` implementation with higher `LP_HOOK_GAS` is needed — only new positions are affected (I2). |
| C5 | CCA clearing price may differ from oracle price at pool seeding. First mints may use an `entryPrice` that deviates from pool spot. | MEDIUM | Enforce oracle freshness check after CCA close before allowing first LP profile. |
| C6 | Uniswap Trading API is an off-chain service. `routeId` recommendation is advisory; the registered `PoolKey` is the on-chain source of truth. | LOW | App validates `routeId` registration before LP can sign profile. |
| C7 | Internal netting (§3.2) is within-transaction only (transient storage). | LOW | Document as best-effort. Without netting, swaps go through the AMM normally (0-fee waiver still active). |
| C8 | V4LiquidityVault IL risk during staging (§4.5). | LOW | App displays IL estimate before LP extracts for mint. Documented in LP onboarding. |
| C9 | Multi-hop routes not supported in UV1/UV2 (single-hop only). | LOW | Multi-hop is UV3+ scope. `routeId` can encode a multi-hop path without any core changes. |
| C10 | `mutualUnwind` for vault-backed positions: vault re-staking is best-effort post-unwind. | LOW | Manual restake available via `vault.manualRestake()`. |

---

## 11. Open questions

| Q | Status | Resolution path |
|---|---|---|
| **UV-Q1** | What is the canonical Uniswap v4 `PoolManager` address on Base mainnet? | Verify via `cast code` against official Uniswap v4 deployment registry before UV1 deploy. |
| **UV-Q2** | Is returning `overrideFee = 0` from `beforeSwap` sufficient for 0-fee, or must the pool fee be set to 0 in `PoolKey`? | Test in fork environment. Uniswap v4 docs indicate `overrideFee` overrides pool fee when `DYNAMIC_FEE_FLAG` is set. |
| **UV-Q3** | Should `OptionSettlementHook` whitelist `PositionManager` addresses, or use `TermsLib.deriveAccount` per-call? | Whitelist (SLOAD ~800 gas) recommended for v1. Full per-call derivation (~5k gas) for v2 if stronger guarantees are needed. |
| **UV-Q4** | Can `V4LiquidityVault.onPositionSettled` be called adversarially with `amount > vault.balance`? | Yes, but `_addLiquidity` would fail on the subsequent ERC-20 transfer (insufficient balance). Net effect: no-op. Confirm in audit. |
| **UV-Q5** | Should `registerRoute` have owner restriction or a timelock? | No on-chain restriction needed: new routes cannot affect existing positions (I2). ModuleRegistry's 5-day timelock is the correct governance gate. |
| **UV-Q6** | When `LPRouter` is `economics.lp`, how do vaults receive auto-redeposit? | `LPRouter.onPositionSettled` credits `claimable[backer]`; vault must call `LPRouter.withdraw()` then `deposit()`. v2: add `LPRouter.withdrawAndRestake(positionId, vault)` helper. |
| **UV-Q7** | Which chains deploy the full v4 stack? | UV1 (adapter): Base mainnet first. UV2 (hook): Base after UV1 audit. Ethereum mainnet: UV1 after Base UV1 stable. Orbit chains: deferred. |

---

*End of OH_UNISWAP_SPECIFICATION.md — Revision 1, September 2026.*
