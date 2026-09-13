// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Milestone 7 — LP Router (MASTER_ARCHITECTURE.md §3.9, Q7 in DECISIONS.md). Real
// end-to-end tests through the real PositionManager/PositionAccount/AuthzModule/
// ConditionArbiter/conditions stack plus the new LPRouter — no stubs standing in for
// anything with a real implementation.
//
// via-IR TIMESTAMP note (foundry.toml): every timestamp is read via vm.getBlockTimestamp()
// immediately before use, never cached across a vm.warp.

import {Test, console2} from "forge-std/Test.sol";

import {ERC6551Registry} from "erc6551-reference/ERC6551Registry.sol";

import {PositionManager} from "../../src/PositionManager.sol";
import {PositionAccount} from "../../src/PositionAccount.sol";
import {AuthzModule} from "../../src/AuthzModule.sol";
import {ConditionArbiter} from "../../src/ConditionArbiter.sol";
import {TakerProfitCondition} from "../../src/conditions/TakerProfitCondition.sol";
import {LPRouter} from "../../src/periphery/LPRouter.sol";

import {Economics} from "../../src/types/Economics.sol";
import {Pointers} from "../../src/types/Pointers.sol";
import {ActionContext} from "../../src/types/ActionContext.sol";
import {ActionKind} from "../../src/types/ActionKind.sol";
import {SlotApproval} from "../../src/types/SlotApproval.sol";
import {SettleToTakerParams} from "../../src/types/ActionParams.sol";
import {TermsLib} from "../../src/libraries/TermsLib.sol";
import {DigestLib} from "../../src/libraries/DigestLib.sol";
import {BackerQuoteLib} from "../../src/libraries/BackerQuoteLib.sol";
import {ILPRouter} from "../../src/interfaces/ILPRouter.sol";
import {IPositionAccount} from "../../src/interfaces/IPositionAccount.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPriceOracle} from "./mocks/MockPriceOracle.sol";
import {MockSettlementVenue} from "./mocks/MockSettlementVenue.sol";

contract LPRouterTest is Test {
    PositionManager internal manager;
    PositionAccount internal impl;
    ConditionArbiter internal conditionArbiter;
    TakerProfitCondition internal takerCond;
    LPRouter internal router;

    MockERC20 internal collateral;
    MockERC20 internal settlement;
    MockPriceOracle internal oracle;
    MockSettlementVenue internal venue;

    address internal feeVault = makeAddr("feeVault");
    uint256 internal takerPk = 0xB0B;
    address internal taker;

    address internal backerA;
    uint256 internal backerAPk;
    address internal backerB;
    uint256 internal backerBPk;
    address internal backerC;
    uint256 internal backerCPk;

    /// @notice Deploys the real Milestone 1-4 stack plus the router under test.
    function setUp() public {
        vm.warp(1_800_000_000);
        taker = vm.addr(takerPk);
        (backerA, backerAPk) = makeAddrAndKey("backerA");
        (backerB, backerBPk) = makeAddrAndKey("backerB");
        (backerC, backerCPk) = makeAddrAndKey("backerC");

        ERC6551Registry canonicalImpl = new ERC6551Registry();
        vm.etch(TermsLib.REGISTRY, address(canonicalImpl).code);

        conditionArbiter = new ConditionArbiter();
        takerCond = new TakerProfitCondition();
        impl = new PositionAccount(new AuthzModule(), feeVault);
        manager = new PositionManager(address(impl));
        router = new LPRouter(address(manager));

        collateral = new MockERC20("Tokenized Stock (test fixture)", "TSTOCK-TF", 18);
        settlement = new MockERC20("Settlement USD (test fixture)", "SUSD-TF", 6);
        oracle = new MockPriceOracle(uint32(1 hours));
        oracle.setPrice(100e18, vm.getBlockTimestamp());
        venue = new MockSettlementVenue();
        collateral.mint(address(venue), 1_000_000e18);
        settlement.mint(address(venue), 1_000_000e6);
        venue.setRate(100e6, 1e18);

        collateral.mint(backerA, 1_000e18);
        collateral.mint(backerB, 1_000e18);
        collateral.mint(backerC, 1_000e18);
        vm.prank(backerA);
        collateral.approve(address(router), type(uint256).max);
        vm.prank(backerB);
        collateral.approve(address(router), type(uint256).max);
        vm.prank(backerC);
        collateral.approve(address(router), type(uint256).max);

        settlement.mint(taker, 1_000_000e6);
        vm.prank(taker);
        settlement.approve(address(router), type(uint256).max);
    }

    /// @dev Builds one backer's signed quote (DECISIONS.md Q7 addendum) — shared terms
    ///      match exactly what `_match` passes as `matchAndMint`'s top-level parameters, so
    ///      `QuoteTermsMismatch` never fires in these tests unless a test deliberately wants
    ///      it to.
    function _quote(address backer, uint256 maxUnits, uint256 rate, uint256 nonce)
        internal
        view
        returns (ILPRouter.BackerQuote memory q)
    {
        q = ILPRouter.BackerQuote({
            backer: backer,
            collateralAsset: address(collateral),
            settlementAsset: address(settlement),
            minHours: 1,
            maxHours: 720,
            maxUnits: maxUnits,
            pricePerUnitPerHour: rate,
            supportsOptionType: 2,
            unitScalarNum: 1,
            unitScalarDen: 1,
            oracle: address(oracle),
            venue: address(venue),
            arbiter: address(conditionArbiter),
            condition: address(takerCond),
            routeId: bytes32(0),
            maxPriceAge: 1 hours,
            slippageBps: 100,
            nonce: nonce
        });
    }

    function _signQuote(ILPRouter.BackerQuote memory q, uint256 pk) internal view returns (bytes memory) {
        bytes32 digest = BackerQuoteLib.digest(q, address(router));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _allocation(address backer, uint256 pk, uint256 maxUnits, uint256 units, uint256 rate, uint256 nonce)
        internal
        view
        returns (ILPRouter.BackerAllocation memory)
    {
        ILPRouter.BackerQuote memory q = _quote(backer, maxUnits, rate, nonce);
        return ILPRouter.BackerAllocation({quote: q, units: units, signature: _signQuote(q, pk)});
    }

    function _allocations() internal view returns (ILPRouter.BackerAllocation[] memory a) {
        a = new ILPRouter.BackerAllocation[](3);
        a[0] = _allocation(backerA, backerAPk, 5, 5, 1e5, 1);
        a[1] = _allocation(backerB, backerBPk, 3, 3, 2e5, 1);
        a[2] = _allocation(backerC, backerCPk, 2, 2, 3e5, 1);
    }

    function _match(ILPRouter.BackerAllocation[] memory allocations, uint16 durationHours, uint8 optionType)
        internal
        returns (uint256 positionId, address account)
    {
        vm.prank(taker);
        (positionId, account) = router.matchAndMint(
            allocations,
            address(collateral),
            address(settlement),
            1,
            1,
            address(oracle),
            address(venue),
            address(conditionArbiter),
            address(takerCond),
            bytes32(0),
            1 hours,
            100,
            durationHours,
            optionType,
            false
        );
    }

    // ---------------------------------------------------------------------
    // matchAndMint: pulls from every backer, mints to the real taker, not the router
    // ---------------------------------------------------------------------

    /// @notice Pulls each backer's exact contribution and mints the NFT to the real taker.
    function test_matchAndMint_pullsFromEachBacker_mintsToRealTaker() public {
        uint256 aBefore = collateral.balanceOf(backerA);
        uint256 bBefore = collateral.balanceOf(backerB);
        uint256 cBefore = collateral.balanceOf(backerC);

        (uint256 positionId, address account) = _match(_allocations(), 24, 0);

        assertEq(manager.ownerOf(positionId), taker, "the real taker, not the router, must own the minted NFT");
        assertEq(aBefore - collateral.balanceOf(backerA), 5e18, "backerA's exact 5-unit contribution");
        assertEq(bBefore - collateral.balanceOf(backerB), 3e18, "backerB's exact 3-unit contribution");
        assertEq(cBefore - collateral.balanceOf(backerC), 2e18, "backerC's exact 2-unit contribution");

        (uint256 recordedCollateral,) = PositionAccount(payable(account)).realized();
        assertEq(recordedCollateral, 10e18, "the account records the combined 10-unit total");
    }

    /// @notice The public backer-breakdown getter reflects exactly what was pulled from each
    ///         backer — what the companion app's account inspector needs (§8 item 4).
    function test_backerAllocationsOf_reflectsExactContributions() public {
        (uint256 positionId,) = _match(_allocations(), 24, 0);

        (address[] memory backers, uint256[] memory contributed) = router.backerAllocationsOf(positionId);
        assertEq(backers.length, 3);
        assertEq(backers[0], backerA);
        assertEq(contributed[0], 5e18);
        assertEq(backers[1], backerB);
        assertEq(contributed[1], 3e18);
        assertEq(backers[2], backerC);
        assertEq(contributed[2], 2e18);
    }

    /// @notice I2 must hold for a router-backed position exactly as for a solo-LP one.
    function test_matchAndMint_addressRederivation_holds() public {
        (uint256 positionId, address account) = _match(_allocations(), 24, 0);

        Economics memory econ;
        econ.lp = address(router);
        econ.collateralAsset = address(collateral);
        econ.collateralDecimals = 18;
        econ.settlementAsset = address(settlement);
        econ.settlementDecimals = 6;
        econ.optionType = 0;
        econ.units = 10;
        econ.unitScalarNum = 1;
        econ.unitScalarDen = 1;
        econ.entryPrice = 100e18;
        econ.expiry = uint64(1_800_000_000 + 24 hours);
        econ.feeBps = manager.FEE_BPS();

        Pointers memory ptrs;
        ptrs.oracle = address(oracle);
        ptrs.venue = address(venue);
        ptrs.arbiter = address(conditionArbiter);
        ptrs.condition = address(takerCond);
        ptrs.routeId = bytes32(0);
        ptrs.maxPriceAge = 1 hours;
        ptrs.slippageBps = 100;

        address derived = TermsLib.deriveAccount(address(impl), econ, ptrs, block.chainid, address(manager), positionId);
        assertEq(derived, account, "recorded terms must re-derive the real account");
    }

    // ---------------------------------------------------------------------
    // Premium: split by each backer's OWN quoted rate, never blended
    // ---------------------------------------------------------------------

    /// @notice Each backer's premium entitlement reflects their own quoted rate, not a blend.
    function test_matchAndMint_creditsPremiumProportionalToEachBackersOwnRate() public {
        _match(_allocations(), 24, 0);

        // backerA: 5 units * 24h * 1e5 = 12_000_000; backerB: 3*24*2e5=14_400_000;
        // backerC: 2*24*3e5=14_400_000. Weighted-avg rate = floor(sum(units*rate)/totalUnits)
        // = floor((5*1e5+3*2e5+2*3e5)/10) = floor(1_700_000/10) = 170_000.
        // Actual premium charged = totalUnits*durationHours*rate = 10*24*170_000 = 40_800_000.
        // Distributed proportional to each backer's own units*rate weight (sum=1_700_000):
        // backerA: 40_800_000 * 500_000/1_700_000 = 12_000_000
        // backerB: 40_800_000 * 600_000/1_700_000 = 14_400_000
        // backerC: remainder = 40_800_000 - 12_000_000 - 14_400_000 = 14_400_000
        assertEq(router.claimable(backerA, address(settlement)), 12_000_000, "backerA's exact entitlement");
        assertEq(router.claimable(backerB, address(settlement)), 14_400_000, "backerB's exact entitlement");
        assertEq(router.claimable(backerC, address(settlement)), 14_400_000, "backerC's exact entitlement");
    }

    /// @notice A backer can pull their accumulated claimable balance out at any time.
    function test_withdraw_paysOutClaimableBalance() public {
        _match(_allocations(), 24, 0);

        uint256 before = settlement.balanceOf(backerA);
        vm.prank(backerA);
        router.withdraw(address(settlement));
        assertEq(settlement.balanceOf(backerA) - before, 12_000_000);
        assertEq(router.claimable(backerA, address(settlement)), 0);
    }

    // ---------------------------------------------------------------------
    // Signed BackerQuote enforcement (DECISIONS.md Q7 addendum) — proves the exploit an
    // earlier, unsigned version of BackerAllocation allowed is now actually closed, not
    // just documented as closed.
    // ---------------------------------------------------------------------

    /// @notice The exploit this fix closes: a caller cannot present a backer's real,
    ///         signed quote and then substitute a different (lower) rate before submitting
    ///         it — the tampered quote hashes differently, so the original signature no
    ///         longer matches it.
    function test_matchAndMint_revertsWhenCallerTampersWithSignedRate() public {
        ILPRouter.BackerAllocation[] memory a = _allocations();
        // backerA genuinely signed a[0] at rate 1e5 — a malicious taker tries to reuse that
        // exact signature against a self-serving lower rate instead.
        a[0].quote.pricePerUnitPerHour = 1; // was 1e5
        vm.prank(taker);
        vm.expectRevert(ILPRouter.InvalidQuoteSignature.selector);
        router.matchAndMint(
            a, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
    }

    /// @notice A signature from the wrong key is rejected outright.
    function test_matchAndMint_revertsWithInvalidQuoteSignature() public {
        ILPRouter.BackerQuote memory q = _quote(backerA, 5, 1e5, 1);
        // Signed by backerB's key, claiming to be backerA's quote.
        bytes memory wrongSignature = _signQuote(q, backerBPk);
        ILPRouter.BackerAllocation[] memory a = new ILPRouter.BackerAllocation[](1);
        a[0] = ILPRouter.BackerAllocation({quote: q, units: 5, signature: wrongSignature});

        vm.prank(taker);
        vm.expectRevert(ILPRouter.InvalidQuoteSignature.selector);
        router.matchAndMint(
            a, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
    }

    /// @notice Drawing more units than a quote's own `maxUnits` is rejected.
    function test_matchAndMint_revertsWhenExceedingQuoteCapacity() public {
        ILPRouter.BackerAllocation memory a = _allocation(backerA, backerAPk, 5, 6, 1e5, 1); // 6 > maxUnits 5
        ILPRouter.BackerAllocation[] memory arr = new ILPRouter.BackerAllocation[](1);
        arr[0] = a;

        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(ILPRouter.QuoteCapacityExceeded.selector, 0, 6, 5));
        router.matchAndMint(
            arr, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
    }

    /// @notice The same quote can be drawn against across multiple matches as long as
    ///         cumulative units stay within its `maxUnits` — `consumedUnitsForQuote` must
    ///         actually persist and accumulate, not reset per call.
    function test_matchAndMint_sameQuoteReusableAcrossMatches_withinCapacity() public {
        ILPRouter.BackerQuote memory q = _quote(backerA, 5, 1e5, 7);
        bytes memory sig = _signQuote(q, backerAPk);

        ILPRouter.BackerAllocation[] memory first = new ILPRouter.BackerAllocation[](1);
        first[0] = ILPRouter.BackerAllocation({quote: q, units: 3, signature: sig});
        vm.prank(taker);
        router.matchAndMint(
            first, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
        bytes32 quoteHash = BackerQuoteLib.digest(q, address(router));
        assertEq(router.consumedUnitsForQuote(quoteHash), 3);

        // 2 more units is exactly the remaining capacity (5 - 3) — must succeed.
        ILPRouter.BackerAllocation[] memory second = new ILPRouter.BackerAllocation[](1);
        second[0] = ILPRouter.BackerAllocation({quote: q, units: 2, signature: sig});
        vm.prank(taker);
        router.matchAndMint(
            second, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
        assertEq(router.consumedUnitsForQuote(quoteHash), 5);

        // One more unit now exceeds the quote's total capacity across both matches.
        ILPRouter.BackerAllocation[] memory third = new ILPRouter.BackerAllocation[](1);
        third[0] = ILPRouter.BackerAllocation({quote: q, units: 1, signature: sig});
        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(ILPRouter.QuoteCapacityExceeded.selector, 5, 1, 5));
        router.matchAndMint(
            third, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
    }

    /// @notice `durationHours` outside a quote's own `[minHours, maxHours]` is rejected.
    function test_matchAndMint_revertsOnDurationOutOfQuoteBounds() public {
        ILPRouter.BackerQuote memory q = _quote(backerA, 5, 1e5, 8);
        q.maxHours = 10; // narrower than this call's 24h request
        bytes memory sig = _signQuote(q, backerAPk);
        ILPRouter.BackerAllocation[] memory a = new ILPRouter.BackerAllocation[](1);
        a[0] = ILPRouter.BackerAllocation({quote: q, units: 5, signature: sig});

        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(ILPRouter.QuoteDurationOutOfBounds.selector, 1, 10, 24));
        router.matchAndMint(
            a, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
    }

    /// @notice An `optionType` a quote's `supportsOptionType` doesn't cover is rejected.
    function test_matchAndMint_revertsOnUnsupportedOptionType() public {
        ILPRouter.BackerQuote memory q = _quote(backerA, 5, 1e5, 9);
        q.supportsOptionType = 0; // CALL only
        bytes memory sig = _signQuote(q, backerAPk);
        ILPRouter.BackerAllocation[] memory a = new ILPRouter.BackerAllocation[](1);
        a[0] = ILPRouter.BackerAllocation({quote: q, units: 5, signature: sig});

        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(ILPRouter.QuoteOptionTypeNotSupported.selector, 0, 1));
        router.matchAndMint(
            a, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 1 /* PUT */, false
        );
    }

    /// @notice A quote committing to different module wiring than this call's shared
    ///         parameters is rejected — a caller cannot redirect a backer's capital to
    ///         terms that backer never signed onto.
    function test_matchAndMint_revertsOnQuoteTermsMismatch() public {
        ILPRouter.BackerQuote memory q = _quote(backerA, 5, 1e5, 10);
        q.unitScalarDen = 2; // does not match this call's shared unitScalarDen (1)
        bytes memory sig = _signQuote(q, backerAPk);
        ILPRouter.BackerAllocation[] memory a = new ILPRouter.BackerAllocation[](1);
        a[0] = ILPRouter.BackerAllocation({quote: q, units: 5, signature: sig});

        vm.prank(taker);
        vm.expectRevert(ILPRouter.QuoteTermsMismatch.selector);
        router.matchAndMint(
            a, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
    }

    // ---------------------------------------------------------------------
    // Bounds
    // ---------------------------------------------------------------------

    /// @notice An empty allocation list is rejected outright.
    function test_matchAndMint_revertsWithNoBackers() public {
        ILPRouter.BackerAllocation[] memory empty = new ILPRouter.BackerAllocation[](0);
        vm.prank(taker);
        vm.expectRevert(ILPRouter.NoBackers.selector);
        router.matchAndMint(
            empty, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
    }

    /// @notice More than `MAX_BACKERS` backers is rejected outright.
    function test_matchAndMint_revertsWithTooManyBackers() public {
        // The length check reverts before any per-allocation quote/signature verification,
        // so these entries never need to be real/signed — empty placeholders are enough.
        ILPRouter.BackerAllocation[] memory nine = new ILPRouter.BackerAllocation[](9);
        for (uint256 i = 0; i < 9; i++) {
            ILPRouter.BackerQuote memory q;
            nine[i] = ILPRouter.BackerAllocation({quote: q, units: 1, signature: bytes("")});
        }
        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(ILPRouter.TooManyBackers.selector, 9, router.MAX_BACKERS()));
        router.matchAndMint(
            nine, address(collateral), address(settlement), 1, 1, address(oracle), address(venue),
            address(conditionArbiter), address(takerCond), bytes32(0), 1 hours, 100, 24, 0, false
        );
    }

    // ---------------------------------------------------------------------
    // Settlement: the standard taker+arbiter path needs no router involvement at all
    // ---------------------------------------------------------------------

    /// @notice The standard taker+arbiter path settles with zero router signature involved;
    ///         `settleAndCredit` still correctly attributes the LP-side remainder to backers.
    function test_settleToTaker_viaArbiter_needsNoRouterSignature_andCreditsBackersByContribution() public {
        (uint256 positionId, address account) = _match(_allocations(), 24, 0);

        oracle.setPrice(125e18, vm.getBlockTimestamp());
        venue.setRate(125e6, 1e18);

        Economics memory econ;
        econ.lp = address(router);
        econ.collateralAsset = address(collateral);
        econ.collateralDecimals = 18;
        econ.settlementAsset = address(settlement);
        econ.settlementDecimals = 6;
        econ.optionType = 0;
        econ.units = 10;
        econ.unitScalarNum = 1;
        econ.unitScalarDen = 1;
        econ.entryPrice = 100e18;
        econ.expiry = uint64(1_800_000_000 + 24 hours);
        econ.feeBps = manager.FEE_BPS();

        Pointers memory ptrs;
        ptrs.oracle = address(oracle);
        ptrs.venue = address(venue);
        ptrs.arbiter = address(conditionArbiter);
        ptrs.condition = address(takerCond);
        ptrs.routeId = bytes32(0);
        ptrs.maxPriceAge = 1 hours;
        ptrs.slippageBps = 100;

        SettleToTakerParams memory p = SettleToTakerParams({
            exitPrice: 125e18,
            minAmountOut: 0,
            minPayoutToTaker: 0,
            swapDeadline: vm.getBlockTimestamp() + 1 hours
        });

        ActionContext memory ctx;
        ctx.account = account;
        ctx.implementation = address(impl);
        ctx.homeChainId = block.chainid;
        ctx.positionManager = address(manager);
        ctx.positionId = positionId;
        ctx.accountState = PositionAccount(payable(account)).state();
        ctx.signerEpoch = manager.signerEpochOf(positionId);
        ctx.actionKind = ActionKind.SettleToTaker;
        ctx.params = abi.encode(p);
        ctx.deadline = vm.getBlockTimestamp() + 1 hours;
        ctx.economics = econ;
        ctx.pointers = ptrs;

        bytes32 digest = DigestLib.digest(ctx);
        SlotApproval[] memory approvals = new SlotApproval[](2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(takerPk, digest);
        approvals[0] = SlotApproval(1, abi.encodePacked(r, s, v));
        approvals[1] = SlotApproval(2, abi.encode(ctx, bytes("")));

        uint256 takerBefore = settlement.balanceOf(taker);
        router.settleAndCredit(ctx, approvals);
        assertGt(settlement.balanceOf(taker), takerBefore, "taker must receive a profitable settlement");

        // LP-side remainder credited to backers pro-rata by COLLATERAL CONTRIBUTION (5:3:2),
        // not by their quoted premium rate.
        uint256 lpSideTotal = router.claimable(backerA, address(collateral)) + router.claimable(backerB, address(collateral))
            + router.claimable(backerC, address(collateral));
        assertGt(lpSideTotal, 0, "some collateral-side remainder must be credited to backers");
        // backerA contributed 5 of 10 units => exactly half of the LP-side remainder.
        assertEq(router.claimable(backerA, address(collateral)), lpSideTotal / 2, "backerA gets exactly half, by contribution");
    }

    // ---------------------------------------------------------------------
    // I3 backstop: the router itself can co-sign SettleToLp post-expiry
    // ---------------------------------------------------------------------

    /// @notice The I3 backstop: the router itself co-signs `SettleToLp` post-expiry when the
    ///         wired condition (`TakerProfitCondition`) can't help, restoring liveness.
    function test_settleToLp_viaRouterDirectPath_afterExpiry_succeeds_andCreditsBackersByContribution() public {
        (uint256 positionId, address account) = _match(_allocations(), 1, 0);
        vm.warp(vm.getBlockTimestamp() + 2 hours); // past the 1-hour duration

        Economics memory econ;
        econ.lp = address(router);
        econ.collateralAsset = address(collateral);
        econ.collateralDecimals = 18;
        econ.settlementAsset = address(settlement);
        econ.settlementDecimals = 6;
        econ.optionType = 0;
        econ.units = 10;
        econ.unitScalarNum = 1;
        econ.unitScalarDen = 1;
        econ.entryPrice = 100e18;
        econ.expiry = uint64(1_800_000_000 + 1 hours);
        econ.feeBps = manager.FEE_BPS();

        Pointers memory ptrs;
        ptrs.oracle = address(oracle);
        ptrs.venue = address(venue);
        ptrs.arbiter = address(conditionArbiter);
        ptrs.condition = address(takerCond); // wrong condition for post-expiry recovery on purpose
        ptrs.routeId = bytes32(0);
        ptrs.maxPriceAge = 1 hours;
        ptrs.slippageBps = 100;

        ActionContext memory ctx;
        ctx.account = account;
        ctx.implementation = address(impl);
        ctx.homeChainId = block.chainid;
        ctx.positionManager = address(manager);
        ctx.positionId = positionId;
        ctx.accountState = PositionAccount(payable(account)).state();
        ctx.signerEpoch = manager.signerEpochOf(positionId);
        ctx.actionKind = ActionKind.SettleToLp;
        ctx.params = "";
        ctx.deadline = vm.getBlockTimestamp() + 1 hours;
        ctx.economics = econ;
        ctx.pointers = ptrs;

        bytes32 digest = DigestLib.digest(ctx);
        SlotApproval[] memory approvals = new SlotApproval[](2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(takerPk, digest);
        approvals[0] = SlotApproval(1, abi.encodePacked(r, s, v));
        // Slot 0 (LP = router) approved via the router's OWN ERC-1271 signature — this is
        // the I3 backstop: TakerProfitCondition (wired above) would reject an arbiter-gated
        // SettleToLp attempt, but the router+taker direct path needs no condition at all.
        approvals[1] = SlotApproval(0, abi.encode(ctx, bytes("")));

        router.settleAndCredit(ctx, approvals);

        (uint256 recordedCollateral,) = PositionAccount(payable(account)).realized();
        assertEq(recordedCollateral, 0, "settlement must have actually happened");

        assertEq(router.claimable(backerA, address(collateral)), 5e18, "backerA recovers exactly their 5-unit contribution");
        assertEq(router.claimable(backerB, address(collateral)), 3e18, "backerB recovers exactly their 3-unit contribution");
        assertEq(router.claimable(backerC, address(collateral)), 2e18, "backerC recovers exactly their 2-unit contribution");
    }

    /// @notice The router must never vouch for a position that is not its own.
    function test_isValidSignature_rejectsForeignPosition() public {
        (, address account) = _match(_allocations(), 1, 0);

        Economics memory econ;
        econ.lp = makeAddr("someOtherLp"); // not this router
        econ.collateralAsset = address(collateral);
        econ.collateralDecimals = 18;
        econ.settlementAsset = address(settlement);
        econ.settlementDecimals = 6;
        econ.optionType = 0;
        econ.units = 10;
        econ.unitScalarNum = 1;
        econ.unitScalarDen = 1;
        econ.entryPrice = 100e18;
        econ.expiry = uint64(1_800_000_000 + 1 hours);
        econ.feeBps = manager.FEE_BPS();

        Pointers memory ptrs;
        ptrs.oracle = address(oracle);
        ptrs.venue = address(venue);
        ptrs.arbiter = address(conditionArbiter);
        ptrs.condition = address(takerCond);
        ptrs.routeId = bytes32(0);
        ptrs.maxPriceAge = 1 hours;
        ptrs.slippageBps = 100;

        ActionContext memory ctx;
        ctx.account = account; // mismatched on purpose: this account was really minted with lp=router
        ctx.implementation = address(impl);
        ctx.homeChainId = block.chainid;
        ctx.positionManager = address(manager);
        ctx.positionId = 1;
        ctx.accountState = 0;
        ctx.signerEpoch = 0;
        ctx.actionKind = ActionKind.SettleToLp;
        ctx.params = "";
        ctx.deadline = vm.getBlockTimestamp() + 1 hours;
        ctx.economics = econ;
        ctx.pointers = ptrs;

        bytes32 digest = DigestLib.digest(ctx);
        bytes4 result = router.isValidSignature(digest, abi.encode(ctx, bytes("")));
        assertEq(result, bytes4(0xffffffff), "must not approve a position this router does not own");
    }
}
