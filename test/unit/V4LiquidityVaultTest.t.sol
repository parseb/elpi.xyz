// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IERC1271} from "../../src/interfaces/IERC1271.sol";

contract V4LiquidityVaultTest is Test {
    V4LiquidityVault internal vault;
    MockPoolManager internal poolManager;
    TestERC20 internal token;

    address internal owner = makeAddr("owner");
    address internal lpRouter = makeAddr("lpRouter");
    uint256 internal ownerPrivateKey;

    PoolKey internal dummyKey;
    int24 internal constant TICK_LOWER = -600;
    int24 internal constant TICK_UPPER = 600;

    event Deposited(address indexed asset, uint256 amount);
    event Withdrawn(address indexed asset, uint256 amount);
    event ExtractedForMint(address indexed asset, uint256 amount);
    event RestakeAttempted(address indexed asset, uint256 amount, bool success);
    event ManualRestaked(address indexed asset, uint256 amount);

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

        token.mint(owner, 10_000e18);
        token.mint(address(poolManager), 10_000e18); // Pool manager needs tokens for withdraws
    }

    // ─── T1: deposit transfers asset from owner and calls poolManager ─────────

    function test_deposit_success() public {
        uint256 amount = 100e18;

        vm.startPrank(owner);
        token.approve(address(vault), amount);

        vm.expectEmit(true, true, true, true);
        emit Deposited(address(token), amount);

        vault.deposit(address(token), amount);
        vm.stopPrank();

        // Token should have been pulled from owner and sent to poolManager
        assertEq(token.balanceOf(owner), 10_000e18 - amount);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    // ─── T2: withdraw calls poolManager and transfers asset to owner ──────────

    function test_withdraw_success() public {
        uint256 amount = 50e18;

        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit Withdrawn(address(token), amount);

        vault.withdraw(address(token), amount);

        // Token should have been taken from poolManager and sent to owner
        assertEq(token.balanceOf(owner), 10_000e18 + amount);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    // ─── T3: deposit/withdraw from non-owner reverts ──────────────────────────

    function test_depositWithdraw_nonOwner_reverts() public {
        address notOwner = makeAddr("notOwner");
        uint256 amount = 100e18;

        token.mint(notOwner, amount);

        vm.startPrank(notOwner);
        token.approve(address(vault), amount);

        vm.expectRevert(V4LiquidityVault.OnlyOwner.selector);
        vault.deposit(address(token), amount);

        vm.expectRevert(V4LiquidityVault.OnlyOwner.selector);
        vault.withdraw(address(token), amount);
        vm.stopPrank();
    }

    // ─── T4: extractForMint by lpRouter withdraws and grants allowance ────────

    function test_extractForMint_success() public {
        uint256 amount = 75e18;

        vm.prank(lpRouter);
        vm.expectEmit(true, true, true, true);
        emit ExtractedForMint(address(token), amount);

        vault.extractForMint(address(token), amount);

        // Vault now holds the raw ERC20, not owner
        assertEq(token.balanceOf(address(vault)), amount);

        // LPRouter should have allowance to pull it
        assertEq(token.allowance(address(vault), lpRouter), amount);
    }

    // ─── T5: extractForMint from non-lpRouter reverts ─────────────────────────

    function test_extractForMint_nonLpRouter_reverts() public {
        vm.prank(owner); // even owner can't do this
        vm.expectRevert(V4LiquidityVault.OnlyLPRouter.selector);
        vault.extractForMint(address(token), 10e18);
    }

    // ─── T6: onPositionSettled successfully restakes ──────────────────────────

    function test_onPositionSettled_restakes() public {
        uint256 amount = 25e18;

        // Simulating PositionAccount settling and transferring funds to vault
        token.mint(address(vault), amount);

        vm.expectEmit(true, true, true, true);
        emit RestakeAttempted(address(token), amount, true);

        vault.onPositionSettled(1, address(token), amount);

        // Funds should have been sent to poolManager
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.pendingAsset(address(token)), 0);
    }

    // ─── T7: onPositionSettled failing to restake leaves balance ──────────────

    function test_onPositionSettled_restakeFails_doesNotRevert() public {
        uint256 amount = 25e18;

        // Simulating PositionAccount settling and transferring funds to vault
        token.mint(address(vault), amount);

        // Force the mock poolManager to revert
        poolManager.setShouldRevert(true);

        vm.expectEmit(true, true, true, true);
        emit RestakeAttempted(address(token), amount, false);

        // This should NOT revert
        vault.onPositionSettled(1, address(token), amount);

        // Funds should remain in vault as pendingAsset
        assertEq(token.balanceOf(address(vault)), amount);
        assertEq(vault.pendingAsset(address(token)), amount);
    }

    // ─── T8: manualRestake recovers pendingAsset ──────────────────────────────

    function test_manualRestake_success() public {
        uint256 amount = 25e18;

        token.mint(address(vault), amount);
        poolManager.setShouldRevert(true);
        vault.onPositionSettled(1, address(token), amount);
        assertEq(vault.pendingAsset(address(token)), amount);

        // PoolManager recovers
        poolManager.setShouldRevert(false);

        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit ManualRestaked(address(token), amount);

        vault.manualRestake(address(token));

        assertEq(vault.pendingAsset(address(token)), 0);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_manualRestake_nonOwner_reverts() public {
        vm.prank(makeAddr("notOwner"));
        vm.expectRevert(V4LiquidityVault.OnlyOwner.selector);
        vault.manualRestake(address(token));
    }

    // ─── T9: isValidSignature (ERC1271) returns correct magic values ──────────

    function test_isValidSignature() public {
        bytes32 hash = keccak256("test message");

        // Sign with owner's key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, hash);
        bytes memory signature = abi.encodePacked(r, s, v);

        bytes4 magic = vault.isValidSignature(hash, signature);
        assertEq(bytes32(magic), bytes32(IERC1271.isValidSignature.selector));

        // Sign with wrong key
        (, uint256 wrongKey) = makeAddrAndKey("wrong");
        (v, r, s) = vm.sign(wrongKey, hash);
        bytes memory wrongSignature = abi.encodePacked(r, s, v);

        bytes4 wrongMagic = vault.isValidSignature(hash, wrongSignature);
        assertEq(bytes32(wrongMagic), bytes32(bytes4(0xffffffff)));
    }
}
