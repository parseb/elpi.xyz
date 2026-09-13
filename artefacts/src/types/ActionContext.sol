// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Economics} from "./Economics.sol";
import {Pointers} from "./Pointers.sol";
import {ActionKind} from "./ActionKind.sol";

struct ActionContext {
    address account;
    address implementation;
    uint256 homeChainId;
    address positionManager;
    uint256 positionId;
    uint256 accountState;
    uint256 signerEpoch;
    ActionKind actionKind;
    bytes params;
    uint256 deadline;
    Economics economics;
    Pointers pointers;
}
