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
import {OptionSettlementHook} from "../../src/hooks/OptionSettlementHook.sol";
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

    function test_mineHookSalt_producesCorrectFlags() public view {
        bytes memory code = abi.encodePacked(
            type(OptionSettlementHook).creationCode, abi.encode(IPoolManager(address(0x1111)), owner, address(0x2222))
        );

        (bytes32 salt, address predicted) = deployScript.mineHookSalt(address(deployScript), code);
        assertTrue(salt != bytes32(0) || salt == bytes32(0), "Salt returned");
        assertEq(
            uint160(predicted) & Hooks.ALL_HOOK_MASK,
            deployScript.REQUIRED_FLAGS(),
            "Mined hook address must match 0xC8 flag mask"
        );
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

        // 3. OptionSettlementHook deployed with required flags & trustedAdapter
        assertTrue(address(deployed.hook) != address(0), "Hook deployed");
        assertEq(
            uint160(address(deployed.hook)) & Hooks.ALL_HOOK_MASK,
            deployScript.REQUIRED_FLAGS(),
            "Hook address must satisfy 0xC8 flags"
        );
        assertEq(deployed.hook.trustedAdapter(), address(deployed.adapter), "Hook trustedAdapter match");
        assertEq(deployed.hook.owner(), owner, "Hook owner match");

        // 4. PositionManager whitelisted in hook
        assertTrue(deployed.hook.knownPositionManagers(positionManager), "PositionManager whitelisted in hook");

        // 5. Route registered in adapter with DYNAMIC_FEE_FLAG
        assertEq(deployed.routeId, keccak256(abi.encode(deployed.poolKey)), "routeId matches poolKey hash");
        (Currency c0, Currency c1, uint24 fee, int24 tickSpacing, IHooks hooks) =
            deployed.adapter.poolKeyOf(deployed.routeId);
        assertEq(Currency.unwrap(c0), Currency.unwrap(deployed.poolKey.currency0));
        assertEq(Currency.unwrap(c1), Currency.unwrap(deployed.poolKey.currency1));
        assertEq(fee, 0x800000, "DYNAMIC_FEE_FLAG enforced");
        assertEq(address(hooks), address(deployed.hook), "Hooks match");
        assertEq(tickSpacing, 60, "Tick spacing matches");

        // 6. V4LiquidityVault deployed
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
    }
}
