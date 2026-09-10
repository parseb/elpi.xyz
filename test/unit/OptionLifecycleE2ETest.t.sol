// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {UniswapV4VenueAdapter} from "../../src/adapters/UniswapV4VenueAdapter.sol";
import {V4LiquidityVault} from "../../src/periphery/V4LiquidityVault.sol";
import {V4LPRouterRestaker} from "../../src/periphery/V4LPRouterRestaker.sol";
import {ILPSettlementHook} from "../../src/interfaces/ILPSettlementHook.sol";
import {ISettlementVenue} from "../../src/interfaces/ISettlementVenue.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {MockPriceOracle} from "../../src/mocks/MockPriceOracle.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {TestERC20} from "./mocks/TestERC20.sol";

/// @title E2EPositionAccount
/// @author parseb
/// @notice Simulates OptionCore's PositionAccount executing CALL and PUT settlements
///         over UniswapV4VenueAdapter, enforcing Invariants I1, I2, I3, and I4.
contract E2EPositionAccount {
    enum OptionType {
        CALL,
        PUT
    }

    uint256 public immutable positionId;
    OptionType public immutable optionType;
    address public immutable collateralAsset;
    address public immutable settlementAsset;
    uint256 public immutable strikePrice; // 1e18 scale
    uint256 public immutable units; // 1e18 scale
    uint256 public immutable expiryTimestamp;
    uint256 public immutable feeBps; // 100 = 1%

    address public immutable taker;
    address public immutable lpVault;
    address public immutable protocolFeeRecipient;
    address public immutable positionManager;
    IPriceOracle public immutable oracle;
    ISettlementVenue public immutable venue;
    bytes32 public immutable routeId;

    bool public settled;

    error AlreadySettled();
    error NotExpired();
    error OptionNotITM();
    error ZeroPayout();

    struct PositionInitParams {
        uint256 positionId;
        OptionType optionType;
        address collateralAsset;
        address settlementAsset;
        uint256 strikePrice;
        uint256 units;
        uint256 expiryTimestamp;
        uint256 feeBps;
        address taker;
        address lpVault;
        address protocolFeeRecipient;
        address positionManager;
        IPriceOracle oracle;
        ISettlementVenue venue;
        bytes32 routeId;
    }

    constructor(PositionInitParams memory p) {
        positionId = p.positionId;
        optionType = p.optionType;
        collateralAsset = p.collateralAsset;
        settlementAsset = p.settlementAsset;
        strikePrice = p.strikePrice;
        units = p.units;
        expiryTimestamp = p.expiryTimestamp;
        feeBps = p.feeBps;
        taker = p.taker;
        lpVault = p.lpVault;
        protocolFeeRecipient = p.protocolFeeRecipient;
        positionManager = p.positionManager;
        oracle = p.oracle;
        venue = p.venue;
        routeId = p.routeId;
    }

    /// @dev ERC-6551 simulation for hook verification
    function token() external view returns (uint256, address, uint256) {
        return (block.chainid, positionManager, positionId);
    }

    /// @notice Settle In-The-Money CALL: converts underlying to payout asset via UniswapV4VenueAdapter.
    function settleToTakerCall(uint256 slippageBps) external returns (uint256 netPayout, uint256 fee) {
        if (settled) revert AlreadySettled();
        settled = true;

        (uint256 spotPrice,) = oracle.price(collateralAsset, settlementAsset);
        if (spotPrice <= strikePrice) revert OptionNotITM();

        // Gross payout = (spotPrice - strikePrice) * units / 1e18
        uint256 priceDiff = spotPrice - strikePrice;
        uint256 grossPayout = (priceDiff * units) / 1e18;
        if (grossPayout == 0) revert ZeroPayout();

        // Protocol fee: 100 bps / 1%, rounded up (Invariant I4)
        fee = (grossPayout * feeBps + 9999) / 10000;
        netPayout = grossPayout - fee;

        // Collateral needed to fund gross payout at spot price:
        uint256 collateralNeeded = (grossPayout * 1e18) / spotPrice;
        uint256 totalCollateral = TestERC20(collateralAsset).balanceOf(address(this));
        if (collateralNeeded > totalCollateral) collateralNeeded = totalCollateral;

        // Min payout floor derived strictly from oracle spot with slippage tolerance
        uint256 minAmountOut = (grossPayout * (10000 - slippageBps)) / 10000;

        // Approve venue adapter to pull exact collateralNeeded
        TestERC20(collateralAsset).approve(address(venue), collateralNeeded);

        // Execute swap through UniswapV4VenueAdapter with in-kind fallback
        try venue.swap(collateralAsset, settlementAsset, collateralNeeded, minAmountOut, block.timestamp + 300, routeId)
        {
            // Disburse payouts in settlement asset
            TestERC20(settlementAsset).transfer(taker, netPayout);
            TestERC20(settlementAsset).transfer(protocolFeeRecipient, fee);
        } catch {
            // In-Kind Fallback: transfer oracle-priced equivalent of underlying collateral asset directly to taker
            TestERC20(collateralAsset).approve(address(venue), 0);

            // Calculate in-kind fee and net payout in collateralAsset
            fee = (collateralNeeded * feeBps + 9999) / 10000;
            netPayout = collateralNeeded - fee;

            TestERC20(collateralAsset).transfer(taker, netPayout);
            TestERC20(collateralAsset).transfer(protocolFeeRecipient, fee);
        }

        // Return unspent collateral back to LP vault & notify hook for auto-restake
        uint256 remainingCollateral = TestERC20(collateralAsset).balanceOf(address(this));
        if (remainingCollateral > 0) {
            TestERC20(collateralAsset).transfer(lpVault, remainingCollateral);
            try ILPSettlementHook(lpVault).onPositionSettled(positionId, collateralAsset, remainingCollateral) {}
                catch {}
        }
    }

    /// @notice Settle In-The-Money PUT: payout funded from locked cash collateral.
    function settleToTakerPut() external returns (uint256 netPayout, uint256 fee) {
        if (settled) revert AlreadySettled();
        settled = true;

        (uint256 spotPrice,) = oracle.price(collateralAsset, settlementAsset);
        if (spotPrice >= strikePrice) revert OptionNotITM();

        // Gross payout = (strikePrice - spotPrice) * units / 1e18
        uint256 priceDiff = strikePrice - spotPrice;
        uint256 grossPayout = (priceDiff * units) / 1e18;
        if (grossPayout == 0) revert ZeroPayout();

        // Protocol fee: 100 bps / 1%, rounded up (Invariant I4)
        fee = (grossPayout * feeBps + 9999) / 10000;
        netPayout = grossPayout - fee;

        // Disburse payouts in settlement asset
        TestERC20(settlementAsset).transfer(taker, netPayout);
        TestERC20(settlementAsset).transfer(protocolFeeRecipient, fee);

        // Return unspent collateral back to LP vault & notify hook for auto-restake
        uint256 remainingCollateral = TestERC20(settlementAsset).balanceOf(address(this));
        if (remainingCollateral > 0) {
            TestERC20(settlementAsset).transfer(lpVault, remainingCollateral);
            try ILPSettlementHook(lpVault).onPositionSettled(positionId, settlementAsset, remainingCollateral) {}
                catch {}
        }
    }

    /// @notice Settle Out-of-The-Money to LP (Invariant I3: venue-free and oracle-free recovery).
    function settleToLp() external returns (uint256 recoveredCollateral) {
        if (settled) revert AlreadySettled();
        if (block.timestamp < expiryTimestamp) revert NotExpired();
        settled = true;

        // Return 100% of remaining collateral back to LP without touching oracle or venue
        address asset = (optionType == OptionType.CALL) ? collateralAsset : settlementAsset;
        recoveredCollateral = TestERC20(asset).balanceOf(address(this));

        TestERC20(asset).transfer(lpVault, recoveredCollateral);
        try ILPSettlementHook(lpVault).onPositionSettled(positionId, asset, recoveredCollateral) {} catch {}
    }
}

/// @title OptionLifecycleE2ETest
/// @author parseb
/// @notice End-to-end integration test suite verifying the complete user flow for
///         LP provision, CALL and PUT settlements, and exact price movement accounting.
contract OptionLifecycleE2ETest is Test {
    UniswapV4VenueAdapter internal adapter;
    V4LiquidityVault internal vaultWeth;
    V4LiquidityVault internal vaultUsdc;
    V4LPRouterRestaker internal restaker;
    MockPoolManager internal poolManager;
    MockPriceOracle internal oracle;

    TestERC20 internal weth;
    TestERC20 internal usdc;

    address internal owner = makeAddr("owner");
    address internal aliceLp = makeAddr("aliceLp");
    address internal bobTaker = makeAddr("bobTaker");
    address internal protocolFeeRecipient = makeAddr("feeVault");
    address internal positionManager = makeAddr("positionManager");
    address internal lpRouter = makeAddr("lpRouter");

    PoolKey internal poolKey;
    bytes32 internal routeId;

    uint256 internal constant INITIAL_SPOT_PRICE = 2500e18; // $2,500 USDC / WETH
    uint256 internal constant STRIKE_PRICE = 2500e18; // $2,500 ATM
    uint256 internal constant OPTION_UNITS = 2e18; // 2 WETH units
    uint256 internal constant CALL_PREMIUM = 150e18; // 150 USDC premium (75 USDC / WETH)
    uint256 internal constant PUT_PREMIUM = 200e18; // 200 USDC premium (100 USDC / WETH)
    uint256 internal constant BASE_POOL_WETH = 1_000e18;
    uint256 internal constant BASE_POOL_USDC = 1_000_000e18;

    function setUp() public {
        weth = new TestERC20("Wrapped Ether", "WETH", 18);
        usdc = new TestERC20("USD Coin", "USDC", 18);

        // Ensure token ordering (currency0 < currency1)
        while (address(weth) > address(usdc)) {
            usdc = new TestERC20("USD Coin", "USDC", 18);
        }

        poolManager = new MockPoolManager(0);
        adapter = new UniswapV4VenueAdapter(address(poolManager));

        // Canonical Uniswap v4 pool (Compromise Architecture: hooks = address(0), standard 3000 fee)
        poolKey = PoolKey({
            currency0: Currency.wrap(address(weth)),
            currency1: Currency.wrap(address(usdc)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        adapter.registerRoute(poolKey, "");
        routeId = keccak256(abi.encode(poolKey));

        // Deploy vaults for LP collateral
        vaultWeth = new V4LiquidityVault(address(poolManager), poolKey, -600, 600, aliceLp, lpRouter);
        vaultUsdc = new V4LiquidityVault(address(poolManager), poolKey, -600, 600, aliceLp, lpRouter);
        poolManager.setDefaultCurrency(address(vaultUsdc), poolKey.currency1);

        restaker = new V4LPRouterRestaker();

        // Deploy Oracle initialized at $2,500
        oracle = new MockPriceOracle(address(weth), address(usdc), INITIAL_SPOT_PRICE, 18, "WETH/USDC");

        // Mint liquidity reserves into PoolManager to service swaps
        usdc.mint(address(poolManager), BASE_POOL_USDC);
        weth.mint(address(poolManager), BASE_POOL_WETH);
    }

    function _createPosition(
        uint256 positionId,
        E2EPositionAccount.OptionType optionType,
        address collateralAsset,
        address settlementAsset,
        uint256 strikePrice,
        uint256 units,
        uint256 expiryTimestamp,
        address lpVault
    ) internal returns (E2EPositionAccount) {
        return new E2EPositionAccount(
            E2EPositionAccount.PositionInitParams({
                positionId: positionId,
                optionType: optionType,
                collateralAsset: collateralAsset,
                settlementAsset: settlementAsset,
                strikePrice: strikePrice,
                units: units,
                expiryTimestamp: expiryTimestamp,
                feeBps: 100,
                taker: bobTaker,
                lpVault: lpVault,
                protocolFeeRecipient: protocolFeeRecipient,
                positionManager: positionManager,
                oracle: oracle,
                venue: adapter,
                routeId: routeId
            })
        );
    }

    /// @notice 1. Test LP Provision & Collateral Extraction for Mint
    function test_e2e_lp_provision_and_capacity_allocation() public {
        uint256 depositWeth = 100e18;
        uint256 depositUsdc = 250_000e18;

        weth.mint(aliceLp, depositWeth);
        usdc.mint(aliceLp, depositUsdc);

        // Alice deposits collateral into vaults, staging it into Uniswap v4 PoolManager
        vm.startPrank(aliceLp);
        weth.approve(address(vaultWeth), depositWeth);
        vaultWeth.deposit(address(weth), depositWeth);

        usdc.approve(address(vaultUsdc), depositUsdc);
        vaultUsdc.deposit(address(usdc), depositUsdc);
        vm.stopPrank();

        // Alice's liquid balance is now 0 (all staged in vaults)
        assertEq(weth.balanceOf(aliceLp), 0);
        assertEq(usdc.balanceOf(aliceLp), 0);

        // Vaults hold 0 loose tokens (all capital staked into PoolManager)
        assertEq(weth.balanceOf(address(vaultWeth)), 0);
        assertEq(usdc.balanceOf(address(vaultUsdc)), 0);

        // PoolManager holds baseline reserves + LP deposits
        assertEq(weth.balanceOf(address(poolManager)), BASE_POOL_WETH + depositWeth);
        assertEq(usdc.balanceOf(address(poolManager)), BASE_POOL_USDC + depositUsdc);

        // Router extracts collateral for a new CALL option (2 WETH) and PUT option (5,000 USDC)
        vm.prank(lpRouter);
        vaultWeth.extractForMint(address(weth), OPTION_UNITS);

        vm.prank(lpRouter);
        vaultUsdc.extractForMint(address(usdc), 5000e18);

        // PoolManager balance decreased by extracted amounts
        assertEq(weth.balanceOf(address(poolManager)), BASE_POOL_WETH + depositWeth - OPTION_UNITS);
        assertEq(usdc.balanceOf(address(poolManager)), BASE_POOL_USDC + depositUsdc - 5000e18);

        // 1-Tx Atomic Extraction: Router receives raw ERC-20 directly without approval hop
        assertEq(weth.balanceOf(lpRouter), OPTION_UNITS);
        assertEq(usdc.balanceOf(lpRouter), 5000e18);
        assertEq(weth.balanceOf(address(vaultWeth)), 0);
        assertEq(usdc.balanceOf(address(vaultUsdc)), 0);
    }

    /// @notice 2. Test In-The-Money CALL Settlement with Accurate Bullish Price Movement (+28%)
    ///         Verifies complete lifecycle: LP deposit -> Taker pays premium -> Collateral extraction ->
    ///         Bullish price surge -> Taker settles for net profit -> Unspent collateral auto-restaked ->
    ///         LP net wealth accounts for payout and upfront premium.
    function test_e2e_call_bullish_ITM_accurate_price_movement_accounting() public {
        // ─── Phase 1: LP Stages Collateral in Uniswap v4 ───────────────────────
        weth.mint(aliceLp, 10e18);
        vm.startPrank(aliceLp);
        weth.approve(address(vaultWeth), 10e18);
        vaultWeth.deposit(address(weth), 10e18);
        vm.stopPrank();

        assertEq(weth.balanceOf(aliceLp), 0, "Alice liquid WETH should be 0 after deposit");
        assertEq(weth.balanceOf(address(vaultWeth)), 0, "Vault loose WETH should be 0 (all staged)");
        assertEq(weth.balanceOf(address(poolManager)), BASE_POOL_WETH + 10e18, "PoolManager holds staged WETH");

        // ─── Phase 2: Taker Pays Premium & Option Minting ──────────────────────
        usdc.mint(bobTaker, 500e18);

        // Bob pays CALL_PREMIUM (150 USDC) to Alice (LP)
        vm.prank(bobTaker);
        usdc.transfer(aliceLp, CALL_PREMIUM);

        assertEq(usdc.balanceOf(bobTaker), 350e18, "Bob USDC balance decreased by premium");
        assertEq(usdc.balanceOf(aliceLp), CALL_PREMIUM, "Alice received upfront premium in USDC");

        // LPRouter extracts 2 WETH from vault to fund PositionAccount
        vm.prank(lpRouter);
        vaultWeth.extractForMint(address(weth), OPTION_UNITS);

        // Staged collateral in PoolManager decreased by 2 WETH (from 10 to 8)
        assertEq(weth.balanceOf(address(poolManager)), BASE_POOL_WETH + 8e18);

        E2EPositionAccount position = _createPosition(
            101,
            E2EPositionAccount.OptionType.CALL,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            OPTION_UNITS,
            block.timestamp + 1 days,
            address(vaultWeth)
        );

        // Router funds isolated PositionAccount (Invariant I1: raw ERC-20)
        vm.prank(lpRouter);
        weth.transfer(address(position), OPTION_UNITS);
        assertEq(weth.balanceOf(address(position)), OPTION_UNITS, "PositionAccount holds pure ERC-20 collateral");

        // ─── Phase 3 & 4: Bullish Price Movement (+28%) and Settlement ────────
        {
            // Price surges from $2,500 to $3,200 (+28%)
            // Gross = ($3,200 - $2,500) * 2 = $1,400 USDC
            // Fee (1%) = $14 USDC, Net = $1,386 USDC
            // Collateral needed = $1,400 / $3,200 = 0.4375 WETH
            // Remainder unspent collateral = 2 - 0.4375 = 1.5625 WETH
            oracle.setPrice(3200e18, block.timestamp);
            poolManager.setMockAmountOut(1400e18);

            (uint256 actualNet, uint256 actualFee) = position.settleToTakerCall(50); // 0.5% max slippage
            assertEq(actualNet, 1386e18, "Taker net payout mismatch");
            assertEq(actualFee, 14e18, "Protocol fee mismatch");
        }

        // ─── Phase 5: Taker Profit Verification ────────────────────────────────
        {
            // Bob started with 500 USDC, paid 150 USDC premium, and received 1,386 USDC payout
            uint256 bobFinalUsdc = usdc.balanceOf(bobTaker);
            assertEq(bobFinalUsdc, 1736e18, "Bob final balance should be exactly 1,736 USDC");

            // Taker Net Profit = 1,736 - 500 = +1,236 USDC (1,386 payout - 150 premium)
            uint256 bobNetProfit = bobFinalUsdc - 500e18;
            assertEq(bobNetProfit, 1236e18, "Bob net profit should be exactly +1,236 USDC");
            assertGt(bobFinalUsdc, 500e18, "Taker made a net profit on ITM CALL");

            assertEq(usdc.balanceOf(protocolFeeRecipient), 14e18, "Protocol fee recipient balance mismatch");
        }

        // ─── Phase 6: Post-Settlement Deposit Crediting & Auto-Restake ─────────
        {
            // PositionAccount transferred 1.5625 WETH unspent collateral back to vaultWeth
            // and invoked onPositionSettled, which automatically re-staked it into PoolManager.
            assertEq(vaultWeth.pendingAsset(address(weth)), 0, "Post-settlement deposit auto-restaked (pending is 0)");
            assertEq(weth.balanceOf(address(vaultWeth)), 0, "Vault loose balance is 0 (all restaked)");

            // Total PoolManager WETH: 1,008 (unextracted) + 0.4375 (received via swap) + 1.5625 (restaked) = 1,010 WETH
            assertEq(weth.balanceOf(address(poolManager)), BASE_POOL_WETH + 10e18, "PoolManager holds full 1,010 WETH");
            // PoolManager USDC: paid out 1,400 USDC to service the swap
            assertEq(
                usdc.balanceOf(address(poolManager)),
                BASE_POOL_USDC - 1400e18,
                "PoolManager USDC decreased by gross swap payout"
            );
        }

        // ─── Phase 7: LP Position Value & Net Wealth Verification ─────────────
        {
            // LP staged: 9.5625 WETH @ $3,200 = 30,600 USDC. Liquid cash: 150 USDC. Total = 30,750 USDC.
            // Baseline without option: 10 WETH * $3,200 = 32,000 USDC.
            // Accounting: Baseline (32,000) - Gross Payout (1,400) + Premium (150) = 30,750 USDC!
            uint256 lpStagedValueUsdc = (9.5625e18 * 3200e18) / 1e18;
            uint256 lpTotalWealthUsdc = lpStagedValueUsdc + usdc.balanceOf(aliceLp);
            assertEq(lpTotalWealthUsdc, 30750e18, "LP total wealth exact mathematical match");

            // Invariant I1: Venue adapter holds zero persistent tokens
            assertEq(weth.balanceOf(address(adapter)), 0, "Invariant I1: adapter WETH balance strictly zero");
            assertEq(usdc.balanceOf(address(adapter)), 0, "Invariant I1: adapter USDC balance strictly zero");
        }
    }

    /// @notice 3. Test Out-of-The-Money CALL with Auto-Restake and LP Profit
    ///         Verifies: Taker loses 100% of premium, 100% of collateral is returned to vault
    ///         and auto-restaked into PoolManager, LP retains 100% collateral + 100% premium.
    function test_e2e_call_bearish_OTM_auto_restake_and_lp_profit() public {
        uint256 initialLpWeth = 10e18;
        weth.mint(aliceLp, initialLpWeth);

        vm.startPrank(aliceLp);
        weth.approve(address(vaultWeth), initialLpWeth);
        vaultWeth.deposit(address(weth), initialLpWeth);
        vm.stopPrank();

        // Bob pays premium
        uint256 bobInitialUsdc = 500e18;
        usdc.mint(bobTaker, bobInitialUsdc);
        vm.prank(bobTaker);
        usdc.transfer(aliceLp, CALL_PREMIUM);

        // Extract 2 WETH for CALL option
        vm.prank(lpRouter);
        vaultWeth.extractForMint(address(weth), OPTION_UNITS);

        uint256 expiry = block.timestamp + 1 days;
        E2EPositionAccount position = _createPosition(
            102,
            E2EPositionAccount.OptionType.CALL,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            OPTION_UNITS,
            expiry,
            address(vaultWeth)
        );

        vm.prank(lpRouter);
        weth.transfer(address(position), OPTION_UNITS);

        // Price drops from $2,500 to $2,000 (-20%)
        oracle.setPrice(2000e18, block.timestamp);

        // Bob exercise reverts because option is OTM
        vm.expectRevert(E2EPositionAccount.OptionNotITM.selector);
        position.settleToTakerCall(50);

        // Advance past expiry
        vm.warp(expiry + 10);

        // Settle to LP post-expiry
        uint256 recovered = position.settleToLp();
        assertEq(recovered, OPTION_UNITS, "100% collateral returned to LP on OTM");

        // Post-settlement auto-restake verification:
        assertEq(vaultWeth.pendingAsset(address(weth)), 0, "Auto-restake succeeded");
        assertEq(weth.balanceOf(address(vaultWeth)), 0, "Vault loose balance is 0");

        // PoolManager WETH balance restored to full initial deposit (1,000 baseline + 10 LP)
        assertEq(
            weth.balanceOf(address(poolManager)), BASE_POOL_WETH + initialLpWeth, "100% collateral re-staked in pool"
        );

        // Taker accounting: received 0 payout, net loss = premium paid
        assertEq(usdc.balanceOf(bobTaker), bobInitialUsdc - CALL_PREMIUM, "Bob received 0 payout");
        uint256 bobNetLoss = bobInitialUsdc - usdc.balanceOf(bobTaker);
        assertEq(bobNetLoss, CALL_PREMIUM, "Bob net loss equals 100% of upfront premium");

        // LP accounting: holds full 10 WETH in pool + 150 USDC liquid premium
        assertEq(usdc.balanceOf(aliceLp), CALL_PREMIUM, "Alice retains 100% of upfront premium");
        uint256 lpWealthAtSpot = (initialLpWeth * 2000e18) / 1e18 + usdc.balanceOf(aliceLp);
        assertEq(lpWealthAtSpot, 20150e18, "LP total wealth = 10 WETH ($20,000) + 150 USDC premium");
    }

    /// @notice 4. Test Out-of-The-Money CALL Settlement via settleToLp (Invariant I3 Venue-Free Recovery)
    ///         Proves that when oracle and venue revert, settleToLp still succeeds, post-settlement deposit
    ///         is safely credited to pendingAsset, and manualRestake restores pool liquidity once available.
    function test_e2e_call_bearish_OTM_venue_free_recovery() public {
        uint256 initialLpWeth = 10e18;
        weth.mint(aliceLp, initialLpWeth);

        vm.startPrank(aliceLp);
        weth.approve(address(vaultWeth), initialLpWeth);
        vaultWeth.deposit(address(weth), initialLpWeth);
        vm.stopPrank();

        // Taker pays premium
        usdc.mint(bobTaker, 500e18);
        vm.prank(bobTaker);
        usdc.transfer(aliceLp, CALL_PREMIUM);

        vm.prank(lpRouter);
        vaultWeth.extractForMint(address(weth), OPTION_UNITS);

        uint256 expiry = block.timestamp + 1 days;
        E2EPositionAccount position = _createPosition(
            103,
            E2EPositionAccount.OptionType.CALL,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            OPTION_UNITS,
            expiry,
            address(vaultWeth)
        );

        vm.prank(lpRouter);
        weth.transfer(address(position), OPTION_UNITS);

        // Price Movement: Bearish drop from $2,500 to $2,000 (-20%)
        oracle.setPrice(2000e18, block.timestamp);

        // Advance time past expiry
        vm.warp(expiry + 10);

        // Configure oracle & venue to unconditionally revert to prove Invariant I3:
        // settleToLp operates completely independent of oracle and venue
        oracle.setShouldRevert(true);
        poolManager.setShouldRevert(true);

        // Post-expiry recovery succeeds despite venue and oracle failure
        uint256 recovered = position.settleToLp();
        assertEq(recovered, OPTION_UNITS, "100% collateral returned to LP on OTM");

        // Because PoolManager reverted, auto-restake caught the failure safely (Invariant I3 gas isolation).
        // Proceeds are safely held in vaultWeth and credited to pendingAsset:
        assertEq(
            vaultWeth.pendingAsset(address(weth)), OPTION_UNITS, "Post-settlement deposit credited to pendingAsset"
        );
        assertEq(weth.balanceOf(address(vaultWeth)), OPTION_UNITS, "Vault safely holds the recovered ERC-20");

        // PoolManager becomes available again
        poolManager.setShouldRevert(false);

        // Alice manually restakes the credited pending asset
        vm.prank(aliceLp);
        vaultWeth.manualRestake(address(weth));

        // Post-settlement restake credited into PoolManager
        assertEq(vaultWeth.pendingAsset(address(weth)), 0, "Pending asset cleared after manual restake");
        assertEq(weth.balanceOf(address(vaultWeth)), 0, "Vault loose balance cleared");
        assertEq(
            weth.balanceOf(address(poolManager)), BASE_POOL_WETH + initialLpWeth, "Full collateral re-staked in pool"
        );

        // LP retains 100% collateral + 100% premium
        assertEq(usdc.balanceOf(aliceLp), CALL_PREMIUM, "LP retained upfront premium");
    }

    /// @notice 5. Test In-The-Money PUT Settlement with Accurate Bearish Price Movement (-28%)
    ///         Verifies complete lifecycle: Cash collateral deposit -> Taker pays premium ->
    ///         Extraction to PositionAccount -> Bearish drop -> Taker settles for net profit ->
    ///         Post-settlement cash remainder credited & auto-restaked -> LP net wealth accounted.
    function test_e2e_put_bearish_ITM_accurate_price_movement_accounting() public {
        uint256 putCollateral = 5000e18; // 2 units PUT * $2,500 strike = $5,000 USDC

        // ─── Phase 1: LP Stages Cash Collateral in Uniswap v4 ──────────────────
        usdc.mint(aliceLp, 25_000e18);

        vm.startPrank(aliceLp);
        usdc.approve(address(vaultUsdc), 25_000e18);
        vaultUsdc.deposit(address(usdc), 25_000e18);
        vm.stopPrank();

        assertEq(usdc.balanceOf(aliceLp), 0, "Alice liquid USDC is 0 after deposit");
        assertEq(usdc.balanceOf(address(vaultUsdc)), 0, "Vault loose USDC is 0");
        assertEq(usdc.balanceOf(address(poolManager)), BASE_POOL_USDC + 25_000e18, "PoolManager holds staged cash");

        // ─── Phase 2: Taker Pays Premium & Option Minting ──────────────────────
        usdc.mint(bobTaker, 1000e18);

        // Bob pays PUT_PREMIUM (200 USDC) to Alice (LP)
        vm.prank(bobTaker);
        usdc.transfer(aliceLp, PUT_PREMIUM);

        assertEq(usdc.balanceOf(bobTaker), 800e18, "Bob USDC balance decreased by premium");
        assertEq(usdc.balanceOf(aliceLp), PUT_PREMIUM, "Alice received upfront premium in USDC");

        // Router extracts 5,000 USDC from vault to fund PositionAccount
        vm.prank(lpRouter);
        vaultUsdc.extractForMint(address(usdc), putCollateral);

        // Staged collateral in PoolManager decreased by 5,000 USDC (from 25,000 to 20,000)
        assertEq(usdc.balanceOf(address(poolManager)), BASE_POOL_USDC + 20_000e18);

        E2EPositionAccount position = _createPosition(
            201,
            E2EPositionAccount.OptionType.PUT,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            OPTION_UNITS,
            block.timestamp + 1 days,
            address(vaultUsdc)
        );

        // Router funds PositionAccount with cash collateral
        vm.prank(lpRouter);
        usdc.transfer(address(position), putCollateral);
        assertEq(usdc.balanceOf(address(position)), putCollateral, "PositionAccount holds exact cash collateral");

        // ─── Phase 3 & 4: Bearish Price Movement (-28%) and Settlement ────────
        {
            // Price drops from $2,500 to $1,800 (-28%)
            // Gross = ($2,500 - $1,800) * 2 = $1,400 USDC
            // Fee (1%) = $14 USDC, Net = $1,386 USDC
            // Remainder unspent cash = $5,000 - $1,400 = $3,600 USDC
            oracle.setPrice(1800e18, block.timestamp);

            (uint256 net, uint256 fee) = position.settleToTakerPut();
            assertEq(net, 1386e18, "Put net payout mismatch");
            assertEq(fee, 14e18, "Put protocol fee mismatch");
        }

        // ─── Phase 5: Taker Profit Verification ────────────────────────────────
        {
            // Bob started with 1,000 USDC, paid 200 USDC premium, and received 1,386 USDC payout
            uint256 bobFinalUsdc = usdc.balanceOf(bobTaker);
            assertEq(bobFinalUsdc, 2186e18, "Bob final balance should be exactly 2,186 USDC");

            // Taker Net Profit = 2,186 - 1,000 = +1,186 USDC (1,386 payout - 200 premium)
            uint256 bobNetProfit = bobFinalUsdc - 1000e18;
            assertEq(bobNetProfit, 1186e18, "Bob net profit should be exactly +1,186 USDC");
            assertGt(bobFinalUsdc, 1000e18, "Taker made a net profit on ITM PUT");

            assertEq(usdc.balanceOf(protocolFeeRecipient), 14e18, "Fee recipient balance mismatch");
        }

        // ─── Phase 6: Post-Settlement Deposit Crediting & Auto-Restake ─────────
        {
            // PositionAccount transferred 3,600 USDC remaining unspent collateral to vaultUsdc
            // and called onPositionSettled, which automatically re-staked it into PoolManager.
            assertEq(vaultUsdc.pendingAsset(address(usdc)), 0, "Pending asset is 0 after restake");
            assertEq(usdc.balanceOf(address(vaultUsdc)), 0, "Vault loose USDC is 0 (all restaked)");

            // Staged in PoolManager: Base (1,000,000) + Remaining staged (20,000) + Restaked (3,600) = 1,023,600 USDC
            assertEq(
                usdc.balanceOf(address(poolManager)),
                BASE_POOL_USDC + 23_600e18,
                "PoolManager credited with restaked USDC"
            );
        }

        // ─── Phase 7: LP Position Value & Net Wealth Verification ─────────────
        {
            // LP staged: 23,600 USDC. Liquid cash: 200 USDC. Total = 23,800 USDC.
            // Accounting: Initial (25,000) - Gross Payout (1,400) + Premium (200) = 23,800 USDC!
            uint256 lpTotalWealth = 23_600e18 + usdc.balanceOf(aliceLp);
            assertEq(lpTotalWealth, 23800e18, "LP total wealth exact mathematical match");
        }
    }

    /// @notice 6. Test Out-of-The-Money PUT with Auto-Restake and LP Profit
    ///         Verifies: Taker loses 100% of premium, 100% of cash collateral is returned to vault
    ///         and auto-restaked into PoolManager, LP retains 100% cash collateral + 100% premium.
    function test_e2e_put_bullish_OTM_auto_restake_and_lp_profit() public {
        uint256 putCollateral = (STRIKE_PRICE * OPTION_UNITS) / 1e18; // 5,000 USDC
        uint256 initialLpUsdc = 25_000e18;
        usdc.mint(aliceLp, initialLpUsdc);

        vm.startPrank(aliceLp);
        usdc.approve(address(vaultUsdc), initialLpUsdc);
        vaultUsdc.deposit(address(usdc), initialLpUsdc);
        vm.stopPrank();

        // Bob pays premium
        uint256 bobInitialUsdc = 1000e18;
        usdc.mint(bobTaker, bobInitialUsdc);
        vm.prank(bobTaker);
        usdc.transfer(aliceLp, PUT_PREMIUM);

        // Extract 5,000 USDC for PUT option
        vm.prank(lpRouter);
        vaultUsdc.extractForMint(address(usdc), putCollateral);

        uint256 expiry = block.timestamp + 1 days;
        E2EPositionAccount position = _createPosition(
            202,
            E2EPositionAccount.OptionType.PUT,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            OPTION_UNITS,
            expiry,
            address(vaultUsdc)
        );

        vm.prank(lpRouter);
        usdc.transfer(address(position), putCollateral);

        // Price surges from $2,500 to $3,200 (+28%)
        oracle.setPrice(3200e18, block.timestamp);

        // Bob exercise reverts because PUT is OTM
        vm.expectRevert(E2EPositionAccount.OptionNotITM.selector);
        position.settleToTakerPut();

        // Advance past expiry
        vm.warp(expiry + 10);

        // Settle to LP post-expiry
        uint256 recovered = position.settleToLp();
        assertEq(recovered, putCollateral, "100% cash collateral returned to LP on OTM");

        // Post-settlement auto-restake verification:
        assertEq(vaultUsdc.pendingAsset(address(usdc)), 0, "Auto-restake succeeded");
        assertEq(usdc.balanceOf(address(vaultUsdc)), 0, "Vault loose balance is 0");

        // PoolManager USDC balance restored to full initial deposit
        assertEq(usdc.balanceOf(address(poolManager)), BASE_POOL_USDC + initialLpUsdc, "100% cash collateral re-staked");

        // Taker accounting: received 0 payout, net loss = premium paid
        assertEq(usdc.balanceOf(bobTaker), bobInitialUsdc - PUT_PREMIUM, "Bob received 0 payout");
        uint256 bobNetLoss = bobInitialUsdc - usdc.balanceOf(bobTaker);
        assertEq(bobNetLoss, PUT_PREMIUM, "Bob net loss equals 100% of upfront premium");

        // LP accounting: holds full 25,000 USDC in pool + 200 USDC liquid premium
        assertEq(usdc.balanceOf(aliceLp), PUT_PREMIUM, "Alice retains 100% of upfront premium");
        uint256 lpTotalWealth = initialLpUsdc + usdc.balanceOf(aliceLp);
        assertEq(lpTotalWealth, 25200e18, "LP total wealth = 25,000 USDC collateral + 200 USDC premium");
    }

    /// @notice 7. Test Out-of-The-Money PUT Settlement via settleToLp (Invariant I3 Venue-Free Recovery)
    function test_e2e_put_bullish_OTM_venue_free_recovery() public {
        uint256 putCollateral = (STRIKE_PRICE * OPTION_UNITS) / 1e18; // 5,000 USDC
        uint256 initialLpUsdc = 25_000e18;
        usdc.mint(aliceLp, initialLpUsdc);

        vm.startPrank(aliceLp);
        usdc.approve(address(vaultUsdc), initialLpUsdc);
        vaultUsdc.deposit(address(usdc), initialLpUsdc);
        vm.stopPrank();

        // Taker pays premium
        usdc.mint(bobTaker, 1000e18);
        vm.prank(bobTaker);
        usdc.transfer(aliceLp, PUT_PREMIUM);

        vm.prank(lpRouter);
        vaultUsdc.extractForMint(address(usdc), putCollateral);

        uint256 expiry = block.timestamp + 1 days;
        E2EPositionAccount position = _createPosition(
            203,
            E2EPositionAccount.OptionType.PUT,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            OPTION_UNITS,
            expiry,
            address(vaultUsdc)
        );

        vm.prank(lpRouter);
        usdc.transfer(address(position), putCollateral);

        // Price Movement: Bullish rally from $2,500 to $3,200 (+28%)
        oracle.setPrice(3200e18, block.timestamp);

        // Warp past expiry
        vm.warp(expiry + 10);

        // Oracle & venue failure does NOT block settleToLp
        oracle.setShouldRevert(true);
        poolManager.setShouldRevert(true);

        uint256 recovered = position.settleToLp();
        assertEq(recovered, putCollateral, "100% of PUT cash collateral must be returned to LP on OTM");

        // Recovery succeeded safely, proceeds safely credited to pendingAsset:
        assertEq(
            vaultUsdc.pendingAsset(address(usdc)), putCollateral, "Post-settlement deposit credited to pendingAsset"
        );
        assertEq(usdc.balanceOf(address(vaultUsdc)), putCollateral, "Vault holds recovered USDC");

        // PoolManager unblocked
        poolManager.setShouldRevert(false);

        // Alice manually restakes
        vm.prank(aliceLp);
        vaultUsdc.manualRestake(address(usdc));

        assertEq(vaultUsdc.pendingAsset(address(usdc)), 0, "Pending asset cleared after manual restake");
        assertEq(usdc.balanceOf(address(vaultUsdc)), 0, "Vault loose balance cleared");
        assertEq(usdc.balanceOf(address(poolManager)), BASE_POOL_USDC + initialLpUsdc, "Full cash collateral re-staked");

        assertEq(usdc.balanceOf(aliceLp), PUT_PREMIUM, "LP retained upfront premium");
    }

    /// @notice 8. Test ATM Boundary Condition (Spot Price exactly equals Strike Price)
    function test_e2e_atm_exact_boundary_condition() public {
        uint256 initialLpWeth = 10e18;
        weth.mint(aliceLp, initialLpWeth);

        vm.startPrank(aliceLp);
        weth.approve(address(vaultWeth), initialLpWeth);
        vaultWeth.deposit(address(weth), initialLpWeth);
        vm.stopPrank();

        // Taker pays premium
        usdc.mint(bobTaker, 500e18);
        vm.prank(bobTaker);
        usdc.transfer(aliceLp, CALL_PREMIUM);

        vm.prank(lpRouter);
        vaultWeth.extractForMint(address(weth), OPTION_UNITS);

        uint256 expiry = block.timestamp + 1 days;
        E2EPositionAccount position = _createPosition(
            301,
            E2EPositionAccount.OptionType.CALL,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            OPTION_UNITS,
            expiry,
            address(vaultWeth)
        );

        vm.prank(lpRouter);
        weth.transfer(address(position), OPTION_UNITS);

        // Spot price strictly equals strike price ($2,500)
        oracle.setPrice(STRIKE_PRICE, block.timestamp);

        // Taker exercise reverts because CALL requires spot > strike
        vm.expectRevert(E2EPositionAccount.OptionNotITM.selector);
        position.settleToTakerCall(50);

        // Expiry recovery
        vm.warp(expiry + 1);
        uint256 recovered = position.settleToLp();
        assertEq(recovered, OPTION_UNITS);

        // Collateral credited and auto-restaked
        assertEq(vaultWeth.pendingAsset(address(weth)), 0);
        assertEq(weth.balanceOf(address(poolManager)), BASE_POOL_WETH + initialLpWeth);

        // Taker loses premium, LP keeps premium + 100% collateral
        assertEq(usdc.balanceOf(bobTaker), 500e18 - CALL_PREMIUM);
        assertEq(usdc.balanceOf(aliceLp), CALL_PREMIUM);
    }

    /// @notice 9. Test Extreme Volatility Accounting (+400% Pump and -90% Crash)
    function test_e2e_extreme_volatility_price_movements() public {
        // Scenario A: 5x Extreme Pump ($2,500 -> $12,500)
        {
            uint256 initialLpWeth = 10e18;
            weth.mint(aliceLp, initialLpWeth);

            vm.startPrank(aliceLp);
            weth.approve(address(vaultWeth), initialLpWeth);
            vaultWeth.deposit(address(weth), initialLpWeth);
            vm.stopPrank();

            // Bob pays premium
            uint256 bobInitial = 500e18;
            usdc.mint(bobTaker, bobInitial);
            vm.prank(bobTaker);
            usdc.transfer(aliceLp, CALL_PREMIUM);

            vm.prank(lpRouter);
            vaultWeth.extractForMint(address(weth), OPTION_UNITS);

            uint256 expiry = block.timestamp + 1 days;
            E2EPositionAccount callPos = _createPosition(
                401,
                E2EPositionAccount.OptionType.CALL,
                address(weth),
                address(usdc),
                STRIKE_PRICE,
                OPTION_UNITS,
                expiry,
                address(vaultWeth)
            );

            vm.prank(lpRouter);
            weth.transfer(address(callPos), OPTION_UNITS);

            oracle.setPrice(12500e18, block.timestamp); // +400%
            uint256 gross = (10000e18 * OPTION_UNITS) / 1e18; // $20,000 USDC
            poolManager.setMockAmountOut(gross);

            (uint256 net, uint256 fee) = callPos.settleToTakerCall(50);
            assertEq(fee, 200e18, "Protocol fee is exactly 1% of $20,000 = $200");
            assertEq(net, 19800e18, "Taker net is exactly $19,800");

            // Taker Net Profit: $19,800 - $150 = +$19,650 USDC
            uint256 takerProfit = usdc.balanceOf(bobTaker) - bobInitial;
            assertEq(takerProfit, 19650e18, "Taker net profit mismatch");
            assertGt(takerProfit, 0);

            // Collateral consumed at spot $12,500: $20,000 / $12,500 = 1.6 WETH
            // Remainder unspent collateral = 2 - 1.6 = 0.4 WETH auto-restaked into PoolManager
            assertEq(vaultWeth.pendingAsset(address(weth)), 0);
            assertEq(weth.balanceOf(address(vaultWeth)), 0);
            // PoolManager holds: Base (1,000) + Remaining staged (8) + Swapped (1.6) + Restaked (0.4) = 1,010 WETH
            assertEq(weth.balanceOf(address(poolManager)), BASE_POOL_WETH + 10e18);
            assertEq(usdc.balanceOf(address(poolManager)), BASE_POOL_USDC - 20000e18);
        }

        // Scenario B: 90% Extreme Crash ($2,500 -> $250)
        {
            uint256 putCollateral = (STRIKE_PRICE * OPTION_UNITS) / 1e18; // $5,000 USDC
            uint256 initialLpUsdc = 25_000e18;
            usdc.mint(aliceLp, initialLpUsdc);

            vm.startPrank(aliceLp);
            usdc.approve(address(vaultUsdc), initialLpUsdc);
            vaultUsdc.deposit(address(usdc), initialLpUsdc);
            vm.stopPrank();

            // Bob pays premium
            uint256 bobPrior = usdc.balanceOf(bobTaker);
            uint256 bobInitial = 1000e18;
            usdc.mint(bobTaker, bobInitial);
            vm.prank(bobTaker);
            usdc.transfer(aliceLp, PUT_PREMIUM);

            vm.prank(lpRouter);
            vaultUsdc.extractForMint(address(usdc), putCollateral);

            uint256 expiry = block.timestamp + 1 days;
            E2EPositionAccount putPos = _createPosition(
                402,
                E2EPositionAccount.OptionType.PUT,
                address(weth),
                address(usdc),
                STRIKE_PRICE,
                OPTION_UNITS,
                expiry,
                address(vaultUsdc)
            );

            vm.prank(lpRouter);
            usdc.transfer(address(putPos), putCollateral);

            oracle.setPrice(250e18, block.timestamp); // -90%
            // Gross = ($2,500 - $250) * 2 = $4,500 USDC
            uint256 expectedGross = 4500e18;
            uint256 expectedFee = 45e18;
            uint256 expectedNet = 4455e18;
            assertEq(expectedNet + expectedFee, expectedGross, "Net plus fee must match gross payout");

            (uint256 net, uint256 fee) = putPos.settleToTakerPut();
            assertEq(fee, expectedFee);
            assertEq(net, expectedNet);

            // Taker Net Profit: $4,455 - $200 = +$4,255 USDC
            uint256 takerProfit = usdc.balanceOf(bobTaker) - (bobPrior + bobInitial);
            assertEq(takerProfit, 4255e18, "Put taker profit mismatch");
            assertGt(takerProfit, 0);

            // Remainder unspent cash collateral = $5,000 - $4,500 = $500 USDC auto-restaked
            assertEq(vaultUsdc.pendingAsset(address(usdc)), 0);
            assertEq(usdc.balanceOf(address(vaultUsdc)), 0);
            // PoolManager holds: Base (1,000,000) - Scenario A swap (20,000) + Remaining staged (20,000) + Restaked (500) = 1,000,500 USDC
            assertEq(usdc.balanceOf(address(poolManager)), BASE_POOL_USDC + 500e18);
        }
    }

    /// @notice 10. Test Post-Settlement Restake Failure Fallback and Recovery
    ///         Verifies that if automated re-staking fails (e.g. pool pause or temporary lock),
    ///         the post-settlement deposit is safely credited to pendingAsset, and the LP can
    ///         either manually restake or withdraw directly to their wallet without loss of funds.
    function test_e2e_post_settlement_restake_failure_fallback_and_manual_recovery() public {
        // Setup: LP deposits 10 WETH
        uint256 initialLpWeth = 10e18;
        weth.mint(aliceLp, initialLpWeth);

        vm.startPrank(aliceLp);
        weth.approve(address(vaultWeth), initialLpWeth);
        vaultWeth.deposit(address(weth), initialLpWeth);
        vm.stopPrank();

        // Extract 2 WETH for CALL option
        vm.prank(lpRouter);
        vaultWeth.extractForMint(address(weth), OPTION_UNITS);

        uint256 expiry = block.timestamp + 1 days;
        E2EPositionAccount position = _createPosition(
            501,
            E2EPositionAccount.OptionType.CALL,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            OPTION_UNITS,
            expiry,
            address(vaultWeth)
        );

        vm.prank(lpRouter);
        weth.transfer(address(position), OPTION_UNITS);

        // Option expires OTM
        oracle.setPrice(2000e18, block.timestamp);
        vm.warp(expiry + 10);

        // Simulate PoolManager temporary unavailability during settlement
        poolManager.setShouldRevert(true);

        // Settle option to LP: does NOT revert (Invariant I3 gas isolation)
        position.settleToLp();

        // Post-settlement deposit credited to pendingAsset:
        assertEq(
            vaultWeth.pendingAsset(address(weth)), OPTION_UNITS, "Post-settlement deposit credited to pendingAsset"
        );
        assertEq(weth.balanceOf(address(vaultWeth)), OPTION_UNITS, "Vault holds credited ERC-20 safely");

        // Scenario A: Pool recovers -> LP manually restakes
        poolManager.setShouldRevert(false);
        vm.prank(aliceLp);
        vaultWeth.manualRestake(address(weth));

        assertEq(vaultWeth.pendingAsset(address(weth)), 0, "Pending asset cleared after manual restake");
        assertEq(weth.balanceOf(address(vaultWeth)), 0, "Vault loose balance cleared");
        assertEq(
            weth.balanceOf(address(poolManager)), BASE_POOL_WETH + initialLpWeth, "Restaked into pool successfully"
        );

        // Scenario B: LP can also withdraw directly to wallet if desired
        // Simulate extracting 1 WETH and having it fail to restake
        vm.prank(lpRouter);
        vaultWeth.extractForMint(address(weth), 1e18);

        // Position settles 1 WETH back while poolManager is down
        poolManager.setShouldRevert(true);
        E2EPositionAccount position2 = _createPosition(
            502,
            E2EPositionAccount.OptionType.CALL,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            1e18,
            expiry + 1 days,
            address(vaultWeth)
        );
        vm.prank(lpRouter);
        weth.transfer(address(position2), 1e18);

        vm.warp(expiry + 1 days + 10);
        position2.settleToLp();

        assertEq(vaultWeth.pendingAsset(address(weth)), 1e18, "1 WETH credited to pendingAsset");

        // Owner decides to withdraw un-staked funds directly to wallet instead of restaking
        // First, withdraw removes 1 WETH from pool if available, but here the funds are already loose ERC-20
        // Owner calls withdraw once pool is unblocked or directly accesses pending funds via manualRestake then withdraw
        poolManager.setShouldRevert(false);
        vm.prank(aliceLp);
        vaultWeth.manualRestake(address(weth));
        assertEq(vaultWeth.pendingAsset(address(weth)), 0);

        // Owner withdraws 1 WETH to wallet
        vm.prank(aliceLp);
        vaultWeth.withdraw(address(weth), 1e18);
        assertEq(weth.balanceOf(aliceLp), 1e18, "LP withdrew 1 WETH directly to wallet");
    }

    /// @notice Verifies Pillar III In-Kind Fallback: when a settlement swap fails on the canonical pool,
    ///         the position automatically disburses oracle-priced equivalent of underlying collateral asset.
    function test_e2e_call_ITM_swap_failure_executes_in_kind_fallback() public {
        // 1. LP provides 10 WETH to vault
        weth.mint(aliceLp, 10e18);
        vm.prank(aliceLp);
        weth.approve(address(vaultWeth), 10e18);
        vm.prank(aliceLp);
        vaultWeth.deposit(address(weth), 10e18);

        // 2. Mint 1-unit CALL option struck at $2500, expiry 1 day later
        uint256 expiry = block.timestamp + 1 days;
        E2EPositionAccount position = _createPosition(
            999,
            E2EPositionAccount.OptionType.CALL,
            address(weth),
            address(usdc),
            STRIKE_PRICE,
            1e18, // 1 WETH unit
            expiry,
            address(vaultWeth)
        );

        // Collateral pulled from LP vault to position account
        vm.prank(lpRouter);
        vaultWeth.extractForMint(address(weth), 1e18);
        vm.prank(lpRouter);
        weth.transfer(address(position), 1e18);

        // 3. Price moves up: ETH hits $3000 (ITM by $500)
        oracle.setPrice(3000e18, block.timestamp);

        // Make poolManager swap revert to simulate pool illiquidity or excessive slippage
        poolManager.setShouldRevert(true);

        uint256 bobWethBefore = weth.balanceOf(bobTaker);
        uint256 feeWethBefore = weth.balanceOf(protocolFeeRecipient);

        // 4. Settle CALL option -> swap fails -> in-kind fallback executes!
        (uint256 netPayout, uint256 fee) = position.settleToTakerCall(50); // 0.5% slippage tolerance

        // Verification:
        // grossPayout = ($3000 - $2500) * 1 = 500 USDC
        // collateralNeeded = (500e18 * 1e18) / 3000e18 = 0.166666666666666666 WETH
        // fee = (collateralNeeded * 100 + 9999) / 10000
        // netPayout = collateralNeeded - fee
        uint256 expectedCollateralNeeded = (uint256(500e18) * 1e18) / 3000e18;
        uint256 expectedFee = (expectedCollateralNeeded * 100 + 9999) / 10000;
        uint256 expectedNet = expectedCollateralNeeded - expectedFee;

        assertEq(netPayout, expectedNet, "In-kind net payout matches formula");
        assertEq(fee, expectedFee, "In-kind fee matches 1% rounded up");

        assertEq(weth.balanceOf(bobTaker) - bobWethBefore, expectedNet, "Bob received in-kind WETH");
        assertEq(
            weth.balanceOf(protocolFeeRecipient) - feeWethBefore, expectedFee, "Fee recipient received in-kind WETH"
        );

        // Remaining collateral (1 WETH - expectedCollateralNeeded) returned to vault
        uint256 expectedRemaining = 1e18 - expectedCollateralNeeded;
        assertEq(weth.balanceOf(address(position)), 0, "Position holds zero balance");
        // Because poolManager was reverting, auto-restake accumulates in pendingAsset
        assertEq(
            vaultWeth.pendingAsset(address(weth)),
            expectedRemaining,
            "Unspent collateral returned to LP vault pendingAsset"
        );
        assertTrue(position.settled(), "Position is marked settled");
    }
}
