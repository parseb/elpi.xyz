// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The economic terms of one position. Committed into the ERC-6551 `salt`
///         (TermsLib.termsSalt) and never stored — see ARCHITECTURE.md §3.1-§3.3.
/// @dev Every field here is part of I2 (ARCHITECTURE.md §0): none can change after mint
///      without changing the account's address, which is to say none can change at all.
struct Economics {
    /// @dev Static for the position's life (Q3, DECISIONS.md). An LP cannot be swapped
    ///      into a live agreement; partial capacity is managed by `reduceCommitment`
    ///      (§3.7) on the *unfilled* offer, not by touching a minted position.
    address lp;
    /// @dev Collateral asset and its `decimals()`, queried via staticcall at mint and
    ///      pinned here — never assumed (§3.3, §7.2 lint).
    address collateralAsset;
    uint8 collateralDecimals;
    /// @dev Settlement asset and its `decimals()`, queried and pinned identically.
    address settlementAsset;
    uint8 settlementDecimals;
    /// @dev 0 = CALL, 1 = PUT.
    uint8 optionType;
    uint256 units;
    /// @dev Generalizes OptionHood's hardcoded "0.1 Share" multiplier to
    ///      `unitScalarNum / unitScalarDen` for any contract multiplier, no fixed-point
    ///      library required (§3.3).
    uint256 unitScalarNum;
    uint256 unitScalarDen;
    /// @dev Normalized to 1e18 at the oracle-adapter boundary at mint, regardless of the
    ///      oracle's native decimals (§3.3) — deletes the class of bug OptionHood had from
    ///      threading raw 8dp Chainlink values through `1e20` constants.
    uint256 entryPrice;
    uint64 expiry;
    /// @dev <= 100 (1%), fixed at mint (I4). Withheld from every position-asset outflow
    ///      directed at the taker slot, on every path, rounded up (§3.6).
    uint16 feeBps;
}
