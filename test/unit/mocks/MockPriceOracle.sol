// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockPriceOracle as CoreMockPriceOracle} from "../../../src/mocks/MockPriceOracle.sol";

/// @title MockPriceOracle (test fixture alias)
contract MockPriceOracle is CoreMockPriceOracle {
    constructor(
        address collateralAsset_,
        address settlementAsset_,
        uint256 initialPrice_,
        uint8 feedDecimals_,
        string memory description_
    ) CoreMockPriceOracle(collateralAsset_, settlementAsset_, initialPrice_, feedDecimals_, description_) {}
}
