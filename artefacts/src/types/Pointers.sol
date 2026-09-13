// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A position's module wiring — oracle, venue, arbiter, condition, and their
///         tolerances. Committed into the ERC-6551 `salt` alongside `Economics` and,
///         **as of v3, never stored** — see ARCHITECTURE.md §3.1-§3.3 and the schema
///         delta in §9.0 (`Pointers` moved out of account storage and into the salt;
///         `initialPointersHash` deleted).
/// @dev v2 kept this struct in account storage so LP+taker could `REPOINT` a broken
///      dependency. v3 removes that mutator entirely (ARCHITECTURE.md §1.3): every field
///      below is as immutable as `Economics`, for the same reason and via the same
///      mechanism. Do not add a setter for any field in this struct — that is exactly the
///      REPOINT-shaped mutator the §7.2 lint forbids.
struct Pointers {
    /// @dev `IPriceOracle` adapter. Normalizes to 1e18 regardless of native feed decimals.
    address oracle;
    /// @dev `ISettlementVenue` adapter.
    address venue;
    /// @dev Slot-2 signer, verified via ERC-1271. `address(0)` gives 2-of-2 naturally
    ///      (§2.5) — a legitimate configuration for counterparties who want no automation.
    address arbiter;
    /// @dev `ICondition` for this position type (§2.2).
    address condition;
    /// @dev Opaque to core; adapter-interpreted. Lets a multi-hop or v4-hook adapter ship
    ///      with no core change (§3.3).
    bytes32 routeId;
    /// @dev Must be right at mint (Q13, DECISIONS.md) — cannot be corrected afterward.
    ///      Validated against `IPriceOracle.cadenceHint()` as a floor at mint (§2.3, §3.6
    ///      step 7).
    uint32 maxPriceAge;
    /// @dev <= 500 (5%). Applied on top of the oracle price when deriving `minAmountOut` —
    ///      never derived from the venue's own quote (§3.4).
    uint16 slippageBps;
}
