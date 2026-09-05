// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Constants} from "@uniswap/v4-core/src/../test/utils/Constants.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {UniswapV4VenueAdapter} from "../../src/adapters/UniswapV4VenueAdapter.sol";
import {OptionSettlementHook} from "../../src/hooks/OptionSettlementHook.sol";
import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {TestERC20} from "../unit/mocks/TestERC20.sol";

contract UniswapV4IntegrationTest is Test {
    using StateLibrary for IPoolManager;

    PoolManager public manager;
    UniswapV4VenueAdapter public adapter;
    OptionSettlementHook public hook;
    V4LiquidityVault public vault;
    bytes32 public routeId;

    TestERC20 public token0;
    TestERC20 public token1;

    address public owner = makeAddr("owner");
    address public positionAccount = makeAddr("positionAccount");
    address public lpRouter = makeAddr("lpRouter");
    address public positionManager = makeAddr("positionManager");

    PoolKey public poolKey;

    function setUp() public {
        // 1. Deploy real PoolManager
        manager = new PoolManager(address(0));

        // 2. Deploy tokens
        token0 = new TestERC20("Token 0", "TKN0", 18);
        token1 = new TestERC20("Token 1", "TKN1", 18);
        // Ensure token0 is actually token0 (lower address)
        if (address(token0) > address(token1)) {
            TestERC20 temp = token0;
            token0 = token1;
            token1 = temp;
        }

        // 3. Deploy OptionCore components
        adapter = new UniswapV4VenueAdapter(address(manager));

        // Deploy hook normally first
        OptionSettlementHook realHook = new OptionSettlementHook(IPoolManager(address(manager)), owner);

        // We need an address that has exactly the BEFORE_SWAP, AFTER_SWAP, and BEFORE_SWAP_RETURNS_DELTA flags
        // Flags: 1<<7 (0x80), 1<<6 (0x40), 1<<3 (0x08) => 0xC8
        address hookAddress = address(0x00000000000000000000000000000000000000C8);
        vm.etch(hookAddress, address(realHook).code);
        hook = OptionSettlementHook(hookAddress);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 0x800000, // DYNAMIC_FEE_FLAG
            tickSpacing: 60,
            hooks: hook
        });

        vault = new V4LiquidityVault(
            address(manager),
            poolKey,
            600, // tickLower > 0 (single sided token0)
            1200, // tickUpper
            owner,
            lpRouter
        );

        // 4. Initialize Pool in PoolManager
        manager.initialize(poolKey, 79228162514264337593543950336); // 1:1 price

        // Register route
        adapter.registerRoute(poolKey, "");
        routeId = keccak256(abi.encode(poolKey));
    }

    // ─── Tests ────────────────────────────────────────────────────────────────

    function test_adapter_swap_revertsWithoutHookAuthorization() public {
        // Try to swap via adapter
        uint256 amount = 100e18;

        token0.mint(positionAccount, amount);
        vm.startPrank(positionAccount);
        token0.approve(address(adapter), amount);

        // Will revert because positionAccount is not a known PositionManager to the hook!
        vm.expectRevert();
        adapter.swap(address(token0), address(token1), amount, 0, block.timestamp, keccak256(abi.encode(poolKey)));
        vm.stopPrank();
    }

    function test_vault_deposit_providesLiquidity() public {
        uint256 amount = 100e18;

        token0.mint(owner, amount);

        vm.startPrank(owner);
        token0.approve(address(vault), amount);

        // Vault should be able to deposit liquidity into the real PoolManager
        vault.deposit(address(token0), amount);
        vm.stopPrank();

        // PoolManager should have some tokens
        assertTrue(token0.balanceOf(address(manager)) > 0);
    }

    function test_adapter_swap_expected_to_fail_due_to_architecture() public {
        uint256 amountIn = 1e18;
        token0.mint(owner, amountIn);
        
        vm.startPrank(owner);
        token0.approve(address(adapter), amountIn);
        
        // This reverts because adapter calls poolManager.swap, so hook sees sender = adapter.
        vm.expectRevert(abi.encodeWithSelector(OptionSettlementHook.InvalidOptionAccount.selector, address(adapter)));
        adapter.swap(
            address(token0),
            address(token1),
            amountIn,
            0,
            block.timestamp,
            routeId
        );
        vm.stopPrank();
    }
}
