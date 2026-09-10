// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IV4LiquidityVault
/// @notice Minimal interface for LPRouter to interact with V4LiquidityVault for single-tx atomic extraction.
interface IV4LiquidityVault {
    /// @notice Atomically removes liquidity from Uniswap v4 and transfers raw ERC-20 to msg.sender (LPRouter).
    /// @param asset Address of the collateral asset to extract.
    /// @param amount Amount of raw ERC-20 collateral to extract.
    function extractForMint(address asset, uint256 amount) external;
}
