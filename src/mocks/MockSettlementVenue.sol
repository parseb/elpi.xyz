// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISettlementVenue} from "../interfaces/ISettlementVenue.sol";

/// @title MockSettlementVenue
/// @notice Controllable settlement venue implementing ISettlementVenue.
/// @dev Allows the Dev Console to steer exchange rates via setRate(numerator, denominator)
///      synchronously with the mock oracle, preventing slippage reverts.
contract MockSettlementVenue is ISettlementVenue {
    using SafeERC20 for IERC20;

    uint256 public rateNumerator = 1;
    uint256 public rateDenominator = 1;

    event RateUpdated(uint256 indexed numerator, uint256 indexed denominator);

    /// @notice Steer venue swap rate atomically with oracle price.
    /// @param numerator Numerator representing (price_1e18 * 10^settlementDecimals) / 1e18.
    /// @param denominator Denominator representing 10^collateralDecimals.
    function setRate(uint256 numerator, uint256 denominator) external {
        require(denominator > 0, "MockSettlementVenue: zero denominator");
        rateNumerator = numerator;
        rateDenominator = denominator;
        emit RateUpdated(numerator, denominator);
    }

    /// @inheritdoc ISettlementVenue
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 /* routeId */
    ) external override returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "MockSettlementVenue: expired deadline");

        // Determine forward (collateral -> settlement) vs reverse (settlement -> collateral)
        // using token decimals
        uint8 inDec = 18;
        uint8 outDec = 6;
        try IERC20Metadata(tokenIn).decimals() returns (uint8 d) {
            inDec = d;
        } catch {}
        try IERC20Metadata(tokenOut).decimals() returns (uint8 d) {
            outDec = d;
        } catch {}

        if (inDec >= outDec) {
            amountOut = (amountIn * rateNumerator) / rateDenominator;
        } else {
            amountOut = (amountIn * rateDenominator) / rateNumerator;
        }

        require(amountOut >= minAmountOut, "MockSettlementVenue: slippage exceeded");

        // Pull tokenIn
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Ensure venue has sufficient reserves; auto-mint if token supports mint()
        uint256 currentBalance = IERC20(tokenOut).balanceOf(address(this));
        if (currentBalance < amountOut) {
            uint256 deficit = amountOut - currentBalance;
            // Attempt to mint deficit if token is a test token
            (bool minted,) = tokenOut.call(abi.encodeWithSignature("mint(address,uint256)", address(this), deficit));
            if (!minted) {
                // If minting fails, check if balance suffices
                require(currentBalance >= amountOut, "MockSettlementVenue: insufficient venue reserves");
            }
        }

        // Deliver tokenOut
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }

    /// @inheritdoc ISettlementVenue
    function quote(address tokenIn, address tokenOut, uint256 amountIn, bytes32 /* routeId */ )
        external
        view
        override
        returns (uint256 amountOut)
    {
        uint8 inDec = 18;
        uint8 outDec = 6;
        try IERC20Metadata(tokenIn).decimals() returns (uint8 d) {
            inDec = d;
        } catch {}
        try IERC20Metadata(tokenOut).decimals() returns (uint8 d) {
            outDec = d;
        } catch {}

        if (inDec >= outDec) {
            amountOut = (amountIn * rateNumerator) / rateDenominator;
        } else {
            amountOut = (amountIn * rateDenominator) / rateNumerator;
        }
    }
}
