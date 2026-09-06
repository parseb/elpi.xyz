// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {UniswapV4VenueAdapter} from "../src/adapters/UniswapV4VenueAdapter.sol";
import {OptionSettlementHook} from "../src/hooks/OptionSettlementHook.sol";
import {V4LiquidityVault} from "../src/periphery/V4LiquidityVault.sol";

/// @title DeployV4Stack
/// @notice End-to-end deployment script for elpi (elpi.xyz) × Uniswap v4 on Base mainnet / local testnets.
contract DeployV4Stack is Script {
    // ─── Base Mainnet Canonical Addresses ────────────────────────────────────
    address public constant CANONICAL_BASE_WETH = 0x4200000000000000000000000000000000000006;
    address public constant CANONICAL_BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant CANONICAL_BASE_FEED_ETH_USD = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;

    // ─── Uniswap v4 Hook Flag Constants ──────────────────────────────────────
    uint160 public constant REQUIRED_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG; // 0xC8 = 200

    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    int24 public constant DEFAULT_TICK_SPACING = 60;

    // SqrtPriceX96 for 1:1 price ratio = 2^96
    uint160 public constant INITIAL_SQRT_PRICE_1_1 = 79228162514264337593543950336;

    struct DeployedV4Stack {
        IPoolManager poolManager;
        UniswapV4VenueAdapter adapter;
        OptionSettlementHook hook;
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

    /// @notice Mines a CREATE2 salt producing an address with required hook flags (0xC8).
    function mineHookSalt(address deployer, bytes memory creationCode)
        public
        pure
        returns (bytes32 salt, address predicted)
    {
        bytes32 codeHash = keccak256(creationCode);
        for (uint256 i = 0; i < 500_000; i++) {
            bytes32 s = bytes32(i);
            address target = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, s, codeHash)))));
            if (uint160(target) & Hooks.ALL_HOOK_MASK == REQUIRED_FLAGS) {
                return (s, target);
            }
        }
        revert("DeployV4Stack: Failed to mine hook salt within range");
    }

    /// @notice Main entrypoint executing all 6 deployment steps.
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
        console.log("=== elpi (elpi.xyz) x Uniswap v4 Stack Deployment ===");
        console.log("Deployer / Script address:", address(this));
        console.log("Hook Owner:", p.owner);

        // 1. Connect to or deploy canonical Base v4 PoolManager
        IPoolManager poolManager = _getOrDeployPoolManager(p.poolManagerAddress);
        console.log("PoolManager ready at:", address(poolManager));

        // 2. Deploy UniswapV4VenueAdapter
        UniswapV4VenueAdapter adapter = new UniswapV4VenueAdapter(address(poolManager));
        console.log("UniswapV4VenueAdapter deployed at:", address(adapter));

        // 3. Mine CREATE2 salt for OptionSettlementHook and deploy
        OptionSettlementHook hook = _mineAndDeployHook(poolManager, p.owner, address(adapter));
        console.log("OptionSettlementHook deployed at:", address(hook));

        // 4. Whitelist canonical PositionManager in the hook
        if (p.positionManager != address(0)) {
            _whitelistPositionManager(hook, p.owner, p.positionManager);
            console.log("PositionManager whitelisted successfully.");
        } else {
            console.log("Notice: POSITION_MANAGER not provided. Skipping whitelisting step.");
        }

        // 5. Build canonical PoolKey and register route in adapter
        (PoolKey memory key, bytes32 routeId) = _setupRoute(poolManager, adapter, hook, p.tokenA, p.tokenB);
        console.log("Route registered in UniswapV4VenueAdapter. routeId:", vm.toString(routeId));

        // 6. Deploy sample V4LiquidityVault for LP collateral staging
        V4LiquidityVault vault = new V4LiquidityVault(
            address(poolManager),
            key,
            600, // tickLower
            1200, // tickUpper
            p.owner,
            p.lpRouter
        );
        console.log("V4LiquidityVault deployed at:", address(vault));

        deployed = DeployedV4Stack({
            poolManager: poolManager,
            adapter: adapter,
            hook: hook,
            vault: vault,
            routeId: routeId,
            poolKey: key
        });

        console.log("=== elpi (elpi.xyz) Deployment Complete ===");
    }

    function _getOrDeployPoolManager(address pmAddr) internal returns (IPoolManager) {
        if (pmAddr != address(0) && pmAddr.code.length > 0) {
            return IPoolManager(pmAddr);
        }
        PoolManager newPm = new PoolManager(address(0));
        return IPoolManager(address(newPm));
    }

    function _mineAndDeployHook(IPoolManager poolManager, address owner, address adapter)
        internal
        returns (OptionSettlementHook)
    {
        bytes memory hookCreationCode =
            abi.encodePacked(type(OptionSettlementHook).creationCode, abi.encode(poolManager, owner, adapter));

        (bytes32 salt, address predictedHook) = mineHookSalt(address(this), hookCreationCode);
        OptionSettlementHook hook = new OptionSettlementHook{salt: salt}(poolManager, owner, adapter);

        require(address(hook) == predictedHook, "Hook address mismatch with predicted");
        require(uint160(address(hook)) & Hooks.ALL_HOOK_MASK == REQUIRED_FLAGS, "Hook flag mask check failed");
        return hook;
    }

    function _whitelistPositionManager(OptionSettlementHook hook, address owner, address positionManager) internal {
        if (msg.sender == owner || address(this) == owner) {
            hook.addPositionManager(positionManager);
        } else {
            vm.prank(owner);
            hook.addPositionManager(positionManager);
        }
    }

    function _setupRoute(
        IPoolManager poolManager,
        UniswapV4VenueAdapter adapter,
        OptionSettlementHook hook,
        address tokenA,
        address tokenB
    ) internal returns (PoolKey memory key, bytes32 routeId) {
        (address c0, address c1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: DYNAMIC_FEE_FLAG,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: hook
        });

        // Initialize pool if uninitialized
        try poolManager.initialize(key, INITIAL_SQRT_PRICE_1_1) {} catch {}

        adapter.registerRoute(key, "");
        routeId = keccak256(abi.encode(key));
    }
}
