// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActionContext} from "../types/ActionContext.sol";
import {SlotApproval} from "../types/SlotApproval.sol";
import {ActionKind} from "../types/ActionKind.sol";

interface IAuthzModule {
    error BadApproval(uint8 slot);
    error BelowThreshold(uint8 threshold, uint8 satisfied);
    error DeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error DuplicateSlot(uint8 slot);
    error SlotNotEligible(uint8 slot);

    function requireQuorum(
        address account,
        bytes32 digest,
        ActionContext calldata ctx,
        SlotApproval[] calldata approvals
    ) external view;

    function policyFor(ActionKind actionKind) external pure returns (uint8 threshold, uint8 eligibleSlotMask);

    function signerSlots(ActionContext calldata ctx) external view returns (address[] memory slots);
}
