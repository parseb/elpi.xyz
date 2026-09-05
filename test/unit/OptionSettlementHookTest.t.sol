// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OptionSettlementHook} from "../../src/hooks/OptionSettlementHook.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

contract OptionSettlementHookTest is Test {
    OptionSettlementHook internal hook;
    MockPoolManager internal poolManager;

    address internal owner = makeAddr("owner");
    address internal knownPM = makeAddr("knownPM");
    address internal unknownPM = makeAddr("unknownPM");

    address internal validAccount = makeAddr("validAccount");
    address internal invalidAccount = makeAddr("invalidAccount");
    address internal eoa = makeAddr("eoa"); // No contract code

    PoolKey internal dummyKey;

    event SwapExecuted(uint256 indexed timestamp, int128 amount0, int128 amount1);
    event NetCross(address indexed posA, address indexed posB, address asset, uint256 amount);

    function setUp() public {
        poolManager = new MockPoolManager(0);

        vm.prank(owner);
        hook = new OptionSettlementHook(IPoolManager(address(poolManager)), owner);

        vm.prank(owner);
        hook.addPositionManager(knownPM);

        // Setup mock for valid ERC6551 account
        vm.mockCall(validAccount, abi.encodeWithSignature("token()"), abi.encode(block.chainid, knownPM, 1));

        // Setup mock for invalid ERC6551 account (points to unknown PM)
        vm.mockCall(invalidAccount, abi.encodeWithSignature("token()"), abi.encode(block.chainid, unknownPM, 2));

        dummyKey = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: 0x800000, // DYNAMIC_FEE_FLAG
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    // ─── T1: add/remove known PositionManager by owner works ──────────────

    function test_addRemovePositionManager_owner() public {
        address newPM = makeAddr("newPM");

        assertFalse(hook.knownPositionManagers(newPM));

        vm.prank(owner);
        hook.addPositionManager(newPM);
        assertTrue(hook.knownPositionManagers(newPM));

        vm.prank(owner);
        hook.removePositionManager(newPM);
        assertFalse(hook.knownPositionManagers(newPM));
    }

    // ─── T2: add/remove by non-owner reverts ──────────────────────────────

    function test_addRemovePositionManager_nonOwner_reverts() public {
        address newPM = makeAddr("newPM");

        vm.prank(makeAddr("notOwner"));
        vm.expectRevert(OptionSettlementHook.OnlyOwner.selector);
        hook.addPositionManager(newPM);

        vm.prank(makeAddr("notOwner"));
        vm.expectRevert(OptionSettlementHook.OnlyOwner.selector);
        hook.removePositionManager(knownPM);
    }

    // ─── T3: beforeSwap with non-contract sender (EOA) reverts ────────────

    function test_beforeSwap_eoaSender_reverts() public {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1000, sqrtPriceLimitX96: 0});

        vm.expectRevert(abi.encodeWithSelector(OptionSettlementHook.InvalidOptionAccount.selector, eoa));
        hook.beforeSwap(eoa, dummyKey, params, "");
    }

    // ─── T4: beforeSwap with non-ERC6551 contract sender reverts ──────────

    function test_beforeSwap_nonERC6551Contract_reverts() public {
        // Deploy an empty contract to act as the sender
        address emptyContract = address(new MockPoolManager(0));

        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1000, sqrtPriceLimitX96: 0});

        vm.expectRevert(abi.encodeWithSelector(OptionSettlementHook.InvalidOptionAccount.selector, emptyContract));
        hook.beforeSwap(emptyContract, dummyKey, params, "");
    }

    // ─── T5: beforeSwap with ERC6551 account not bound to known PM reverts

    function test_beforeSwap_unknownPM_reverts() public {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1000, sqrtPriceLimitX96: 0});

        vm.expectRevert(abi.encodeWithSelector(OptionSettlementHook.InvalidOptionAccount.selector, invalidAccount));
        hook.beforeSwap(invalidAccount, dummyKey, params, "");
    }

    // ─── T6: beforeSwap with valid account returns fee override = 0 ───────

    function test_beforeSwap_validAccount_returnsFeeOverrideZero() public {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1000, sqrtPriceLimitX96: 0});

        (bytes4 selector, BeforeSwapDelta delta, uint24 feeOverride) =
            hook.beforeSwap(validAccount, dummyKey, params, "");

        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), 0); // No netting
        assertEq(feeOverride, 0); // Override fee to 0
    }

    // ─── T7: beforeSwap matching opposite flow in pendingNets returns exact net amount

    function test_beforeSwap_netting() public {
        address tokenA = address(1);
        address tokenB = address(2);

        bytes memory hookData1 = abi.encode(tokenA, tokenB, makeAddr("recip1"));
        bytes memory hookData2 = abi.encode(tokenB, tokenA, makeAddr("recip2"));

        SwapParams memory params1 = SwapParams({zeroForOne: true, amountSpecified: -1000, sqrtPriceLimitX96: 0});

        // First swap stores the flow in transient storage
        (bytes4 sel1, BeforeSwapDelta delta1, uint24 fee1) = hook.beforeSwap(validAccount, dummyKey, params1, hookData1);

        assertEq(sel1, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta1), 0);
        assertEq(fee1, 0);

        // Second swap is an opposing flow
        SwapParams memory params2 = SwapParams({zeroForOne: false, amountSpecified: -1000, sqrtPriceLimitX96: 0});

        vm.expectEmit(true, true, true, true);
        emit NetCross(validAccount, makeAddr("recip1"), tokenB, 1000);

        (bytes4 sel2, BeforeSwapDelta delta2, uint24 fee2) = hook.beforeSwap(validAccount, dummyKey, params2, hookData2);

        assertEq(sel2, IHooks.beforeSwap.selector);
        assertEq(fee2, 0);

        // Netting completely crosses the flow, so unspecified Delta should be 0, and specified Delta should be amountIn (1000).
        // Since we provided exact input (-1000), specifiedDelta is positive (the hook took 1000).
        // delta is int256 containing unspecified int128 in upper and specified int128 in lower.
        // The implementation uses: toBeforeSwapDelta(int128(int256(crossAmount)), 0)
        // Which means specified is 1000, unspecified is 0.
        int128 specified = int128(int256(1000));
        assertEq(BeforeSwapDelta.unwrap(delta2), BeforeSwapDelta.unwrap(toBeforeSwapDelta(specified, 0)));
    }

    // ─── T8: afterSwap emits SwapExecuted event ───────────────────────────

    function test_afterSwap_emitsEvent() public {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1000, sqrtPriceLimitX96: 0});

        BalanceDelta bDelta = toBalanceDelta(500, -500);

        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(block.timestamp, 500, -500);

        (bytes4 selector, int128 unspecified) = hook.afterSwap(validAccount, dummyKey, params, bDelta, "");

        assertEq(selector, IHooks.afterSwap.selector);
        assertEq(unspecified, 0);
    }
}
