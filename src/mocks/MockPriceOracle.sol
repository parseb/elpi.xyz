// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title MockPriceOracle
/// @author parseb
/// @notice Controllable mock oracle implementing both elpi's IPriceOracle interface
///         and Chainlink's AggregatorV3Interface.
/// @dev Used by Dev Console and automated E2E tests to manipulate spot prices and timestamps.
contract MockPriceOracle is IPriceOracle {
    uint256 public mockPrice;
    uint256 public mockUpdatedAt;
    uint8 public immutable feedDecimals;
    string public description;
    uint256 public version = 1;

    bool public shouldRevert;

    address public immutable collateralAsset;
    address public immutable settlementAsset;

    event PriceUpdated(uint256 indexed newPrice, uint256 indexed updatedAt);

    error OracleReverting();

    constructor(
        address collateralAsset_,
        address settlementAsset_,
        uint256 initialPrice_,
        uint8 feedDecimals_,
        string memory description_
    ) {
        collateralAsset = collateralAsset_;
        settlementAsset = settlementAsset_;
        mockPrice = initialPrice_;
        mockUpdatedAt = block.timestamp;
        feedDecimals = feedDecimals_ > 0 ? feedDecimals_ : 8;
        description = description_;
    }

    /// @notice Test-only setter to steer price and timestamp freshness on the fly.
    /// @param price_ Normalized price scaled to 1e18.
    /// @param updatedAt_ Block timestamp. If 0, uses current block.timestamp.
    function setPrice(uint256 price_, uint256 updatedAt_) external {
        mockPrice = price_;
        mockUpdatedAt = updatedAt_ == 0 ? block.timestamp : updatedAt_;
        emit PriceUpdated(mockPrice, mockUpdatedAt);
    }

    /// @notice Simulates oracle failure/downtime for testing oracle-free settlement (Invariant I3).
    function setShouldRevert(bool revert_) external {
        shouldRevert = revert_;
    }

    /// @notice Convenient getter for dev console inspection.
    function getPrice() external view returns (uint256, uint256) {
        if (shouldRevert) revert OracleReverting();
        return (mockPrice, mockUpdatedAt);
    }

    // ─── IPriceOracle Implementation ──────────────────────────────────────────

    /// @inheritdoc IPriceOracle
    function price(address, /*collateralAsset_*/ address /*settlementAsset_*/ )
        external
        view
        override
        returns (uint256 normalizedPrice, uint256 updatedAt)
    {
        if (shouldRevert) revert OracleReverting();
        // Return configured mock values
        return (mockPrice, mockUpdatedAt);
    }

    /// @inheritdoc IPriceOracle
    function oracleId() external view override returns (bytes32) {
        return keccak256(abi.encode("MockPriceOracle", collateralAsset, settlementAsset));
    }

    /// @inheritdoc IPriceOracle
    function pegAssumption() external pure override returns (bool assumesPeg, address pegged) {
        return (false, address(0));
    }

    /// @inheritdoc IPriceOracle
    function cadenceHint() external pure override returns (uint32) {
        return 1800; // 30 minutes
    }

    // ─── Chainlink AggregatorV3Interface Compatibility ────────────────────────

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (shouldRevert) revert OracleReverting();
        // Convert 1e18 normalized mock price to feedDecimals (typically 8 for USD feeds)
        int256 scaledAnswer = feedDecimals <= 18
            ? int256(mockPrice / (10 ** (18 - feedDecimals)))
            : int256(mockPrice * (10 ** (feedDecimals - 18)));

        return (1, scaledAnswer, mockUpdatedAt, mockUpdatedAt, 1);
    }

    function decimals() external view returns (uint8) {
        return feedDecimals;
    }
}
