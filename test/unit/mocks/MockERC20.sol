// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20 as CoreMockERC20} from "../../../src/mocks/MockERC20.sol";

/// @title MockERC20 (test fixture alias)
contract MockERC20 is CoreMockERC20 {
    constructor(string memory name_, string memory symbol_, uint8 decimals_) CoreMockERC20(name_, symbol_, decimals_) {}
}
