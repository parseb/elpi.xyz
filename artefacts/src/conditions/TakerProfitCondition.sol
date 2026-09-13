// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Types
import {ActionContext} from "../types/ActionContext.sol";
import {SettleToTakerParams} from "../types/ActionParams.sol";

// Interfaces
import {ICondition} from "../interfaces/ICondition.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title TakerProfitCondition
/// @author parseb
/// @notice The `SETTLE_TO_TAKER` gate (ARCHITECTURE.md §2.2): profitable, fresh, within
///         slippage, meets `minPayoutToTaker`.
/// @dev Stateless — verified by `script/lints/no-term-sload.sh`. Every value it reasons
///      about is either read fresh from the oracle or arrives as calldata inside `ctx`.
contract TakerProfitCondition is ICondition {
    /// @inheritdoc ICondition
    function check(ActionContext calldata ctx, bytes calldata) external view returns (bool) {
        if (block.timestamp >= ctx.economics.expiry) return false;

        (uint256 livePrice, uint256 updatedAt) =
            IPriceOracle(ctx.pointers.oracle).price(ctx.economics.collateralAsset, ctx.economics.settlementAsset);

        // Guard against a future-dated `updatedAt` before subtracting — an oracle
        // returning a bogus future timestamp must be treated as untrustworthy, not as
        // "infinitely fresh" via an underflowed comparison. Solidity 0.8's checked
        // arithmetic would revert here instead of wrapping, which would break this
        // contract's — and therefore `ConditionArbiter`'s — no-revert composability.
        if (updatedAt > block.timestamp) return false;
        if (block.timestamp - updatedAt > ctx.pointers.maxPriceAge) return false;

        int256 pnl = ctx.economics.optionType == 0
            ? int256(livePrice) - int256(ctx.economics.entryPrice)
            : int256(ctx.economics.entryPrice) - int256(livePrice);
        if (pnl <= 0) return false;

        SettleToTakerParams memory p = abi.decode(ctx.params, (SettleToTakerParams));

        // The caller-asserted exitPrice must track the live oracle price within
        // slippageBps — this closes the gap between quote time (when exitPrice was chosen)
        // and execution time (now), without trusting the caller's figure outright.
        uint256 priceDiff = p.exitPrice > livePrice ? p.exitPrice - livePrice : livePrice - p.exitPrice;
        if (priceDiff > (livePrice * ctx.pointers.slippageBps) / 10_000) return false;

        // Recomputed payout from the live price, rescaled from the oracle's 1e18
        // fixed-point normalization into the settlement asset's own decimals (§3.3) — never
        // mix the two scales directly.
        //
        // Milestone 4 correction: an earlier draft computed
        // `wholeUnits = (units * unitScalarNum) / unitScalarDen` as a truncated INTERMEDIATE
        // integer before using it here. Every test up to that point used
        // units=10/scalarNum=1/scalarDen=10 (wholeUnits == 1 exactly), which never exercised
        // the truncation — but a fractional position (e.g. units=5 with the same scalar)
        // would have silently computed wholeUnits=0 and zeroed the payout entirely. Fixed by
        // deferring the division by `unitScalarDen` to the single final division below,
        // alongside `1e18`, so there is only ever one truncation, at the end.
        uint256 recomputedPayout = (uint256(pnl) * ctx.economics.units * ctx.economics.unitScalarNum
            * (10 ** ctx.economics.settlementDecimals)) / (ctx.economics.unitScalarDen * 1e18);

        return recomputedPayout >= p.minPayoutToTaker;
    }

    /// @inheritdoc ICondition
    function conditionId() external pure returns (bytes32) {
        return keccak256("TakerProfitCondition/v3");
    }
}
