// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Libraries
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// Types
import {ActionContext} from "./types/ActionContext.sol";
import {SlotApproval} from "./types/SlotApproval.sol";
import {ActionKind} from "./types/ActionKind.sol";

// Interfaces
import {IAuthzModule} from "./interfaces/IAuthzModule.sol";
import {IERC1271} from "./interfaces/IERC1271.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title AuthzModule
/// @author parseb
/// @notice The generic M-of-N authorization primitive (ARCHITECTURE.md §2.1). Stateless and
///         reusable across every position: thresholds and eligibility masks are compile-time
///         constants keyed only by `ActionKind`, never by account.
/// @dev No `SLOAD` anywhere in this contract — verified by `script/lints/no-term-sload.sh`,
///      which requires an empty storage layout, not merely "no term field."
contract AuthzModule is IAuthzModule {
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    /// @inheritdoc IAuthzModule
    function requireQuorum(
        address, /* account */
        bytes32 digest,
        ActionContext calldata ctx,
        SlotApproval[] calldata approvals
    ) external view {
        if (block.timestamp > ctx.deadline) revert DeadlineExpired(ctx.deadline, block.timestamp);

        (uint8 threshold, uint8 eligibleSlotMask) = policyFor(ctx.actionKind);
        address[] memory slots = signerSlots(ctx);

        uint256 seenMask;
        uint8 satisfied;
        for (uint256 i = 0; i < approvals.length; i++) {
            uint8 slot = approvals[i].slot;
            uint8 bit = uint8(1 << slot);

            if (eligibleSlotMask & bit == 0) revert SlotNotEligible(slot);
            if (seenMask & bit != 0) revert DuplicateSlot(slot);
            seenMask |= bit;

            if (!_verify(slots[slot], digest, approvals[i].signature)) revert BadApproval(slot);
            unchecked {
                ++satisfied;
            }
        }

        if (satisfied < threshold) revert BelowThreshold(threshold, satisfied);
    }

    /// @dev The uniform verification rule (§2.2): ECDSA if the slot's signer has no code,
    ///      ERC-1271 `isValidSignature` otherwise. `ECDSA.tryRecover` rejects malleable
    ///      (high-`s`) signatures per EIP-2 rather than silently accepting a second valid
    ///      encoding of the same signature.
    function _verify(address signer, bytes32 digest, bytes calldata signature) internal view returns (bool) {
        if (signer.code.length == 0) {
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
            return err == ECDSA.RecoverError.NoError && recovered == signer;
        }
        return IERC1271(signer).isValidSignature(digest, signature) == ERC1271_MAGIC_VALUE;
    }

    /// @inheritdoc IAuthzModule
    function signerSlots(ActionContext calldata ctx) public view returns (address[] memory slots) {
        slots = new address[](3);
        slots[0] = ctx.economics.lp;
        slots[1] = IERC721(ctx.positionManager).ownerOf(ctx.positionId);
        slots[2] = ctx.pointers.arbiter;
    }

    /// @inheritdoc IAuthzModule
    function policyFor(ActionKind actionKind) public pure returns (uint8 threshold, uint8 eligibleSlotMask) {
        uint8 allSlots = uint8(1 << 0) | uint8(1 << 1) | uint8(1 << 2);

        if (actionKind == ActionKind.MutualUnwind) {
            return (2, uint8(1 << 0) | uint8(1 << 1));
        }
        if (actionKind == ActionKind.RawExecute) {
            return (3, allSlots);
        }
        // SettleToTaker, SettleToLp, SweepDust
        return (2, allSlots);
    }
}
