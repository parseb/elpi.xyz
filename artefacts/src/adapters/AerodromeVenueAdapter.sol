// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISettlementVenue} from "../interfaces/ISettlementVenue.sol";

/// @dev Aerodrome Slipstream (Concentrated Liquidity) router interface on Base.
interface IAerodromeCLRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        int24 tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title AerodromeVenueAdapter
/// @author parseb
/// @notice An `ISettlementVenue` adapter for Aerodrome Slipstream pools on Base (ARCHITECTURE.md §3.4, §7.3).
/// @dev `routeId` carries the pool tick spacing as an `int24` (e.g. 100 for 0.01% or 200 for 0.05% tick spacing),
///      matching Aerodrome Slipstream's pool configuration on Base.
contract AerodromeVenueAdapter is ISettlementVenue {
    using SafeERC20 for IERC20;

    IAerodromeCLRouter public immutable router;

    error SwapExpired(uint256 deadline, uint256 currentTimestamp);
    error ZeroAddress();

    constructor(address router_) {
        if (router_ == address(0)) revert ZeroAddress();
        router = IAerodromeCLRouter(router_);
    }

    /// @inheritdoc ISettlementVenue
    /// @dev Pulls `amountIn` of `tokenIn` from `msg.sender` (the calling `PositionAccount`),
    ///      grants allowance to the Aerodrome router, and delivers `tokenOut` directly back to `msg.sender`.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 routeId
    ) external returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert SwapExpired(deadline, block.timestamp);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).safeIncreaseAllowance(address(router), amountIn);

        amountOut = router.exactInputSingle(
            IAerodromeCLRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                tickSpacing: int24(int256(uint256(routeId))),
                recipient: msg.sender,
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @inheritdoc ISettlementVenue
    /// @dev Advisory only, per interface spec — quoter queries stay off-chain in the companion app.
    function quote(address, address, uint256, bytes32) external pure returns (uint256) {
        return 0;
    }
}
