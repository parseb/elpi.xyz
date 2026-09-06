// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ILPRouter
/// @author parseb
/// @notice Minimal interface for LPRouter backer withdrawals and settlement credits in elpi.xyz.
interface ILPRouter {
    /// @notice Emitted when backer settlement proceeds are credited to their claimable ledger.
    /// @param positionId The position identifier settled.
    /// @param backer The backer address credited.
    /// @param asset The token asset address.
    /// @param amount The credited amount.
    event Credited(uint256 indexed positionId, address indexed backer, address indexed asset, uint256 amount);

    /// @notice Emitted when a backer withdraws claimable proceeds.
    /// @param backer The backer address withdrawing.
    /// @param asset The token asset address.
    /// @param amount The withdrawn amount.
    event Withdrawn(address indexed backer, address indexed asset, uint256 amount);

    /// @notice Withdraw accumulated claimable settlement proceeds for msg.sender.
    /// @param asset The token asset address to withdraw.
    function withdraw(address asset) external;

    /// @notice View claimable settlement proceeds for a backer and asset.
    /// @param backer The backer address.
    /// @param asset The token asset address.
    /// @return The claimable token balance.
    function claimable(address backer, address asset) external view returns (uint256);
}
