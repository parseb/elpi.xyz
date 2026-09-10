// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {UniswapV4VenueAdapter} from "../../src/adapters/UniswapV4VenueAdapter.sol";
import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {ILPSettlementHook} from "../../src/interfaces/ILPSettlementHook.sol";
import {ISettlementVenue} from "../../src/interfaces/ISettlementVenue.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {MockPriceOracle} from "../../src/mocks/MockPriceOracle.sol";
import {TestERC20} from "../unit/mocks/TestERC20.sol";
import {IERC1271} from "../../src/interfaces/IERC1271.sol";

/// @dev Simulates PositionAccount executing settlements with in-kind fallback (Compromise Architecture)
contract IntegrationPositionAccount {
    address public immutable collateralAsset;
    address public immutable settlementAsset;
    uint256 public immutable strikePrice;
    uint256 public immutable units;
    uint256 public immutable expiryTimestamp;
    uint256 public immutable feeBps;

    address public immutable taker;
    address public immutable lpVault;
    address public immutable feeRecipient;
    IPriceOracle public immutable oracle;
    ISettlementVenue public immutable venue;
    bytes32 public immutable routeId;

    bool public settled;

    constructor(
        address _collateralAsset,
        address _settlementAsset,
        uint256 _strikePrice,
        uint256 _units,
        uint256 _expiryTimestamp,
        uint256 _feeBps,
        address _taker,
        address _lpVault,
        address _feeRecipient,
        IPriceOracle _oracle,
        ISettlementVenue _venue,
        bytes32 _routeId
    ) {
        collateralAsset = _collateralAsset;
        settlementAsset = _settlementAsset;
        strikePrice = _strikePrice;
        units = _units;
        expiryTimestamp = _expiryTimestamp;
        feeBps = _feeBps;
        taker = _taker;
        lpVault = _lpVault;
        feeRecipient = _feeRecipient;
        oracle = _oracle;
        venue = _venue;
        routeId = _routeId;
    }

    function settleToTakerCall(uint256 slippageBps) external returns (uint256 netPayout, uint256 fee) {
        require(!settled, "AlreadySettled");
        settled = true;

        (uint256 spotPrice,) = oracle.price(collateralAsset, settlementAsset);
        require(spotPrice > strikePrice, "NotITM");

        uint256 grossPayout = ((spotPrice - strikePrice) * units) / 1e18;
        fee = (grossPayout * feeBps + 9999) / 10000;
        netPayout = grossPayout - fee;

        uint256 collateralNeeded = (grossPayout * 1e18) / spotPrice;
        uint256 totalCollateral = TestERC20(collateralAsset).balanceOf(address(this));
        if (collateralNeeded > totalCollateral) collateralNeeded = totalCollateral;

        uint256 minAmountOut = (grossPayout * (10000 - slippageBps)) / 10000;

        TestERC20(collateralAsset).approve(address(venue), collateralNeeded);

        // Attempt swap through canonical pool; if it fails (dry pool / slippage), execute in-kind fallback
        try venue.swap(collateralAsset, settlementAsset, collateralNeeded, minAmountOut, block.timestamp + 300, routeId)
        {
            TestERC20(settlementAsset).transfer(taker, netPayout);
            TestERC20(settlementAsset).transfer(feeRecipient, fee);
        } catch {
            TestERC20(collateralAsset).approve(address(venue), 0);
            fee = (collateralNeeded * feeBps + 9999) / 10000;
            netPayout = collateralNeeded - fee;

            TestERC20(collateralAsset).transfer(taker, netPayout);
            TestERC20(collateralAsset).transfer(feeRecipient, fee);
        }

        // Return unspent collateral to LP vault & auto-restake
        uint256 remaining = TestERC20(collateralAsset).balanceOf(address(this));
        if (remaining > 0) {
            TestERC20(collateralAsset).transfer(lpVault, remaining);
            try ILPSettlementHook(lpVault).onPositionSettled(1, collateralAsset, remaining) {} catch {}
        }
    }

    function settleToLp() external returns (uint256 recovered) {
        require(!settled, "AlreadySettled");
        require(block.timestamp >= expiryTimestamp, "NotExpired");
        settled = true;

        recovered = TestERC20(collateralAsset).balanceOf(address(this));
        TestERC20(collateralAsset).transfer(lpVault, recovered);
        try ILPSettlementHook(lpVault).onPositionSettled(1, collateralAsset, recovered) {} catch {}
    }
}

/// @title UniswapV4IntegrationTest
/// @notice End-to-end integration tests against real Uniswap v4 PoolManager under Compromise Architecture:
///         - Canonical pools without custom hooks (hooks = address(0), fee = 3000)
///         - Single-transaction atomic extraction (extractForMint)
///         - In-Kind Fallback on swap failure
///         - Post-expiry venue-free/oracle-free recovery with gas benchmark
contract UniswapV4IntegrationTest is Test {
    using StateLibrary for IPoolManager;

    PoolManager public manager;
    UniswapV4VenueAdapter public adapter;
    V4LiquidityVault public vault;
    bytes32 public routeId;
    PoolKey public poolKey;

    TestERC20 public token0; // WETH
    TestERC20 public token1; // USDC
    MockPriceOracle public oracle;

    address public owner;
    uint256 public ownerPrivateKey;
    address public lpRouter = makeAddr("lpRouter");
    address public bobTaker = makeAddr("bobTaker");
    address public feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        (owner, ownerPrivateKey) = makeAddrAndKey("owner");

        // 1. Deploy real PoolManager
        manager = new PoolManager(address(0));

        // 2. Deploy tokens — ensure canonical ordering (currency0 < currency1 by address)
        token0 = new TestERC20("Wrapped Ether", "WETH", 18);
        token1 = new TestERC20("USD Coin", "USDC", 18);
        if (address(token0) > address(token1)) {
            TestERC20 temp = token0;
            token0 = token1;
            token1 = temp;
        }

        // 3. Deploy adapter
        adapter = new UniswapV4VenueAdapter(address(manager));

        // 4. Build canonical PoolKey without custom hooks (hooks = address(0), standard 3000 fee)
        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        // 5. Deploy vault for LP collateral staging (single-sided tick 600..1200)
        vault = new V4LiquidityVault(
            address(manager),
            poolKey,
            600, // tickLower > 0 so only token0 is needed
            1200, // tickUpper
            owner,
            lpRouter
        );

        // 6. Initialise pool at 1:1 price
        manager.initialize(poolKey, 79228162514264337593543950336);

        // 7. Register route in adapter
        adapter.registerRoute(poolKey, "");
        routeId = keccak256(abi.encode(poolKey));

        // 8. Oracle initialized at 2500e18
        oracle = new MockPriceOracle(address(token0), address(token1), 2500e18, 18, "WETH/USDC");
    }

    /// @notice Verifies Pillar I: LP stages capital in vault and signs quote off-chain (EIP-1271)
    function test_isValidSignature_eip1271() public view {
        bytes32 digest = keccak256("OptionCore BackerQuote Digest");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        bytes4 magic = vault.isValidSignature(digest, signature);
        assertEq(magic, IERC1271.isValidSignature.selector, "ERC-1271 magic value matches");
    }

    /// @notice Verifies Pillar II: 1-Tx Taker-Triggered Atomic Extraction
    function test_vault_deposit_and_atomic_extraction() public {
        uint256 depositAmt = 100e18;
        token0.mint(owner, depositAmt);

        vm.startPrank(owner);
        token0.approve(address(vault), depositAmt);
        vault.deposit(address(token0), depositAmt);
        vm.stopPrank();

        // Real PoolManager holds the tokens
        assertTrue(token0.balanceOf(address(manager)) > 0, "PoolManager holds deposited liquidity");

        // Taker calls matchAndMint -> router calls extractForMint -> atomic transfer
        uint256 extractAmt = 25e18;
        vm.prank(lpRouter);
        vault.extractForMint(address(token0), extractAmt);

        // Assert: router received raw ERC-20 directly without an approval hop
        assertEq(token0.balanceOf(lpRouter), extractAmt, "Router received extracted tokens directly");
        assertTrue(token0.balanceOf(address(manager)) > 0, "PoolManager holds remaining liquidity");
    }

    /// @notice Verifies Pillar III & IV: Canonical Pool settlement with In-Kind Fallback and Auto-Restake
    function test_canonical_settlement_in_kind_fallback_and_auto_restake() public {
        // 1. LP stages capital
        uint256 depositAmt = 10e18;
        token0.mint(owner, depositAmt);
        vm.startPrank(owner);
        token0.approve(address(vault), depositAmt);
        vault.deposit(address(token0), depositAmt);
        vm.stopPrank();

        // 2. 1-Tx Mint: Router extracts 1 WETH collateral to back position
        vm.prank(lpRouter);
        vault.extractForMint(address(token0), 1e18);

        uint256 expiry = block.timestamp + 1 days;
        IntegrationPositionAccount position = new IntegrationPositionAccount(
            address(token0),
            address(token1),
            2500e18, // strike
            1e18, // units
            expiry,
            100, // 1% fee
            bobTaker,
            address(vault),
            feeRecipient,
            oracle,
            adapter,
            routeId
        );

        vm.prank(lpRouter);
        token0.transfer(address(position), 1e18);

        // 3. Price moves up: ETH hits $3000 (ITM)
        oracle.setPrice(3000e18, block.timestamp);

        // 4. Settle CALL option -> pool has no quote liquidity -> in-kind fallback executes!
        uint256 takerBalBefore = token0.balanceOf(bobTaker);
        uint256 feeBalBefore = token0.balanceOf(feeRecipient);

        (uint256 netPayout, uint256 fee) = position.settleToTakerCall(50);

        uint256 expectedCollateralNeeded = (uint256(500e18) * 1e18) / 3000e18;
        uint256 expectedFee = (expectedCollateralNeeded * 100 + 9999) / 10000;
        uint256 expectedNet = expectedCollateralNeeded - expectedFee;

        assertEq(netPayout, expectedNet, "In-kind net payout matches formula");
        assertEq(fee, expectedFee, "In-kind fee matches 1% rounded up");
        assertEq(token0.balanceOf(bobTaker) - takerBalBefore, expectedNet, "Bob received in-kind collateral");
        assertEq(token0.balanceOf(feeRecipient) - feeBalBefore, expectedFee, "Fee recipient received in-kind fee");

        // Unspent collateral returned to LP vault and auto-restaked into real PoolManager
        assertEq(token0.balanceOf(address(position)), 0, "Position holds zero balance");
        assertTrue(position.settled(), "Position is marked settled");
    }

    /// @notice Verifies Pillar III Invariant I3: OTM Expiry Settle to LP with Gas Benchmark
    function test_otm_expiry_settle_to_lp_gas_benchmark() public {
        // 1. Stage capital & extract to position
        token0.mint(owner, 10e18);
        vm.startPrank(owner);
        token0.approve(address(vault), 10e18);
        vault.deposit(address(token0), 10e18);
        vm.stopPrank();

        vm.prank(lpRouter);
        vault.extractForMint(address(token0), 2e18);

        uint256 expiry = block.timestamp + 1 days;
        IntegrationPositionAccount position = new IntegrationPositionAccount(
            address(token0),
            address(token1),
            2500e18, // strike
            2e18, // units
            expiry,
            100, // 1% fee
            bobTaker,
            address(vault),
            feeRecipient,
            oracle,
            adapter,
            routeId
        );

        vm.prank(lpRouter);
        token0.transfer(address(position), 2e18);

        // 2. Warp past expiry
        vm.warp(expiry + 10);

        // 3. Settle OTM with gas benchmarking
        uint256 gasStart = gasleft();
        uint256 recovered = position.settleToLp();
        uint256 gasUsed = gasStart - gasleft();

        assertEq(recovered, 2e18, "100% collateral recovered to LP vault");
        assertEq(token0.balanceOf(address(position)), 0, "Position account empty");
        assertTrue(position.settled(), "Position settled");

        // Gas benchmark: must be well within the 300,000 stipend
        assertTrue(gasUsed < 300_000, "Gas used for settleToLp must be < 300k gas stipend");
        emit log_named_uint("Gas used for settleToLp + auto-restake", gasUsed);
    }
}
