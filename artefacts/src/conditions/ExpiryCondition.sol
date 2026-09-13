// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActionContext} from "../types/ActionContext.sol";
import {ICondition} from "../interfaces/ICondition.sol";

/// @title ExpiryCondition
/// @author parseb
/// @notice The `SETTLE_TO_LP` gate (ARCHITECTURE.md §2.2): expiry only.
/// @dev Load-bearing for I3: reads only `block.timestamp`, never the oracle, never any
///      other module — this is the property that keeps LP recovery available even when
///      every other dependency of the position has broken. Do not add an oracle read, a
///      venue call, or any external call to this contract under any circumstance; that
///      would silently reintroduce the exact failure mode I3 exists to rule out. Stateless —
///      verified by `script/lints/no-term-sload.sh`.
contract ExpiryCondition is ICondition {
    /// @inheritdoc ICondition
    function check(ActionContext calldata ctx, bytes calldata) external view returns (bool) {
        return block.timestamp >= ctx.economics.expiry;
    }

    /// @inheritdoc ICondition
    function conditionId() external pure returns (bytes32) {
        return keccak256("ExpiryCondition/v3");
    }
}
