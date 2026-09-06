// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {V4LPRouterRestaker} from "../../src/periphery/V4LPRouterRestaker.sol";
import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {MockPoolManager} from "../unit/mocks/MockPoolManager.sol";
import {TestERC20} from "../unit/mocks/TestERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract MockSettler {
    event Settled();

    function settle(bytes calldata data) external returns (bytes memory) {
        emit Settled();
        return data;
    }

    function failingSettle() external pure {
        revert("SettlementFailedCustom");
    }
}

/// @title V4LPRouterRestakerFuzzTest
/// @author parseb
/// @notice Property-based fuzz tests for V4LPRouterRestaker helper.
contract V4LPRouterRestakerFuzzTest is Test {
    V4LPRouterRestaker internal restaker;
    V4LiquidityVault internal vault;
    MockSettler internal settler;
    TestERC20 internal token;
    MockPoolManager internal poolManager;

    address internal owner = makeAddr("owner");
    address internal lpRouter = makeAddr("lpRouter");

    function setUp() public {
        restaker = new V4LPRouterRestaker();
        settler = new MockSettler();
        token = new TestERC20("Token", "TKN", 18);
        poolManager = new MockPoolManager(0);

        PoolKey memory dummyKey = PoolKey({
            currency0: Currency.wrap(address(token)),
            currency1: Currency.wrap(address(2)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        vault = new V4LiquidityVault(address(poolManager), dummyKey, -600, 600, owner, lpRouter);
    }

    /// @notice Length Mismatch Fuzz: batchRestake with differing array lengths MUST revert.
    function testFuzz_batchRestake_lengthMismatch_reverts(uint8 len1, uint8 len2) public {
        vm.assume(len1 != len2);
        address[] memory vaults = new address[](len1);
        address[] memory assets = new address[](len2);

        for (uint256 i = 0; i < len1; i++) {
            vaults[i] = address(vault);
        }
        for (uint256 i = 0; i < len2; i++) {
            assets[i] = address(token);
        }

        vm.expectRevert(V4LPRouterRestaker.LengthMismatch.selector);
        restaker.batchRestake(vaults, assets);
    }

    /// @notice Zero Address Fuzz: Passing address(0) for any parameter MUST revert.
    function testFuzz_zeroAddress_reverts(uint8 targetSlot) public {
        targetSlot = uint8(bound(targetSlot, 0, 2));

        address target = targetSlot == 0 ? address(0) : address(settler);
        address v = targetSlot == 1 ? address(0) : address(vault);
        address a = targetSlot == 2 ? address(0) : address(token);

        vm.expectRevert(V4LPRouterRestaker.ZeroAddress.selector);
        restaker.settleAndRestake(target, abi.encodeWithSignature("settle(bytes)", ""), v, a);
    }

    /// @notice Execution Fuzz: SettleAndRestake returns settlement return data verbatim.
    function testFuzz_settleAndRestake_returnsData(bytes calldata customData) public {
        bytes memory callData = abi.encodeWithSignature("settle(bytes)", customData);

        // Mock LPRouter claimable
        vm.mockCall(lpRouter, abi.encodeWithSignature("withdraw(address)", address(token)), "");

        bytes memory ret = restaker.settleAndRestake(address(settler), callData, address(vault), address(token));
        bytes memory decoded = abi.decode(ret, (bytes));
        assertEq(decoded, customData);
    }
}
