// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {DeployV4Stack} from "../../script/DeployV4Stack.s.sol";
import {UniswapV4VenueAdapter} from "../../src/adapters/UniswapV4VenueAdapter.sol";
import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {TestERC20} from "./mocks/TestERC20.sol";

contract DeployV4StackTest is Test {
    DeployV4Stack public deployScript;

    address public owner = makeAddr("owner");
    address public positionManager = makeAddr("positionManager");
    address public lpRouter = makeAddr("lpRouter");

    TestERC20 public tokenA;
    TestERC20 public tokenB;

    function setUp() public {
        deployScript = new DeployV4Stack();
        tokenA = new TestERC20("Token A", "TKNA", 18);
        tokenB = new TestERC20("Token B", "TKNB", 18);
    }

    function test_deployStack_endToEnd() public {
        DeployV4Stack.DeployedV4Stack memory deployed = deployScript.deployStack(
            owner,
            positionManager,
            lpRouter,
            address(0), // Deploy new PoolManager
            address(tokenA),
            address(tokenB)
        );

        // 1. PoolManager deployed
        assertTrue(address(deployed.poolManager) != address(0), "PoolManager deployed");
        assertTrue(address(deployed.poolManager).code.length > 0, "PoolManager has code");

        // 2. UniswapV4VenueAdapter deployed and configured
        assertTrue(address(deployed.adapter) != address(0), "Adapter deployed");
        assertEq(address(deployed.adapter.poolManager()), address(deployed.poolManager), "Adapter poolManager match");

        // 3. Route registered in adapter with canonical PoolKey (hooks = address(0), standard fee = 3000)
        assertEq(deployed.routeId, keccak256(abi.encode(deployed.poolKey)), "routeId matches poolKey hash");
        (Currency c0, Currency c1, uint24 fee, int24 tickSpacing, IHooks hooks) =
            deployed.adapter.poolKeyOf(deployed.routeId);
        assertEq(Currency.unwrap(c0), Currency.unwrap(deployed.poolKey.currency0));
        assertEq(Currency.unwrap(c1), Currency.unwrap(deployed.poolKey.currency1));
        assertEq(fee, 3000, "Canonical fee 3000 enforced");
        assertEq(address(hooks), address(0), "No custom hook (hooks == 0)");
        assertEq(tickSpacing, 60, "Tick spacing matches");

        // 4. V4LiquidityVault deployed
        assertTrue(address(deployed.vault) != address(0), "Vault deployed");
        assertEq(address(deployed.vault.poolManager()), address(deployed.poolManager), "Vault poolManager match");
        assertEq(deployed.vault.owner(), owner, "Vault owner match");
        assertEq(deployed.vault.lpRouter(), lpRouter, "Vault lpRouter match");
    }

    function test_deployStack_withExistingPoolManager() public {
        PoolManager existingPm = new PoolManager(address(0));

        DeployV4Stack.DeployedV4Stack memory deployed = deployScript.deployStack(
            owner, positionManager, lpRouter, address(existingPm), address(tokenA), address(tokenB)
        );

        assertEq(address(deployed.poolManager), address(existingPm), "Reused existing PoolManager");
        assertEq(address(deployed.poolKey.hooks), address(0), "Canonical pool has no hook");
    }
}
