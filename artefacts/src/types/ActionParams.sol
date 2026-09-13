// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct SettleToTakerParams {
    uint256 exitPrice;
    uint256 minAmountOut;
    uint256 minPayoutToTaker;
    uint256 swapDeadline;
}

struct MutualUnwindParams {
    uint16 takerBps;
}
