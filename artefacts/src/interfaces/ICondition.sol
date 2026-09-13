// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActionContext} from "../types/ActionContext.sol";

/// @title ICondition
/// @author parseb
/// @notice The pluggability seam for a position type's settlement semantics
///         (ARCHITECTURE.md §2.2).
/// @dev Schema delta from v2 (§9.0): `check` no longer takes a separate `Pointers`
///      argument. Under v2 a condition could trust pointers read from account storage;
///      under v3 there is no such storage, and `ctx` already carries pointers that
///      `ConditionArbiter` has independently re-verified (via `TermsLib.deriveAccount`)
///      before calling here — so a condition MUST NOT `SLOAD` terms from anywhere (§7.2
///      lint) and should treat `ctx.economics`/`ctx.pointers` as the verified source of
///      truth.
interface ICondition {
    /// @notice Evaluates whether `ctx`'s action is currently authorizable.
    /// @dev View, not pure: conditions that need a live price (e.g. `TakerProfitCondition`)
    ///      call `IPriceOracle.price` here. `ExpiryCondition` is the load-bearing exception —
    ///      it must be satisfiable from `block.timestamp` alone, with no oracle read, so
    ///      that `SettleToLp` survives a reverting oracle (I3).
    /// @param ctx Verified action context (see `ActionContext` NatSpec).
    /// @param hint Opaque, condition-specific auxiliary data (e.g. a route hint for a swap
    ///        the condition needs to price) — never trusted for anything the condition
    ///        itself doesn't re-derive or re-check.
    function check(ActionContext calldata ctx, bytes calldata hint) external view returns (bool);

    /// @notice A stable identifier for this condition implementation, for curation records
    ///         and off-chain tooling (ARCHITECTURE.md §3.5).
    function conditionId() external pure returns (bytes32);
}
