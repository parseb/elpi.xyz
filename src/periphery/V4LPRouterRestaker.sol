// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V4LiquidityVault} from "./V4LiquidityVault.sol";

/// @title V4LPRouterRestaker
/// @author parseb
/// @notice Periphery helper enabling atomic multi-backer position settlement and
///         V4LiquidityVault re-staking in a single transaction (UV-Q6, Milestone UV3).
///
/// @dev    Invariant I1: Does not hold funds or tokens. All settlement funds flow directly
///         between PositionAccount, LPRouter, and V4LiquidityVault.
/// @dev    Invariant I3: Calls V4LiquidityVault.restakeFromRouter(), which absorbs restake
///         failures safely without reverting the settlement.
contract V4LPRouterRestaker {
    /// @notice Thrown when array lengths do not match in batch operations.
    error LengthMismatch();

    /// @notice Thrown when low-level settlement call fails.
    /// @param returnData The raw revert data from the target.
    error SettlementCallFailed(bytes returnData);

    /// @notice Thrown when a zero address parameter is provided where prohibited.
    error ZeroAddress();

    /// @notice Emitted when settlement and restake execute atomically.
    /// @param target The target contract called.
    /// @param vault The V4LiquidityVault restaked.
    /// @param asset The asset restaked.
    event SettledAndRestaked(address indexed target, address indexed vault, address indexed asset);

    /// @notice Emitted when a vault restake is performed.
    /// @param vault The V4LiquidityVault restaked.
    /// @param asset The asset restaked.
    event VaultRestaked(address indexed vault, address indexed asset);

    /// @notice Triggers restake on a V4LiquidityVault from its configured LPRouter.
    /// @param vault The V4LiquidityVault to restake for.
    /// @param asset The asset address to withdraw and restake.
    function restakeVault(address vault, address asset) external {
        if (vault == address(0) || asset == address(0)) revert ZeroAddress();
        V4LiquidityVault(vault).restakeFromRouter(asset);
        emit VaultRestaked(vault, asset);
    }

    /// @notice Clustered restake: restakes multiple assets or vaults in a single transaction.
    /// @param vaults Array of V4LiquidityVault addresses.
    /// @param assets Array of asset addresses matching each vault.
    function batchRestake(address[] calldata vaults, address[] calldata assets) external {
        uint256 length = vaults.length;
        if (length != assets.length) revert LengthMismatch();

        for (uint256 i = 0; i < length; i++) {
            if (vaults[i] == address(0) || assets[i] == address(0)) revert ZeroAddress();
            V4LiquidityVault(vaults[i]).restakeFromRouter(assets[i]);
            emit VaultRestaked(vaults[i], assets[i]);
        }
    }

    /// @notice Atomically triggers settlement on an account or router, then restakes to the vault.
    /// @param settlementTarget The contract to call settlement on (e.g. LPRouter or PositionAccount).
    /// @param settlementData The ABI-encoded calldata for the settlement call.
    /// @param vault The V4LiquidityVault participating as a backer.
    /// @param asset The token asset to restake.
    /// @return result The return data from the settlement call.
    function settleAndRestake(address settlementTarget, bytes calldata settlementData, address vault, address asset)
        external
        returns (bytes memory result)
    {
        if (settlementTarget == address(0) || vault == address(0) || asset == address(0)) {
            revert ZeroAddress();
        }

        // 1. Execute settlement on target (e.g., LPRouter.settleAndCredit or PositionAccount.settleToLp)
        (bool success, bytes memory ret) = settlementTarget.call(settlementData);
        if (!success) {
            revert SettlementCallFailed(ret);
        }
        result = ret;

        // 2. Withdraw and restake from LPRouter into Uniswap v4
        V4LiquidityVault(vault).restakeFromRouter(asset);

        emit SettledAndRestaked(settlementTarget, vault, asset);
    }
}
