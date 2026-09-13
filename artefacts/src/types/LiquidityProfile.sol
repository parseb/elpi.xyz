// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice An LP's self-contained, EIP-712-signed offer to back positions. Preserved from
///         OptionHood (ARCHITECTURE.md §4.1): signature embedded in the struct for IPFS
///         self-containment, but excluded from the struct's own hash/identity — this is
///         what lets the mainnet hub stay non-load-bearing (§6.2).
/// @dev Generalized relative to OptionHood in three ways: `chainIds` replaces a single
///      implicit chain (replay containment across the replicated stack, §6.2);
///      `totalUnits` is enforced against `IPositionManager.consumedUnits` rather than being
///      advisory; and `pointers`/`ackUnverifiedTerms` make the module wiring part of what
///      the LP signs, closing the "taker substitutes a fake oracle" half of the two-sided
///      consent in §3.5.
struct LiquidityProfile {
    address lp;
    address collateralAsset;
    address settlementAsset;
    uint16 minHours;
    uint16 maxHours;
    uint256 totalUnits;
    uint256 pricePerUnitPerHour;
    /// @dev 0 = CALL_ONLY, 1 = PUT_ONLY, 2 = BOTH. The taker picks a specific `optionType`
    ///      at mint (within this range) — added as a `mint()` parameter (Milestone 4
    ///      correction: an earlier draft of `mint()` had no way for a taker to choose
    ///      between CALL/PUT under a `BOTH` profile at all).
    uint8 supportsOptionType;
    /// @dev Generalizes OptionHood's hardcoded "0.1 Share" multiplier (§3.3) — the LP sets
    ///      its own contract multiplier per profile. Milestone 4 correction: `Economics`
    ///      already generalized this field, but nothing upstream of it supplied a value
    ///      until this profile carried one — `unitScalarNum`/`unitScalarDen` had no source
    ///      at mint time before this.
    uint256 unitScalarNum;
    uint256 unitScalarDen;
    /// @dev The oracle/venue/arbiter/condition/routeId/maxPriceAge/slippageBps the LP is
    ///      willing to have this offer minted against — committed here so a taker cannot
    ///      substitute a different pointer set at mint (§3.5).
    address oracle;
    address venue;
    address arbiter;
    address condition;
    bytes32 routeId;
    uint32 maxPriceAge;
    uint16 slippageBps;
    /// @dev Must be true if `oracle`/`venue`/`condition` are not `ModuleRegistry`-curated;
    ///      the taker's mint call must independently set the matching acknowledgement, or
    ///      mint reverts (§3.5).
    bool ackUnverifiedTerms;
    /// @dev Chain IDs this profile is valid on. A profile can never be replayed onto a
    ///      chain the LP didn't name (§6.2) — checked against `block.chainid` at mint.
    uint256[] chainIds;
    uint256 timestamp;
    uint256 nonce;
    /// @dev Embedded for IPFS self-containment; zeroed before hashing so it is excluded
    ///      from the profile's own identity (§2.4).
    bytes signature;
}
