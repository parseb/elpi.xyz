// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Handles the interaction with AerodromeVenueAdapter
abstract contract AerodromeVenueAdapterHandler is Properties {

    function aerodromeVenueAdapter_swap_clamped(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, bytes32 routeId) public {
        aerodromeVenueAdapter_swap(tokenIn, tokenOut, amountIn, minAmountOut, deadline, routeId);
    }

    function aerodromeVenueAdapter_swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, bytes32 routeId) public asActor {
    }
}
