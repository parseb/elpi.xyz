// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Originally a PoC for a High-severity finding: LP-side settlement proceeds were stranded
// when a router-backed position was settled by calling the PositionAccount directly (the
// natural ERC-6551 path, and the one MASTER_ARCHITECTURE.md §3.9 explicitly blesses as "zero
// router involvement"), instead of through LPRouter.settleAndCredit — because crediting used
// to happen only inside settleAndCredit's own balance-delta measurement, never triggered by a
// direct call. Fixed by ILPSettlementHook: PositionAccount now notifies economics.lp (via
// onPositionSettled) right after paying it, on every settlement path, regardless of which
// entry point was used to trigger settlement — so this file now asserts the FIXED behavior
// (backers are correctly credited via the direct path too) as a permanent regression test.
// Reuses LPRouterTest's full real-stack setUp.

import {LPRouterTest} from "./LPRouter.t.sol";

import {PositionAccount} from "../../src/PositionAccount.sol";
import {IPositionAccount} from "../../src/interfaces/IPositionAccount.sol";
import {Economics} from "../../src/types/Economics.sol";
import {Pointers} from "../../src/types/Pointers.sol";
import {ActionContext} from "../../src/types/ActionContext.sol";
import {ActionKind} from "../../src/types/ActionKind.sol";
import {SlotApproval} from "../../src/types/SlotApproval.sol";
import {SettleToTakerParams} from "../../src/types/ActionParams.sol";
import {DigestLib} from "../../src/libraries/DigestLib.sol";
import {ILPRouter} from "../../src/interfaces/ILPRouter.sol";

contract LPRouterStrandingPoC is LPRouterTest {
    function _buildSettleToTakerCtx(uint256 positionId, address account)
        internal
        view
        returns (ActionContext memory ctx)
    {
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
    }

    function test_regression_directSettleToTaker_stillCreditsBackerRemainder() public {
        (uint256 positionId, address account) = _match(_allocations(), 24, 0); // CALL, 10 units
        // backerA/B/C contributed 5e18/3e18/2e18 of the 10e18 collateral (_allocations()).

        oracle.setPrice(125e18, vm.getBlockTimestamp());
        venue.setRate(125e6, 1e18);

        ActionContext memory ctx = _buildSettleToTakerCtx(positionId, account);
        bytes32 digest = DigestLib.digest(ctx);
        SlotApproval[] memory approvals = new SlotApproval[](2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(takerPk, digest);
        approvals[0] = SlotApproval(1, abi.encodePacked(r, s, v)); // taker
        approvals[1] = SlotApproval(2, abi.encode(ctx, bytes(""))); // permissionless arbiter

        uint256 takerBefore = settlement.balanceOf(taker);
        uint256 routerCollatBefore = collateral.balanceOf(address(router));

        // Anyone with the taker's approval submits settlement STRAIGHT to the account,
        // never touching router.settleAndCredit. Same taker payout, so the taker is
        // economically indifferent to using this path — which is exactly why crediting
        // cannot be allowed to depend on it being the one used.
        vm.prank(makeAddr("anyone"));
        IPositionAccount(account).settleToTaker(ctx, approvals);

        // Taker was paid in full.
        assertGt(settlement.balanceOf(taker), takerBefore, "taker paid");

        // The LP-side remainder (8e18 of 10e18 collateral) landed in the router...
        uint256 received = collateral.balanceOf(address(router)) - routerCollatBefore;
        assertEq(received, 8e18, "router received the 8e18 LP-side remainder");

        // ...and every backer was credited their exact pro-rata share of it via
        // onPositionSettled (ILPSettlementHook), called by the account itself — with no
        // involvement from settleAndCredit at all.
        assertEq(router.claimable(backerA, address(collateral)), 4.0e18, "backerA credited 5/10");
        assertEq(router.claimable(backerB, address(collateral)), 2.4e18, "backerB credited 3/10");
        assertEq(router.claimable(backerC, address(collateral)), 1.6e18, "backerC credited 2/10 (remainder)");
        assertEq(
            router.claimable(backerA, address(collateral)) + router.claimable(backerB, address(collateral))
                + router.claimable(backerC, address(collateral)),
            received,
            "credited sum matches exactly what the router received, no dust lost or invented"
        );

        // Each backer can withdraw their credited share.
        uint256 aBefore = collateral.balanceOf(backerA);
        vm.prank(backerA);
        router.withdraw(address(collateral));
        assertEq(collateral.balanceOf(backerA) - aBefore, 4.0e18, "backerA withdrew their exact credit");

        // settleAndCredit is now a thin pass-through with nothing left to do — calling it
        // again reverts (account state already advanced by the direct settlement above),
        // and since it no longer performs any crediting itself, that revert is harmless.
        vm.expectRevert();
        router.settleAndCredit(ctx, approvals);
    }
}
