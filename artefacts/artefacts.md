# Artefacts Guide: OptionCore × Uniswap v4

This directory contains the necessary context files (`artefacts/`) to implement the specification defined in `OH_UNISWAP_SPECIFICATION.md`. The specification dictates how to integrate Uniswap v4 **without modifying the verified core contracts**.

These artifacts are your implementation blueprints, interface definitions, and testing harnesses. Do not modify the files in the `artefacts/` directory; treat them as read-only reference material.

## 1. Understanding Core Invariants

Before writing any code, refer to these artifacts to understand the invariants (I1–I4) defined in the specification:

*   **`artefacts/MASTER_ARCHITECTURE.md`**: The primary source of truth for the OptionCore philosophy and invariants. Read §0 and the action ladder table.
*   **`artefacts/GAS.md`**: Defines the strict gas gate (15% overhead max) and proves that `settleToLp` is venue-free (67,838 gas regardless of oracle status). Your v4 integration must maintain this.
*   **`artefacts/src/PositionAccount.sol`**: The core account contract. Observe how `_settleToTakerCall` and `_settleToTakerPut` call `ISettlementVenue.swap`, and how `_notifyLp` uses a `try/catch` with a fixed `LP_HOOK_GAS` (300,000) so that hook failures cannot block settlement.
*   **`artefacts/src/libraries/TermsLib.sol`**: Demonstrates how `routeId` and all terms are committed immutably via CREATE2 derivation (Invariant I2).

## 2. Implementing Pillar I: Venue Adapter & Hook

When building the `UniswapV4VenueAdapter` (Milestone UV1) and `OptionSettlementHook` (Milestone UV2), use these blueprints:

*   **`artefacts/src/interfaces/ISettlementVenue.sol`**: The interface your adapter MUST implement. Note that `quote()` is advisory and `swap()` receives an opaque `routeId`.
*   **`artefacts/src/adapters/AerodromeVenueAdapter.sol`**: A reference implementation for a clean venue adapter. Notice how it pulls `tokenIn` from `msg.sender` (the `PositionAccount`), grants an allowance, and sets the `recipient` back to `msg.sender`. Your v4 flash-accounting adapter should follow this same flow.
*   **`artefacts/src/adapters/UniswapV3VenueAdapter.sol`**: Shows how the current system decodes the `routeId` (as a fee tier). The v4 adapter will decode `routeId` as the canonical v4 `PoolId`.
*   **`artefacts/test/fizz/handlers/UniswapV3VenueAdapterHandler.sol`**: Use this as the basis for the `UniswapV4Handler` in your invariant test campaign (§8.3).

## 3. Implementing Pillar II: V4LiquidityVault

When building the `V4LiquidityVault` (Milestone UV3) to stage idle LP capital in Uniswap v4, refer to these artifacts:

*   **`artefacts/src/interfaces/ILPSettlementHook.sol`**: The interface the vault MUST implement to receive auto-redeposits via `onPositionSettled`.
*   **`artefacts/src/interfaces/IERC1271.sol`**: Required for the vault to act as a signer for `BackerQuote`s.
*   **`artefacts/src/periphery/LPRouter.sol`**: The router that aggregates capital. Observe `matchAndMint` and `_pullCollateral`. Your vault will act as a backer to this router. The router requires no modifications to support the v4 vault; the integration is pure composition.
*   **`artefacts/test/unit/LPRouter.t.sol`**: The testing harness for router interactions. Adapt this into `LPRouterV4VaultTest.t.sol` to verify that the vault can successfully sign quotes and provide liquidity.

## 4. Pillar IV: App Layer & Trading API

When building the frontend components, `verifySettlementLiquidity`, and dynamic route selection:

*   **`artefacts/src/types/Pointers.sol`**: Details the `Pointers` struct. Note the `routeId` field is an opaque `bytes32`. In the app, you will compute this using `keccak256(abi.encode(PoolKey))`.
*   **`artefacts/src/conditions/TakerProfitCondition.sol`**: Contains the exact math used to calculate taker payouts. Replicate this math in the frontend's profit calculator to ensure WYSIWYG correctness for the user.

---

**Next Steps**: Follow the milestone path in `OH_UNISWAP_SPECIFICATION.md` (§7). Start with Milestone UV1 by scaffolding `UniswapV4VenueAdapter.sol` based on the `ISettlementVenue` interface and the existing adapter artifacts.
