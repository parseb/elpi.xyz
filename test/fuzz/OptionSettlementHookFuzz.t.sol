// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OptionSettlementHook} from "../../src/hooks/OptionSettlementHook.sol";
import {MockPoolManager} from "../unit/mocks/MockPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @title OptionSettlementHookFuzzTest
/// @author parseb
/// @notice Property-based fuzz tests for OptionSettlementHook verifying 0-fee waiver, sender verification, and netting math.
contract OptionSettlementHookFuzzTest is Test {
    OptionSettlementHook internal hook;
    MockPoolManager internal poolManager;

    address internal owner = makeAddr("owner");
    address internal knownPM = makeAddr("knownPM");
    address internal validAccount = makeAddr("validAccount");

    PoolKey internal dummyKey;

    function setUp() public {
        poolManager = new MockPoolManager(0);

        vm.prank(owner);
        hook = new OptionSettlementHook(IPoolManager(address(poolManager)), owner, address(0));

        vm.prank(owner);
        hook.addPositionManager(knownPM);

        // Setup mock for valid ERC-6551 token bound account
        vm.mockCall(validAccount, abi.encodeWithSignature("token()"), abi.encode(block.chainid, knownPM, 1));

        dummyKey = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: 0x800000, // DYNAMIC_FEE_FLAG
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    /// @notice Sender Verification Fuzz: Any EOA or non-registered account MUST revert.
    function testFuzz_beforeSwap_randomEOA_reverts(address caller, int256 amountSpecified) public {
        vm.assume(caller.code.length == 0);
        vm.assume(caller != address(0));

        SwapParams memory params =
            SwapParams({zeroForOne: true, amountSpecified: amountSpecified, sqrtPriceLimitX96: 0});

        vm.expectRevert(abi.encodeWithSelector(OptionSettlementHook.InvalidOptionAccount.selector, caller));
        hook.beforeSwap(caller, dummyKey, params, "");
    }

    /// @notice Invariant I4 Fuzz: Fee override MUST strictly be 0 for all valid calls.
    function testFuzz_beforeSwap_feeOverride_alwaysZero(int256 amountSpecified, bool zeroForOne) public {
        SwapParams memory params =
            SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: 0});

        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) = hook.beforeSwap(validAccount, dummyKey, params, "");

        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(fee, 0, "Invariant I4 violated: fee override is not 0");
    }

    /// @notice Netting Fuzz: Opposing flows cross at min(flowA, flowB).
    function testFuzz_beforeSwap_nettingMath(uint128 rawAmountA, uint128 rawAmountB) public {
        uint256 amountA = bound(uint256(rawAmountA), 1, type(uint128).max);
        uint256 amountB = bound(uint256(rawAmountB), 1, type(uint128).max);

        address tokenX = makeAddr("tokenX");
        address tokenY = makeAddr("tokenY");

        address accA = makeAddr("accA");
        address accB = makeAddr("accB");

        vm.mockCall(accA, abi.encodeWithSignature("token()"), abi.encode(block.chainid, knownPM, 10));
        vm.mockCall(accB, abi.encodeWithSignature("token()"), abi.encode(block.chainid, knownPM, 11));

        // Flow 1: accA sells tokenX for tokenY
        bytes memory hookDataA = abi.encode(tokenX, tokenY, accA);
        SwapParams memory paramsA =
            SwapParams({zeroForOne: true, amountSpecified: -int256(amountA), sqrtPriceLimitX96: 0});

        (, BeforeSwapDelta deltaA,) = hook.beforeSwap(accA, dummyKey, paramsA, hookDataA);
        // Flow 1 is stored, not netted yet
        assertEq(BeforeSwapDelta.unwrap(deltaA), 0);

        // Flow 2: accB sells tokenY for tokenX (opposing)
        bytes memory hookDataB = abi.encode(tokenY, tokenX, accB);
        SwapParams memory paramsB =
            SwapParams({zeroForOne: false, amountSpecified: -int256(amountB), sqrtPriceLimitX96: 0});

        (, BeforeSwapDelta deltaB,) = hook.beforeSwap(accB, dummyKey, paramsB, hookDataB);

        uint256 expectedCross = amountB < amountA ? amountB : amountA;
        int128 specifiedDelta = int128(int256(expectedCross));
        assertEq(BeforeSwapDelta.unwrap(deltaB), BeforeSwapDelta.unwrap(toBeforeSwapDelta(specifiedDelta, 0)));
    }

    /// @notice Security Fuzz: Zero address input to addPositionManager reverts.
    function testFuzz_addPositionManager_zeroAddress_reverts() public {
        vm.prank(owner);
        vm.expectRevert(OptionSettlementHook.ZeroAddress.selector);
        hook.addPositionManager(address(0));
    }
}
