// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal mock of IPoolManager for unit testing UniswapV4VenueAdapter.
///         Simulates unlock/swap/settle/take without real AMM math.
///         Configurable: set mockAmountOut to control the swap output.
contract MockPoolManager {
    using SafeERC20 for IERC20;

    /// @notice The simulated swap output returned to the adapter.
    uint256 public mockAmountOut;

    /// @notice If true, the swap call reverts (simulates PoolManager unavailability).
    bool public shouldRevert;

    constructor(uint256 amountOut_) {
        mockAmountOut = amountOut_;
    }

    function setMockAmountOut(uint256 amount) external {
        mockAmountOut = amount;
    }

    function setShouldRevert(bool flag) external {
        shouldRevert = flag;
    }

    /// @dev Simulates IPoolManager.unlock(): calls back into the adapter's unlockCallback.
    function unlock(bytes calldata data) external returns (bytes memory) {
        if (shouldRevert) revert("MockPoolManager: forced revert");
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    /// @dev Simulates IPoolManager.swap(): returns a BalanceDelta encoding mockAmountOut.
    ///      zeroForOne=true  → amount1 = mockAmountOut (pool owes us currency1)
    ///      zeroForOne=false → amount0 = mockAmountOut (pool owes us currency0)
    function swap(PoolKey calldata, SwapParams calldata params, bytes calldata)
        external
        view
        returns (BalanceDelta delta)
    {
        int128 out = int128(int256(mockAmountOut));
        if (params.zeroForOne) {
            // pool owes us currency1 (positive amount1)
            delta = toBalanceDelta(0, out);
        } else {
            // pool owes us currency0 (positive amount0)
            delta = toBalanceDelta(out, 0);
        }
    }

    /// @dev Simulates IPoolManager.settle(): acknowledges payment of tokenIn.
    function sync(Currency currency) external {}

    function settle() external payable returns (uint256) {
        return 0;
    }

    /// @dev Simulates IPoolManager.take(): transfers tokenOut to recipient.
    function take(Currency currency, address recipient, uint256 amount) external {
        IERC20(Currency.unwrap(currency)).safeTransfer(recipient, amount);
    }

    function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata)
        external
        returns (BalanceDelta, BalanceDelta)
    {
        if (shouldRevert) revert("MockRevert");

        int128 amount0 = int128(params.liquidityDelta);

        // Return delta only for currency0 to simulate a single-sided deposit
        // and avoid requiring the vault to have balance of currency1 (address(2)).
        return (toBalanceDelta(int128(-amount0), 0), toBalanceDelta(0, 0));
    }
}
