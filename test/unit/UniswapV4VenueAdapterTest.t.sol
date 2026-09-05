// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {UniswapV4VenueAdapter} from "../../src/adapters/UniswapV4VenueAdapter.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {TestERC20} from "./mocks/TestERC20.sol";

/// @notice Unit tests for UniswapV4VenueAdapter — all 10 cases from spec §8.1.
contract UniswapV4VenueAdapterTest is Test {
    UniswapV4VenueAdapter internal adapter;
    MockPoolManager internal mockPM;
    TestERC20 internal tokenA;
    TestERC20 internal tokenB;

    address internal CALLER = makeAddr("positionAccount");

    uint256 internal constant MOCK_AMOUNT_OUT = 950e18;
    uint256 internal constant AMOUNT_IN = 1_000e18;
    uint256 internal constant MIN_AMOUNT_OUT = 900e18;
    uint256 internal constant DEADLINE = type(uint256).max;

    PoolKey internal key;
    bytes32 internal routeId;

    function setUp() public {
        // Deploy test tokens
        tokenA = new TestERC20("Token A", "TKNA", 18);
        tokenB = new TestERC20("Token B", "TKNB", 18);

        // Ensure tokenA.address < tokenB.address for v4 currency ordering
        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        // Deploy mock PoolManager
        mockPM = new MockPoolManager(MOCK_AMOUNT_OUT);

        // Deploy adapter
        adapter = new UniswapV4VenueAdapter(address(mockPM));

        // Build a PoolKey and register a route
        key = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        routeId = keccak256(abi.encode(key));
        adapter.registerRoute(key, "");

        // Fund CALLER with tokenA and approve adapter
        tokenA.mint(CALLER, AMOUNT_IN * 10);
        vm.prank(CALLER);
        tokenA.approve(address(adapter), type(uint256).max);

        // Fund mockPM with tokenB to simulate swap output
        tokenB.mint(address(mockPM), MOCK_AMOUNT_OUT * 10);
    }

    // ─── Test 1: swap() returns amountOut correctly ──────────────────────────

    function test_swap_returnsAmountOut() public {
        vm.prank(CALLER);
        uint256 out = adapter.swap(address(tokenA), address(tokenB), AMOUNT_IN, MIN_AMOUNT_OUT, DEADLINE, routeId);
        assertEq(out, MOCK_AMOUNT_OUT, "amountOut mismatch");
    }

    // ─── Test 2: expired deadline reverts ────────────────────────────────────

    function test_swap_expiredDeadline_reverts() public {
        uint256 expiredDeadline = block.timestamp - 1;
        vm.prank(CALLER);
        vm.expectRevert(
            abi.encodeWithSelector(UniswapV4VenueAdapter.SwapExpired.selector, expiredDeadline, block.timestamp)
        );
        adapter.swap(address(tokenA), address(tokenB), AMOUNT_IN, MIN_AMOUNT_OUT, expiredDeadline, routeId);
    }

    // ─── Test 3: unknown routeId reverts ─────────────────────────────────────

    function test_swap_unknownRoute_reverts() public {
        bytes32 unknown = keccak256("unknown");
        vm.prank(CALLER);
        vm.expectRevert(abi.encodeWithSelector(UniswapV4VenueAdapter.UnknownRoute.selector, unknown));
        adapter.swap(address(tokenA), address(tokenB), AMOUNT_IN, MIN_AMOUNT_OUT, DEADLINE, unknown);
    }

    // ─── Test 4: amountOut < minAmountOut reverts ─────────────────────────────

    function test_swap_slippageExceeded_reverts() public {
        uint256 tooHighMin = MOCK_AMOUNT_OUT + 1;
        vm.prank(CALLER);
        vm.expectRevert(
            abi.encodeWithSelector(UniswapV4VenueAdapter.SlippageExceeded.selector, MOCK_AMOUNT_OUT, tooHighMin)
        );
        adapter.swap(address(tokenA), address(tokenB), AMOUNT_IN, tooHighMin, DEADLINE, routeId);
    }

    // ─── Test 5: unlockCallback from non-PoolManager reverts ─────────────────

    function test_unlockCallback_onlyPoolManager() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(UniswapV4VenueAdapter.OnlyPoolManager.selector);
        adapter.unlockCallback("");
    }

    // ─── Test 6: registerRoute stores key and hookData ───────────────────────

    function test_registerRoute_storesKeyAndHookData() public {
        PoolKey memory newKey = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(0))
        });
        bytes memory hData = abi.encode("some_hook_data");
        adapter.registerRoute(newKey, hData);

        bytes32 id = keccak256(abi.encode(newKey));
        (,, uint24 storedFee, int24 storedTickSpacing,) = adapter.poolKeyOf(id);
        assertEq(storedFee, 500, "fee mismatch");
        assertEq(storedTickSpacing, 10, "tickSpacing mismatch");
        assertEq(adapter.hookDataOf(id), hData, "hookData mismatch");
    }

    // ─── Test 7: idempotent re-registration is a no-op (same key) ───────────

    function test_registerRoute_idempotentSameKey() public {
        // Re-registering with the exact same key should not revert (idempotent).
        adapter.registerRoute(key, ""); // already registered in setUp
        // Confirm key still stored correctly
        (,, uint24 storedFee2,,) = adapter.poolKeyOf(routeId);
        assertEq(storedFee2, 3000, "fee should still be 3000");
    }

    // ─── Test 8: routeId derivation matches keccak256(abi.encode(key)) ───────

    function test_routeId_derivation() public view {
        bytes32 expected = keccak256(abi.encode(key));
        assertEq(routeId, expected, "routeId derivation mismatch");
    }

    // ─── Test 9: adapter holds zero balance after swap ────────────────────────

    function test_swap_adapterBalanceZeroAfterSwap() public {
        vm.prank(CALLER);
        adapter.swap(address(tokenA), address(tokenB), AMOUNT_IN, MIN_AMOUNT_OUT, DEADLINE, routeId);
        assertEq(tokenA.balanceOf(address(adapter)), 0, "tokenA leftover in adapter");
        assertEq(tokenB.balanceOf(address(adapter)), 0, "tokenB leftover in adapter");
    }

    // ─── Test 10: caller receives amountOut directly (no hop through adapter) ─

    function test_swap_outputDeliveredDirectlyToCaller() public {
        uint256 balBefore = tokenB.balanceOf(CALLER);
        vm.prank(CALLER);
        adapter.swap(address(tokenA), address(tokenB), AMOUNT_IN, MIN_AMOUNT_OUT, DEADLINE, routeId);
        uint256 balAfter = tokenB.balanceOf(CALLER);
        assertEq(balAfter - balBefore, MOCK_AMOUNT_OUT, "caller did not receive amountOut directly");
    }

    // ─── Test 11: quote() always returns 0 (advisory per spec) ──────────────

    function test_quote_returnsZero() public view {
        uint256 q = adapter.quote(address(tokenA), address(tokenB), 1e18, routeId);
        assertEq(q, 0, "quote must return 0 (advisory only)");
    }

    // ─── Test 12: ZeroAddress on construction reverts ────────────────────────

    function test_constructor_zeroAddress_reverts() public {
        vm.expectRevert(UniswapV4VenueAdapter.ZeroAddress.selector);
        new UniswapV4VenueAdapter(address(0));
    }
}
