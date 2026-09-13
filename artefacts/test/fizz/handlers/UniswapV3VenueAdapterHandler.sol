// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Handles the interaction with UniswapV3VenueAdapter
abstract contract UniswapV3VenueAdapterHandler is Properties {

    function uniswapV3VenueAdapter_swap_clamped(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, bytes32 routeId) public {
        uniswapV3VenueAdapter_swap(tokenIn, tokenOut, amountIn, minAmountOut, deadline, routeId);
    }

    function uniswapV3VenueAdapter_swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, bytes32 routeId) public asActor {
    }
}
