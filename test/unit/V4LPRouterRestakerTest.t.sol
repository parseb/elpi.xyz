// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {V4LPRouterRestaker} from "../../src/periphery/V4LPRouterRestaker.sol";
import {ILPRouter} from "../../src/interfaces/ILPRouter.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract MockLPRouterForRestaker is ILPRouter {
    mapping(address => mapping(address => uint256)) internal _claimable;
    TestERC20 public immutable token;

    constructor(TestERC20 token_) {
        token = token_;
    }

    function creditBacker(address backer, address asset, uint256 amount) external {
        _claimable[backer][asset] += amount;
        emit Credited(1, backer, asset, amount);
    }

    function claimable(address backer, address asset) external view override returns (uint256) {
        return _claimable[backer][asset];
    }

    function withdraw(address asset) external override {
        uint256 amount = _claimable[msg.sender][asset];
        require(amount > 0, "NothingToWithdraw");
        _claimable[msg.sender][asset] = 0;
        TestERC20(asset).transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, asset, amount);
    }

    // Mock settlement target function that simulates LPRouter.settleAndCredit
    function simulateSettleAndCredit(address backer, address asset, uint256 amount) external {
        _claimable[backer][asset] += amount;
        emit Credited(1, backer, asset, amount);
    }
}

contract V4LPRouterRestakerTest is Test {
    V4LiquidityVault internal vault;
    V4LPRouterRestaker internal restaker;
    MockPoolManager internal poolManager;
    TestERC20 internal token;
    MockLPRouterForRestaker internal router;

    address internal owner = makeAddr("owner");
    PoolKey internal dummyKey;

    function setUp() public {
        token = new TestERC20("Token", "TKN", 18);
        poolManager = new MockPoolManager(0);
        router = new MockLPRouterForRestaker(token);
        restaker = new V4LPRouterRestaker();

        dummyKey = PoolKey({
            currency0: Currency.wrap(address(token)),
            currency1: Currency.wrap(address(2)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        vault = new V4LiquidityVault(address(poolManager), dummyKey, -600, 600, owner, address(router));

        // Fund router and pool manager
        token.mint(address(router), 10_000e18);
        token.mint(address(poolManager), 10_000e18);
    }

    // ─── 1. Direct vault.restakeFromRouter ──────────────────────────────────────

    function test_vault_restakeFromRouter_success() public {
        uint256 amount = 50e18;
        router.creditBacker(address(vault), address(token), amount);

        assertEq(router.claimable(address(vault), address(token)), amount);
        assertEq(token.balanceOf(address(vault)), 0);

        // Vault calls restakeFromRouter
        vault.restakeFromRouter(address(token));

        // Claimable should be zero, funds restaked into poolManager
        assertEq(router.claimable(address(vault), address(token)), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.pendingAsset(address(token)), 0);
    }

    // ─── 2. V4LPRouterRestaker.restakeVault ─────────────────────────────────────

    function test_restaker_restakeVault_success() public {
        uint256 amount = 75e18;
        router.creditBacker(address(vault), address(token), amount);

        restaker.restakeVault(address(vault), address(token));

        assertEq(router.claimable(address(vault), address(token)), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.pendingAsset(address(token)), 0);
    }

    // ─── 3. V4LPRouterRestaker.batchRestake ─────────────────────────────────────

    function test_restaker_batchRestake_success() public {
        uint256 amount = 100e18;
        router.creditBacker(address(vault), address(token), amount);

        address[] memory vaults = new address[](1);
        vaults[0] = address(vault);
        address[] memory assets = new address[](1);
        assets[0] = address(token);

        restaker.batchRestake(vaults, assets);

        assertEq(router.claimable(address(vault), address(token)), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.pendingAsset(address(token)), 0);
    }

    // ─── 4. V4LPRouterRestaker.settleAndRestake ─────────────────────────────────

    function test_restaker_settleAndRestake_atomic() public {
        uint256 amount = 120e18;

        bytes memory settlementData = abi.encodeWithSelector(
            MockLPRouterForRestaker.simulateSettleAndCredit.selector, address(vault), address(token), amount
        );

        // Call settleAndRestake atomically
        restaker.settleAndRestake(address(router), settlementData, address(vault), address(token));

        assertEq(router.claimable(address(vault), address(token)), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.pendingAsset(address(token)), 0);
    }

    // ─── 5. Failure isolation: Re-staking revert is absorbed ────────────────────

    function test_restakeRevert_isAbsorbed_intoPendingAsset() public {
        uint256 amount = 40e18;
        router.creditBacker(address(vault), address(token), amount);

        // Force poolManager to revert during modifyLiquidity
        poolManager.setShouldRevert(true);

        // restakeVault should NOT revert
        restaker.restakeVault(address(vault), address(token));

        // Funds were safely pulled from router and kept in vault's pendingAsset
        assertEq(router.claimable(address(vault), address(token)), 0);
        assertEq(token.balanceOf(address(vault)), amount);
        assertEq(vault.pendingAsset(address(token)), amount);

        // Now owner can manualRestake after pool recovers
        poolManager.setShouldRevert(false);
        vm.prank(owner);
        vault.manualRestake(address(token));

        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.pendingAsset(address(token)), 0);
    }
}
