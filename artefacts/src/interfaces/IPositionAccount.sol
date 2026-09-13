// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActionContext} from "../types/ActionContext.sol";
import {SlotApproval} from "../types/SlotApproval.sol";

interface IPositionAccount {
    function settleToTaker(ActionContext calldata ctx, SlotApproval[] calldata approvals) external;
    function settleToLp(ActionContext calldata ctx, SlotApproval[] calldata approvals) external;
}
