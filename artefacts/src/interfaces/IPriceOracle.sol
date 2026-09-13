// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IPriceOracle
/// @author parseb
/// @notice Adapter boundary normalizing any underlying price source to a common shape.
///         ARCHITECTURE.md §3.4.
/// @dev The adapter takes *both* assets rather than returning a bare USD price — this
///      permits direct pair quoting for adapters that can manage it, at no interface cost
///      (§3.4). `minAmountOut` for a venue swap is always derived from `price()`, never
///      from `ISettlementVenue.quote()` — the property that stops a pool-price manipulator
///      from forcing a worse-than-oracle fill.
interface IPriceOracle {
    /// @notice Reads the current price of `collateralAsset` denominated in
    ///         `settlementAsset`.
    /// @return normalizedPrice Always scaled to 1e18, regardless of the underlying feed's
    ///         native decimals (§3.3) — this is the adapter boundary that deletes
    ///         OptionHood's `1e20`-constant class of arithmetic bug.
    /// @return updatedAt The timestamp of the underlying observation, for staleness checks
    ///         against a position's `maxPriceAge`.
    function price(address collateralAsset, address settlementAsset)
        external
        view
        returns (uint256 normalizedPrice, uint256 updatedAt);

    /// @notice A stable identifier for this adapter, for curation records.
    /// @dev MUST encode whether this adapter quotes the pair directly or relies on a peg
    ///      assumption (e.g. a USD feed read against a stablecoin settlement asset), and
    ///      MUST change if that changes (§3.4 peg disclosure rule).
    function oracleId() external view returns (bytes32);

    /// @notice Discloses whether this adapter substitutes a fiat reference for the
    ///         settlement asset instead of quoting the pair directly.
    /// @dev Closes v2's Q6 (DECISIONS.md): a stablecoin peg assumption is permitted, but
    ///      must be declared, not silently assumed the way OptionHood read an NVDA/USD feed
    ///      while settling in USDG with no on-chain owner of that assumption. Surfaced by
    ///      the app before signing (§8.1) and recorded in the `ModuleRegistry` curation
    ///      template.
    /// @return assumesPeg True if a fiat reference is substituted for `pegged`.
    /// @return pegged The asset assumed to hold its peg, or `address(0)` if none.
    function pegAssumption() external view returns (bool assumesPeg, address pegged);

    /// @notice This feed's expected update cadence under normal operation — e.g. how long
    ///         it can go between updates during an ordinary gap (weekends/after-hours for
    ///         an equity feed, block time for an onchain TWAP).
    /// @dev Added to close Q13 (DECISIONS.md): `PositionManager` enforces this as a FLOOR
    ///      only at mint — `require(maxPriceAge >= oracle.cadenceHint())` — which is
    ///      exactly the check OptionHood's bug #2 needed (a window too tight for a feed
    ///      that updates 24/5, not 24/7) and nothing more. It is not a ceiling: "is this
    ///      window too loose for this asset's volatility" needs risk/liquidity context this
    ///      adapter cannot supply, and stays an app-side/curation-guidance concern (§3.5,
    ///      §8.1). Self-declared by the adapter, so it costs no registry read and applies
    ///      uniformly to curated and uncurated adapters alike; like every other value this
    ///      adapter returns, it is only as honest as the adapter is reviewed to be.
    function cadenceHint() external view returns (uint32);
}
