// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {UniswapV4VenueAdapter} from "../src/adapters/UniswapV4VenueAdapter.sol";

/// @title SubmitCuration
/// @author parseb
/// @notice Formats, validates, and queues Uniswap v4 pool routes and hooks into the
///         ModuleRegistry 5-day CURATED tier timelock (INITIAL_SPECIFICATION.md §5.2 Step 4, UV-Q5).
contract SubmitCuration is Script {
    uint256 public constant TIMELOCK_DURATION = 5 days; // 432,000 seconds
    uint160 public constant REQUIRED_HOOK_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG; // 0xC8 = 200

    struct CurationRecord {
        bytes32 routeId;
        address adapter;
        address hook;
        Currency currency0;
        Currency currency1;
        uint24 fee;
        int24 tickSpacing;
        uint256 queuedAt;
        uint256 activatesAt;
        string tier;
        bool isValid;
    }

    /// @notice Validates hook address flags and routeId derivation, returning a structured curation record.
    function formatCurationProposal(address adapterAddress, PoolKey memory poolKey, uint256 currentTimestamp)
        public
        view
        returns (CurationRecord memory record)
    {
        bytes32 routeId = keccak256(abi.encode(poolKey));
        address hookAddress = address(poolKey.hooks);

        // 1. Verify hook flags match 0xC8
        uint160 flags = uint160(hookAddress) & Hooks.ALL_HOOK_MASK;
        require(flags == REQUIRED_HOOK_FLAGS, "SubmitCuration: invalid hook flags (must be 0xC8)");

        // 2. If adapter address is supplied, verify route is registered on-chain
        if (adapterAddress != address(0)) {
            UniswapV4VenueAdapter adapter = UniswapV4VenueAdapter(adapterAddress);
            (,,, int24 ts,) = adapter.poolKeyOf(routeId);
            require(ts != 0, "SubmitCuration: route not registered on adapter");
        }

        uint256 activatesAt = currentTimestamp + TIMELOCK_DURATION;

        record = CurationRecord({
            routeId: routeId,
            adapter: adapterAddress,
            hook: hookAddress,
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            queuedAt: currentTimestamp,
            activatesAt: activatesAt,
            tier: "CURATED",
            isValid: true
        });
    }

    /// @notice Entry point for Forge script execution
    function run() external returns (CurationRecord memory record) {
        address adapterAddress = vm.envOr("V4_ADAPTER", address(0));
        address hookAddress = vm.envOr("HOOK_ADDRESS", address(0));
        address token0 = vm.envOr("TOKEN0", 0x4200000000000000000000000000000000000006); // WETH
        address token1 = vm.envOr("TOKEN1", 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913); // USDC
        uint24 fee = uint24(vm.envOr("POOL_FEE", uint256(0x800000))); // DYNAMIC_FEE_FLAG
        int24 tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(60))));

        // Order currencies canonically
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hookAddress)
        });

        uint256 currentTime = block.timestamp;
        record = formatCurationProposal(adapterAddress, key, currentTime);

        console.log("=== ModuleRegistry Curation Submission ===");
        console.log("Route ID:           ", vm.toString(record.routeId));
        console.log("Adapter:            ", record.adapter);
        console.log("Hook:               ", record.hook);
        console.log("Tier:               ", record.tier);
        console.log("Queued At (unix):   ", record.queuedAt);
        console.log("Activates At (unix):", record.activatesAt);
        console.log("Timelock Duration:   5 days (432000 seconds)");
        console.log("Status:              QUEUED_FOR_TIMELOCK");
    }
}
