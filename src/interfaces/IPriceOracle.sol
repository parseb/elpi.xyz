// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IPriceOracle
/// @author parseb
/// @notice Normalized price oracle interface for the elpi protocol (ARCHITECTURE.md §3.4).
interface IPriceOracle {
    /// @notice Reads the current price of collateralAsset denominated in settlementAsset.
    /// @param collateralAsset Address of the collateral asset.
    /// @param settlementAsset Address of the settlement payout asset.
    /// @return normalizedPrice Always scaled to 1e18, regardless of the underlying feed's decimals.
    /// @return updatedAt The timestamp of the underlying observation, for staleness checks against maxPriceAge.
    function price(address collateralAsset, address settlementAsset)
        external
        view
        returns (uint256 normalizedPrice, uint256 updatedAt);

    /// @notice A stable identifier for this adapter, for curation records.
    /// @return The bytes32 identifier of this oracle adapter.
    function oracleId() external view returns (bytes32);

    /// @notice Discloses whether this adapter substitutes a fiat reference for the settlement asset.
    /// @return assumesPeg True if peg assumption is made.
    /// @return pegged The address to which parity is assumed.
    function pegAssumption() external view returns (bool assumesPeg, address pegged);

    /// @notice Expected update cadence hint in seconds under normal operation.
    /// @return The cadence hint in seconds.
    function cadenceHint() external view returns (uint32);
}
