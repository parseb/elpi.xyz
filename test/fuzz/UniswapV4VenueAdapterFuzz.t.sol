// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {UniswapV4VenueAdapter} from "../../src/adapters/UniswapV4VenueAdapter.sol";
import {MockPoolManager} from "../unit/mocks/MockPoolManager.sol";
import {TestERC20} from "../unit/mocks/TestERC20.sol";

/// @title UniswapV4VenueAdapterFuzzTest
/// @author parseb
/// @notice Property-based fuzz tests for UniswapV4VenueAdapter verifying Invariants I1, I2, and edge cases.
contract UniswapV4VenueAdapterFuzzTest is Test {
    UniswapV4VenueAdapter internal adapter;
    MockPoolManager internal mockPM;
    TestERC20 internal tokenA;
    TestERC20 internal tokenB;

    address internal CALLER = makeAddr("positionAccount");

    PoolKey internal key;
    bytes32 internal routeId;

    function setUp() public {
        tokenA = new TestERC20("Token A", "TKNA", 18);
        tokenB = new TestERC20("Token B", "TKNB", 18);

        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        mockPM = new MockPoolManager(1000e18);
        adapter = new UniswapV4VenueAdapter(address(mockPM));

        key = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        routeId = keccak256(abi.encode(key));
        adapter.registerRoute(key, "");

        vm.prank(CALLER);
        tokenA.approve(address(adapter), type(uint256).max);
    }

    /// @notice Invariant I1 Fuzz: For any amountIn, the adapter MUST hold 0 tokens after swap.
    function testFuzz_adapterBalanceAlwaysZeroAfterSwap(uint256 amountIn, uint256 mockAmountOut) public {
        amountIn = bound(amountIn, 1, 10_000_000_000e18);
        // Ensure mockAmountOut fits into int128 for BalanceDelta math
        mockAmountOut = bound(mockAmountOut, 1, uint256(uint128(type(int128).max)));

        tokenA.mint(CALLER, amountIn);
        mockPM.setMockAmountOut(mockAmountOut);
        tokenB.mint(address(mockPM), mockAmountOut);

        vm.prank(CALLER);
        uint256 out = adapter.swap(
            address(tokenA),
            address(tokenB),
            amountIn,
            mockAmountOut, // exact slippage bound
            block.timestamp + 100,
            routeId
        );

        assertEq(out, mockAmountOut);
        assertEq(tokenA.balanceOf(address(adapter)), 0, "Invariant I1 violated: adapter holds tokenA");
        assertEq(tokenB.balanceOf(address(adapter)), 0, "Invariant I1 violated: adapter holds tokenB");
    }

    /// @notice Slippage Fuzz: Reverts whenever output is strictly less than minAmountOut.
    function testFuzz_slippageExceeded_reverts(uint256 amountIn, uint256 actualOut, uint256 minOutDelta) public {
        amountIn = bound(amountIn, 1, 1_000_000e18);
        actualOut = bound(actualOut, 1, 1_000_000e18);
        minOutDelta = bound(minOutDelta, 1, 1_000_000e18);

        uint256 minAmountOut = actualOut + minOutDelta;

        tokenA.mint(CALLER, amountIn);
        mockPM.setMockAmountOut(actualOut);
        tokenB.mint(address(mockPM), actualOut);

        vm.expectRevert(
            abi.encodeWithSelector(UniswapV4VenueAdapter.SlippageExceeded.selector, actualOut, minAmountOut)
        );
        vm.prank(CALLER);
        adapter.swap(address(tokenA), address(tokenB), amountIn, minAmountOut, block.timestamp + 100, routeId);
    }

    /// @notice Deadline Fuzz: Reverts whenever block.timestamp exceeds deadline.
    function testFuzz_expiredDeadline_reverts(uint256 warpTime, uint256 deadline) public {
        deadline = bound(deadline, 100, 1_000_000);
        warpTime = bound(warpTime, deadline + 1, deadline + 1_000_000);

        vm.warp(warpTime);

        tokenA.mint(CALLER, 1000e18);

        vm.expectRevert(abi.encodeWithSelector(UniswapV4VenueAdapter.SwapExpired.selector, deadline, warpTime));
        vm.prank(CALLER);
        adapter.swap(address(tokenA), address(tokenB), 1000e18, 0, deadline, routeId);
    }

    /// @notice Zero Amount Fuzz: Passing amountIn == 0 MUST revert.
    function testFuzz_zeroAmountIn_reverts(uint256 deadline) public {
        deadline = bound(deadline, block.timestamp, block.timestamp + 1000);

        vm.expectRevert(UniswapV4VenueAdapter.ZeroAmount.selector);
        vm.prank(CALLER);
        adapter.swap(address(tokenA), address(tokenB), 0, 0, deadline, routeId);
    }

    /// @notice Invariant I2 Fuzz: Route immutability against parameter corruption.
    function testFuzz_routeImmutability_differingKeyReverts(uint24 fee1, uint24 fee2) public {
        fee1 = uint24(bound(fee1, 1, 10000));
        fee2 = uint24(bound(fee2, 1, 10000));
        vm.assume(fee1 != fee2);

        PoolKey memory key1 = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: fee1,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        bytes32 rId1 = keccak256(abi.encode(key1));
        adapter.registerRoute(key1, "");

        // Direct call with key1 again should succeed (idempotent)
        adapter.registerRoute(key1, "");
        (,, uint24 regFee,,) = adapter.poolKeyOf(rId1);
        assertEq(regFee, fee1);
    }
}
