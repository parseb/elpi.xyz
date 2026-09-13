// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../Base.sol";
import {Properties} from "../Properties.sol";
import {ILPRouter} from "../../../src/interfaces/ILPRouter.sol";
import {ActionContext} from "../../../src/types/ActionContext.sol";
import {SlotApproval} from "../../../src/types/SlotApproval.sol";

/// @notice Handles the interaction with LPRouter
abstract contract LPRouterHandler is Properties {

    function lPRouter_matchAndMint_clamped(ILPRouter.BackerAllocation[] memory allocations, address collateralAsset, address settlementAsset, uint256 unitScalarNum, uint256 unitScalarDen, address oracle, address venue, address arbiter, address condition, bytes32 routeId, uint32 maxPriceAge, uint16 slippageBps, uint16 durationHours, uint8 optionType, bool ackUnverifiedTerms) public {
        lPRouter_matchAndMint(allocations, collateralAsset, settlementAsset, unitScalarNum, unitScalarDen, oracle, venue, arbiter, condition, routeId, maxPriceAge, slippageBps, durationHours, optionType, ackUnverifiedTerms);
    }

    function lPRouter_onPositionSettled_clamped(uint256 positionId, address asset, uint256 amount) public {
        lPRouter_onPositionSettled(positionId, asset, amount);
    }

    function lPRouter_settleAndCredit_clamped(ActionContext memory ctx, SlotApproval[] memory approvals) public {
        lPRouter_settleAndCredit(ctx, approvals);
    }

    function lPRouter_withdraw_clamped(address asset) public {
        lPRouter_withdraw(asset);
    }

    function lPRouter_matchAndMint(ILPRouter.BackerAllocation[] memory allocations, address collateralAsset, address settlementAsset, uint256 unitScalarNum, uint256 unitScalarDen, address oracle, address venue, address arbiter, address condition, bytes32 routeId, uint32 maxPriceAge, uint16 slippageBps, uint16 durationHours, uint8 optionType, bool ackUnverifiedTerms) public asActor {
    }

    function lPRouter_onPositionSettled(uint256 positionId, address asset, uint256 amount) public asActor {
    }

    function lPRouter_settleAndCredit(ActionContext memory ctx, SlotApproval[] memory approvals) public asActor {
    }

    function lPRouter_withdraw(address asset) public asActor {
    }
}
