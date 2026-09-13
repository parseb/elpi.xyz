// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISettlementVenue} from "../interfaces/ISettlementVenue.sol";

/// @dev The real, deployed `SwapRouter02.exactInputSingle` ABI — confirmed against the live
///      contract on Base (selector `0x04e45aaf`), NOT assumed from documentation or from the
///      older v3-periphery `ISwapRouter` shape. This is exactly OptionHood's bug #1: the
///      older `ISwapRouter.ExactInputSingleParams` has a `deadline` field this struct does
///      NOT have — using that shape here would produce a selector matching no real function
///      and the swap would revert immediately. `deadline` is enforced locally instead
///      (below), never passed to the router.
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swaps `params.amountIn` of `params.tokenIn` for `params.tokenOut`.
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title UniswapV3VenueAdapter
/// @author parseb
/// @notice A real `ISettlementVenue` adapter over a real Uniswap V3 `SwapRouter02`
///         (ARCHITECTURE.md §3.4, §6.1, §7.3). Chain-specific, human-written, fork-verified
///         against the deployed router's real ABI.
/// @dev `routeId` is this adapter's opaque, adapter-interpreted identifier (§3.3): here it
///      packs the pool fee tier as a `uint24` (e.g. `500` for the 0.05% tier), matching
///      Uniswap V3's own fee-tier encoding. A different chain's venue adapter is free to
///      interpret `routeId` completely differently — core never inspects it.
contract UniswapV3VenueAdapter is ISettlementVenue {
    using SafeERC20 for IERC20;

    ISwapRouter02 public immutable router;

    error SwapExpired(uint256 deadline, uint256 currentTimestamp);

    constructor(address router_) {
        router = ISwapRouter02(router_);
    }

    /// @inheritdoc ISettlementVenue
    /// @dev Pulls `amountIn` of `tokenIn` from `msg.sender` (the calling `PositionAccount`,
    ///      which must have approved this adapter first — mirroring the labelled cost
    ///      model's contract, §9.0) and has the router deliver `tokenOut` directly back to
    ///      `msg.sender`, avoiding an unnecessary intermediate hop through this adapter.
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
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: uint24(uint256(routeId)),
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @inheritdoc ISettlementVenue
    /// @dev Advisory only, per the interface's own NatSpec — deliberately NOT implemented
    ///      as a real quote here (would require reading pool state and replicating Uniswap's
    ///      tick math, real work with no safety payoff since the value returned can never
    ///      be used to derive `minAmountOut`). A production deployment wanting a real
    ///      pre-trade liquidity check should use Uniswap's own `QuoterV2` off-chain, which is
    ///      exactly what the companion app's pre-trade check (§8 item 2) is specified to do
    ///      — this function existing on-chain at all is what the interface requires, not
    ///      what §8's liquidity check actually calls.
    function quote(address, address, uint256, bytes32) external pure returns (uint256) {
        return 0;
    }
}
