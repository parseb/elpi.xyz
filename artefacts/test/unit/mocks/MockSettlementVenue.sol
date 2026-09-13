// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// TEST FIXTURE — not production code. Fresh from test/gas's cost-model venue so nothing
// here can retroactively touch GAS.md's numbers.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISettlementVenue} from "../../../src/interfaces/ISettlementVenue.sol";

contract MockSettlementVenue is ISettlementVenue {
    uint256 public rateNumerator = 1;
    uint256 public rateDenominator = 1;

    /// @notice Test-only configuration hook.
    function setRate(uint256 numerator, uint256 denominator) external {
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    /// @inheritdoc ISettlementVenue
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, bytes32)
        external
        returns (uint256 amountOut)
    {
        require(block.timestamp <= deadline, "expired");
        uint256 forward = (amountIn * rateNumerator) / rateDenominator;
        if (forward >= minAmountOut) {
            amountOut = forward;
        } else {
            amountOut = (amountIn * rateDenominator) / rateNumerator;
        }
        require(amountOut >= minAmountOut, "slippage");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);
    }

    /// @inheritdoc ISettlementVenue
    function quote(address, address, uint256 amountIn, bytes32) external view returns (uint256) {
        uint256 forward = (amountIn * rateNumerator) / rateDenominator;
        return forward > 0 ? forward : (amountIn * rateDenominator) / rateNumerator;
    }
}
