// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPositionAccountMintHooks {
    function recordMint(uint256 recordedCollateral, uint256 recordedSettlement) external;
    function initialSwapAndRecord(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 routeId,
        address venue
    ) external;
}
