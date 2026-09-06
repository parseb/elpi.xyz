// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ILPRouter
/// @notice Minimal interface for LPRouter backer withdrawals and settlement credits
interface ILPRouter {
    event Credited(uint256 indexed positionId, address indexed backer, address indexed asset, uint256 amount);
    event Withdrawn(address indexed backer, address indexed asset, uint256 amount);

    /// @notice Withdraw accumulated claimable settlement proceeds for msg.sender
    function withdraw(address asset) external;

    /// @notice View claimable settlement proceeds for a backer and asset
    function claimable(address backer, address asset) external view returns (uint256);
}
