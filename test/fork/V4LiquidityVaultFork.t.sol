// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {TestERC20} from "../unit/mocks/TestERC20.sol";

/// @title V4LiquidityVaultFork
/// @notice Fork verification for Milestone UV3 (§8.2).
///         Tests V4LiquidityVault lifecycle: deposit, extraction, settlement callback, and withdrawal.
contract V4LiquidityVaultFork is Test {
    IPoolManager public poolManager;
    V4LiquidityVault public vault;
    PoolKey public poolKey;

    address public owner = makeAddr("owner");
    address public lpRouter = makeAddr("lpRouter");

    TestERC20 public token0;
    TestERC20 public token1;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpcUrl).length > 0) {
            vm.createSelectFork(rpcUrl);
            address canonicalPm = vm.envOr("POOL_MANAGER", address(0));
            if (canonicalPm != address(0) && canonicalPm.code.length > 0) {
                poolManager = IPoolManager(canonicalPm);
            } else {
                poolManager = IPoolManager(address(new PoolManager(address(0))));
            }
        } else {
            poolManager = IPoolManager(address(new PoolManager(address(0))));
        }

        token0 = new TestERC20("Token 0", "T0", 18);
        token1 = new TestERC20("Token 1", "T1", 18);
        if (address(token0) > address(token1)) {
            TestERC20 temp = token0;
            token0 = token1;
            token1 = temp;
        }

        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        try poolManager.initialize(poolKey, 79228162514264337593543950336) {} catch {}

        vault = new V4LiquidityVault(
            address(poolManager),
            poolKey,
            600, // tickLower
            1200, // tickUpper
            owner,
            lpRouter
        );
    }

    /// @notice Verifies full LP capital lifecycle: deposit -> extractForMint -> onPositionSettled -> withdraw
    function test_fork_vault_lifecycle() public {
        uint256 depositAmount = 10e18;
        token0.mint(owner, depositAmount);

        // 1. LP deposits WETH into vault
        vm.startPrank(owner);
        token0.approve(address(vault), depositAmount);
        vault.deposit(address(token0), depositAmount);
        vm.stopPrank();

        // 2. LPRouter calls extractForMint before matchAndMint
        uint256 extractAmount = 4e18;
        vm.prank(lpRouter);
        vault.extractForMint(address(token0), extractAmount);

        // 3. Post-settlement hook callback
        uint256 returnedAmount = 3e18;
        token0.mint(address(this), returnedAmount);
        token0.approve(address(vault), returnedAmount);

        // onPositionSettled should never revert even if pool conditions vary (Invariant I3)
        vault.onPositionSettled(1247, address(token0), returnedAmount);

        // 4. LP withdraws remaining capital
        vm.startPrank(owner);
        vault.withdraw(address(token0), 1e18);
        vm.stopPrank();

        assertTrue(token0.balanceOf(owner) > 0, "Owner successfully withdrew funds");
    }
}
