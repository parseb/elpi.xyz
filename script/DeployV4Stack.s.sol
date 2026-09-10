// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {UniswapV4VenueAdapter} from "../src/adapters/UniswapV4VenueAdapter.sol";
import {V4LiquidityVault} from "../src/periphery/V4LiquidityVault.sol";

/// @title DeployV4Stack
/// @author parseb
/// @notice End-to-end deployment script for elpi (elpi.xyz) × Uniswap v4 (Compromise Architecture).
///         Deploys canonical Uniswap v4 pools without custom hooks, hook mining, or dynamic fee flags.
contract DeployV4Stack is Script {
    // ─── Base Mainnet Canonical Addresses ────────────────────────────────────
    address public constant CANONICAL_BASE_WETH = 0x4200000000000000000000000000000000000006;
    address public constant CANONICAL_BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant CANONICAL_BASE_FEED_ETH_USD = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;

    uint24 public constant DEFAULT_FEE = 3000; // 30 bps canonical pool
    int24 public constant DEFAULT_TICK_SPACING = 60;

    // SqrtPriceX96 for 1:1 price ratio = 2^96
    uint160 public constant INITIAL_SQRT_PRICE_1_1 = 79228162514264337593543950336;

    struct DeployedV4Stack {
        IPoolManager poolManager;
        UniswapV4VenueAdapter adapter;
        V4LiquidityVault vault;
        bytes32 routeId;
        PoolKey poolKey;
    }

    struct DeployParams {
        address owner;
        address positionManager;
        address lpRouter;
        address poolManagerAddress;
        address tokenA;
        address tokenB;
    }

    /// @notice Main entrypoint executing all deployment steps.
    function run() external returns (DeployedV4Stack memory deployed) {
        DeployParams memory p = DeployParams({
            owner: vm.envOr("OWNER", msg.sender),
            positionManager: vm.envOr("POSITION_MANAGER", address(0)),
            lpRouter: vm.envOr("LP_ROUTER", msg.sender),
            poolManagerAddress: vm.envOr("POOL_MANAGER", address(0)),
            tokenA: vm.envOr("WETH", CANONICAL_BASE_WETH),
            tokenB: vm.envOr("USDC", CANONICAL_BASE_USDC)
        });

        vm.startBroadcast();
        deployed = deployStackWithParams(p);
        vm.stopBroadcast();
    }

    function deployStack(
        address owner,
        address positionManager,
        address lpRouter,
        address poolManagerAddress,
        address tokenA,
        address tokenB
    ) external returns (DeployedV4Stack memory) {
        DeployParams memory p = DeployParams({
            owner: owner,
            positionManager: positionManager,
            lpRouter: lpRouter,
            poolManagerAddress: poolManagerAddress,
            tokenA: tokenA,
            tokenB: tokenB
        });
        return deployStackWithParams(p);
    }

    function deployStackWithParams(DeployParams memory p) public returns (DeployedV4Stack memory deployed) {
        console.log("=== elpi (elpi.xyz) x Uniswap v4 Stack Deployment (Compromise Architecture) ===");
        console.log("Deployer / Script address:", address(this));
        console.log("Owner:", p.owner);

        // 1. Connect to or deploy canonical Base v4 PoolManager
        IPoolManager poolManager = _getOrDeployPoolManager(p.poolManagerAddress);
        console.log("PoolManager ready at:", address(poolManager));

        // 2. Deploy UniswapV4VenueAdapter
        UniswapV4VenueAdapter adapter = new UniswapV4VenueAdapter(address(poolManager));
        console.log("UniswapV4VenueAdapter deployed at:", address(adapter));

        // 3. Build canonical PoolKey (hooks = address(0)) and register route in adapter
        (PoolKey memory key, bytes32 routeId) = _setupRoute(poolManager, adapter, p.tokenA, p.tokenB);
        console.log("Route registered in UniswapV4VenueAdapter. routeId:", vm.toString(routeId));

        // 4. Deploy sample V4LiquidityVault for LP collateral staging
        V4LiquidityVault vault = new V4LiquidityVault(
            address(poolManager),
            key,
            600, // tickLower
            1200, // tickUpper
            p.owner,
            p.lpRouter
        );
        console.log("V4LiquidityVault deployed at:", address(vault));

        deployed =
            DeployedV4Stack({poolManager: poolManager, adapter: adapter, vault: vault, routeId: routeId, poolKey: key});

        console.log("=== elpi (elpi.xyz) Canonical Stack Deployment Complete ===");
    }

    function _getOrDeployPoolManager(address pmAddr) internal returns (IPoolManager) {
        if (pmAddr != address(0) && pmAddr.code.length > 0) {
            return IPoolManager(pmAddr);
        }
        PoolManager newPm = new PoolManager(address(0));
        return IPoolManager(address(newPm));
    }

    function _setupRoute(IPoolManager poolManager, UniswapV4VenueAdapter adapter, address tokenA, address tokenB)
        internal
        returns (PoolKey memory key, bytes32 routeId)
    {
        (address c0, address c1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: DEFAULT_FEE,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // Initialize pool if uninitialized
        try poolManager.initialize(key, INITIAL_SQRT_PRICE_1_1) {} catch {}

        adapter.registerRoute(key, "");
        routeId = keccak256(abi.encode(key));
    }
}
