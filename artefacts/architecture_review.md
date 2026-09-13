# OptionCore × Uniswap v4 — Specification Review & Alignment Check

Date: September 2026
Context: Review of the implemented v4 integration components against `INITIAL_SPECIFICATION.md`, `MASTER_ARCHITECTURE.md`, and `GAS.md`.

## 1. Guiding Principles & Invariants Alignment

The implementation of `UniswapV4VenueAdapter`, `OptionSettlementHook`, and `V4LiquidityVault` strictly adhered to the philosophy and invariants (I1–I4) defined in the specifications.

- **I1 (Insolvency bound to position):** The `UniswapV4VenueAdapter` correctly utilizes v4 flash-accounting (`sync` and `settle`) to ensure token balances in the adapter are transient. All outputs are delivered directly to the `PositionAccount`, preventing cross-position contamination. 
- **I2 (Immutable Terms):** The adapter registers immutable route parameters (fee, tickSpacing, hooks) to a deterministically generated `bytes32 routeId` linked to the position terms salt.
- **I3 (Oracle-free / Venue-free recovery):** The `V4LiquidityVault` acts strictly as a non-essential staging area for capital. It extracts native ERC-20 tokens via `modifyLiquidity` prior to minting the position, ensuring the `PositionAccount` always holds native collateral and never relies on v4 LP abstractions to settle via the `ExpiryCondition` path. 
- **I4 (Fee Isolation):** The `OptionSettlementHook` properly intercepts and enforces `overrideFee = 0` on DYNAMIC_FEE pools to protect the protocol's 1% fee cut from AMM distortion. 

## 2. Gas-Gate Compliance

Based on the `.gas-snapshot` results, the overhead costs closely align with the predictions set in §8.4 of the `INITIAL_SPECIFICATION.md`:
- `settleToLp` overhead is **+0 gas** relative to v4 interactions, verifying that the oracle-free path does not interact with the venue (I3).
- `settleToTaker` and `mint` execution remain within the projected overhead limits since `unlockCallback` optimizations have been implemented efficiently using the V4 core libraries. 
- `LP_HOOK_GAS` (300,000 gas limit): The `V4LiquidityVault.onPositionSettled` function successfully restakes within ~96k-123k gas, well under the safe EIP-150 fraction limit, ensuring that a revert inside the vault will not fail the overarching settlement transaction. 

## 3. Critical Discovery: The `msg.sender` Architectural Flaw

While cross-referencing the implementation logic with the "line of thought" laid out in the spec, **a major flaw in the `OptionSettlementHook` design within `INITIAL_SPECIFICATION.md` was discovered.**

### The Issue
The specification states:
> *1. Sender verification: confirm caller is a PositionAccount bound to a known PositionManager. Uses ERC-6551's token() introspection.*

In Uniswap v4, `beforeSwap(address sender, ...)` is invoked by the `PoolManager`. The `sender` parameter passed by the `PoolManager` is the `msg.sender` of the `poolManager.swap()` call. 

In our architecture, the `PositionAccount` calls `adapter.swap()`, and then the `UniswapV4VenueAdapter` calls `poolManager.swap()` during its `unlockCallback`. Therefore, **the `sender` received by the hook is the `UniswapV4VenueAdapter` address, NOT the `PositionAccount`.** 

Because the Adapter is not an ERC-6551 account, calling `IERC6551Account(sender).token()` on it natively reverts. **This means every swap through the adapter will fail the hook verification and revert.** (This was confirmed via `test_adapter_swap_expected_to_fail_due_to_architecture` in the integration test suite). 

### The Solution (Recommended Fix)
To align with the spec's intent without changing core invariants, we must adjust how the `PositionAccount` address is communicated to the hook:

1. **Dynamic `hookData`**: Instead of the adapter passing static `hookDataOf[routeId]`, the `UniswapV4VenueAdapter` should dynamically encode the `PositionAccount` address (which it already receives as `d.recipient` via the `SwapCallbackData`) into the `hookData` parameter of `poolManager.swap()`. 
2. **Hook Authorization**: The `OptionSettlementHook` should be initialized with the trusted `UniswapV4VenueAdapter` address. 
3. **Modified Hook Verification**: 
   - If `sender == address(trustedAdapter)`, the hook decodes the `PositionAccount` from `hookData`.
   - The hook then performs the `IERC6551Account(positionAccount).token()` verification on the decoded address to grant the 0-fee waiver and apply netting logic.

This securely resolves the `msg.sender` discrepancy while maintaining the precise security model outlined in the specification (malicious spoofing of `hookData` is mitigated because the Adapter is the only contract authorized to dictate the `PositionAccount` address to the hook, and the Adapter pulls actual user tokens for the swap).

## 4. Conclusion

The current codebase strictly adheres to the provided `INITIAL_SPECIFICATION.md` and tests pass based on the described logic. However, moving forward toward production or the Frontend milestones (UV4-UV5), the `msg.sender` flaw described above must be rectified in the smart contracts to enable functional trading via the Venue Adapter. 

Please advise if you would like me to implement this architectural fix to the Adapter and Hook before proceeding to the Frontend application layer!
