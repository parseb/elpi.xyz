// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UniswapV4VenueAdapter} from "../../../src/adapters/UniswapV4VenueAdapter.sol";
import {OptionSettlementHook} from "../../../src/hooks/OptionSettlementHook.sol";
import {V4LiquidityVault} from "../../../src/periphery/V4LiquidityVault.sol";
import {MockPoolManager} from "../../unit/mocks/MockPoolManager.sol";
import {TestERC20} from "../../unit/mocks/TestERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract UniswapV4Handler is Test {
    UniswapV4VenueAdapter public adapter;
    OptionSettlementHook public hook;
    V4LiquidityVault public vault;

    MockPoolManager public poolManager;
    TestERC20 public tokenA;
    TestERC20 public tokenB;

    address public owner = makeAddr("owner");
    address public lpRouter = makeAddr("lpRouter");

    bytes32 public routeId;
    PoolKey public dummyKey;

    constructor() {
        poolManager = new MockPoolManager(0);
        adapter = new UniswapV4VenueAdapter(address(poolManager));
        hook = new OptionSettlementHook(IPoolManager(address(poolManager)), owner, address(0));

        tokenA = new TestERC20("TokenA", "TKNA", 18);
        tokenB = new TestERC20("TokenB", "TKNB", 18);

        dummyKey = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: 3000,
            tickSpacing: 60,
            hooks: hook
        });

        vault = new V4LiquidityVault(address(poolManager), dummyKey, -600, 600, owner, lpRouter);

        routeId = keccak256(abi.encode(dummyKey));
        adapter.registerRoute(dummyKey, "");

        // Give adapter initial funds for the mock pool manager swap to take
        tokenA.mint(address(poolManager), type(uint128).max);
        tokenB.mint(address(poolManager), type(uint128).max);
        tokenA.mint(address(adapter), type(uint128).max);
        tokenB.mint(address(adapter), type(uint128).max);
    }

    // ─── Actions ───────────────────────────────────────────────────────────

    function randomSwap(uint256 amountIn, bool zeroForOne) public {
        amountIn = bound(amountIn, 1, 1_000_000e18);
        address tokenIn = zeroForOne ? address(tokenA) : address(tokenB);
        address tokenOut = zeroForOne ? address(tokenB) : address(tokenA);

        // Mint tokens to caller
        TestERC20(tokenIn).mint(msg.sender, amountIn);

        vm.startPrank(msg.sender);
        TestERC20(tokenIn).approve(address(adapter), amountIn);

        try adapter.swap(tokenIn, tokenOut, amountIn, 0, block.timestamp, routeId) {
            // Success
        } catch {
            // Revert is fine, just exploring paths
        }
        vm.stopPrank();
    }

    function randomHookCall(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: int256(amount), sqrtPriceLimitX96: 0});

        // Ensure caller is NOT a known position manager
        vm.assume(msg.sender != owner);
        vm.startPrank(msg.sender);

        vm.expectRevert(abi.encodeWithSelector(OptionSettlementHook.InvalidOptionAccount.selector, msg.sender));
        hook.beforeSwap(msg.sender, dummyKey, params, "");
        vm.stopPrank();
    }

    function randomVaultDeposit(uint256 amount) public {
        amount = bound(amount, 1, 100_000e18);

        tokenA.mint(owner, amount);

        vm.startPrank(owner);
        tokenA.approve(address(vault), amount);
        try vault.deposit(address(tokenA), amount) {} catch {}
        vm.stopPrank();
    }

    function randomVaultExtract(uint256 amount) public {
        amount = bound(amount, 1, 100_000e18);

        vm.startPrank(lpRouter);
        try vault.extractForMint(address(tokenA), amount) {} catch {}
        vm.stopPrank();
    }

    function randomOnPositionSettled(address caller, uint256 amount) public {
        vm.assume(caller != address(vault));
        amount = bound(amount, 1, 100_000e18);

        tokenA.mint(caller, amount);
        vm.startPrank(caller);
        tokenA.approve(address(vault), amount);

        // Ensure this doesn't revert (as mandated by spec)
        try vault.onPositionSettled(1, address(tokenA), amount) {}
        catch {
            revert("onPositionSettled reverted");
        }
        vm.stopPrank();
    }
}
