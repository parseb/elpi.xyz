// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UniswapV4VenueAdapter} from "../../../src/adapters/UniswapV4VenueAdapter.sol";
import {V4LiquidityVault} from "../../../src/periphery/V4LiquidityVault.sol";
import {MockPoolManager} from "../../unit/mocks/MockPoolManager.sol";
import {TestERC20} from "../../unit/mocks/TestERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract UniswapV4Handler is Test {
    UniswapV4VenueAdapter public adapter;
    V4LiquidityVault public vault;

    MockPoolManager public poolManager;
    TestERC20 public tokenA;
    TestERC20 public tokenB;

    address public owner = makeAddr("owner");
    address public lpRouter = makeAddr("lpRouter");

    bytes32 public routeId;
    PoolKey public dummyKey;

    uint256 public constant MOCK_SWAP_OUTPUT = 1e18;

    constructor() {
        poolManager = new MockPoolManager(MOCK_SWAP_OUTPUT);
        adapter = new UniswapV4VenueAdapter(address(poolManager));

        tokenA = new TestERC20("TokenA", "TKNA", 18);
        tokenB = new TestERC20("TokenB", "TKNB", 18);

        // Ensure token ordering (currency0 < currency1)
        if (address(tokenA) > address(tokenB)) {
            TestERC20 temp = tokenA;
            tokenA = tokenB;
            tokenB = temp;
        }

        // Canonical pool key (hooks = address(0), standard fee 3000)
        dummyKey = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        vault = new V4LiquidityVault(address(poolManager), dummyKey, -600, 600, owner, lpRouter);

        routeId = keccak256(abi.encode(dummyKey));
        adapter.registerRoute(dummyKey, "");

        // Fund poolManager so take() can transfer tokenOut to recipients
        tokenA.mint(address(poolManager), type(uint128).max);
        tokenB.mint(address(poolManager), type(uint128).max);

        // Note: Adapter starts with and MUST retain 0 balance (Invariant I1)
    }

    // ─── Actions ───────────────────────────────────────────────────────────

    function randomSwap(uint256 amountIn, bool zeroForOne) public {
        if (msg.sender == address(adapter) || msg.sender == address(poolManager)) return;

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
            // Revert is fine, exploring state space
        }
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
        vm.assume(caller != address(vault) && caller != address(adapter) && caller != address(poolManager));
        amount = bound(amount, 1, 100_000e18);

        tokenA.mint(caller, amount);
        vm.startPrank(caller);
        tokenA.approve(address(vault), amount);

        // Ensure this doesn't revert (Invariant I3 best-effort design principle)
        try vault.onPositionSettled(1, address(tokenA), amount) {}
        catch {
            revert("onPositionSettled reverted");
        }
        vm.stopPrank();
    }
}
