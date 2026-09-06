// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {MockPoolManager} from "../unit/mocks/MockPoolManager.sol";
import {TestERC20} from "../unit/mocks/TestERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @title V4LiquidityVaultFuzzTest
/// @author parseb
/// @notice Property-based fuzz tests for V4LiquidityVault verifying token conservation, ERC-1271 signing, and re-stake accounting.
contract V4LiquidityVaultFuzzTest is Test {
    V4LiquidityVault internal vault;
    MockPoolManager internal poolManager;
    TestERC20 internal token;

    address internal owner;
    uint256 internal ownerPrivateKey;
    address internal lpRouter = makeAddr("lpRouter");

    PoolKey internal dummyKey;
    int24 internal constant TICK_LOWER = -600;
    int24 internal constant TICK_UPPER = 600;

    function setUp() public {
        (owner, ownerPrivateKey) = makeAddrAndKey("owner");

        token = new TestERC20("Token", "TKN", 18);
        poolManager = new MockPoolManager(0);

        dummyKey = PoolKey({
            currency0: Currency.wrap(address(token)),
            currency1: Currency.wrap(address(2)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        vault = new V4LiquidityVault(address(poolManager), dummyKey, TICK_LOWER, TICK_UPPER, owner, lpRouter);

        token.mint(address(poolManager), 1_000_000_000e18);
    }

    /// @notice Token Conservation Fuzz: Deposit and withdraw balances must balance out exactly.
    function testFuzz_depositWithdraw_conservation(uint256 depositAmount, uint256 withdrawRatio) public {
        depositAmount = bound(depositAmount, 1, 10_000_000e18);
        withdrawRatio = bound(withdrawRatio, 1, 100);

        uint256 withdrawAmount = (depositAmount * withdrawRatio) / 100;
        if (withdrawAmount == 0) withdrawAmount = 1;

        token.mint(owner, depositAmount);

        vm.startPrank(owner);
        token.approve(address(vault), depositAmount);
        vault.deposit(address(token), depositAmount);

        assertEq(token.balanceOf(owner), 0);

        // Withdraw portion
        vault.withdraw(address(token), withdrawAmount);
        vm.stopPrank();

        assertEq(token.balanceOf(owner), withdrawAmount);
    }

    /// @notice Zero Amount Fuzz: Passing 0 to deposit, withdraw, or extractForMint MUST revert.
    function testFuzz_zeroAmount_reverts(uint8 action) public {
        action = uint8(bound(action, 0, 2));

        if (action == 0) {
            vm.prank(owner);
            vm.expectRevert(V4LiquidityVault.ZeroAmount.selector);
            vault.deposit(address(token), 0);
        } else if (action == 1) {
            vm.prank(owner);
            vm.expectRevert(V4LiquidityVault.ZeroAmount.selector);
            vault.withdraw(address(token), 0);
        } else {
            vm.prank(lpRouter);
            vm.expectRevert(V4LiquidityVault.ZeroAmount.selector);
            vault.extractForMint(address(token), 0);
        }
    }

    /// @notice Invariant I3 Fuzz: Failed onPositionSettled restake accumulates in pendingAsset.
    function testFuzz_onPositionSettled_pendingAsset_accounting(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000e18);

        // Configure poolManager to revert during unlock to simulate restake failure
        poolManager.setShouldRevert(true);

        vault.onPositionSettled(1, address(token), amount);

        assertEq(vault.pendingAsset(address(token)), amount, "pendingAsset must accurately record failed amount");

        // Owner can clear pendingAsset via manualRestake once poolManager recovers
        poolManager.setShouldRevert(false);
        token.mint(address(vault), amount);

        vm.prank(owner);
        vault.manualRestake(address(token));

        assertEq(vault.pendingAsset(address(token)), 0, "manualRestake must clear pendingAsset");
    }

    /// @notice ERC-1271 Fuzz: Signatures signed by owner private key return magic value; others return failure.
    function testFuzz_isValidSignature_ownerOnly(bytes32 digest, uint256 otherKey) public view {
        otherKey = bound(otherKey, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(otherKey != ownerPrivateKey);

        // Valid owner signature
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, digest);
        bytes memory validSig = abi.encodePacked(r, s, v);
        assertEq(vault.isValidSignature(digest, validSig), bytes4(0x1626ba7e));

        // Invalid third party signature
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(otherKey, digest);
        bytes memory invalidSig = abi.encodePacked(r2, s2, v2);
        assertEq(vault.isValidSignature(digest, invalidSig), bytes4(0xffffffff));
    }
}
