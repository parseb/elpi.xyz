// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Libraries
import {TermsLib} from "./libraries/TermsLib.sol";
import {DigestLib} from "./libraries/DigestLib.sol";

// Types
import {ActionContext} from "./types/ActionContext.sol";

// Interfaces
import {IERC1271} from "./interfaces/IERC1271.sol";
import {ICondition} from "./interfaces/ICondition.sol";

/// @title ConditionArbiter
/// @author parseb
/// @notice Singleton, stateless, permissionless arbiter occupying signer slot 2
///         (ARCHITECTURE.md §2.2). Verified via ERC-1271 rather than a bespoke approval
///         path, so the threshold arithmetic in `AuthzModule` stays uniform across EOA,
///         Safe, and arbiter signers.
/// @dev No storage anywhere in this contract — verified by `script/lints/no-term-sload.sh`,
///      which requires an empty storage layout for exactly this reason: this contract is
///      reached via `staticcall` and has nothing to `SLOAD`, terms included. Every value it
///      reasons about arrives as calldata (the `digest`/`sig` ERC-1271 provides) or a
///      `memory` value decoded from that calldata.
contract ConditionArbiter is IERC1271 {
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;
    bytes4 private constant BAD_VALUE = 0xffffffff;

    /// @inheritdoc IERC1271
    /// @dev MUST NOT revert on rejection — every failure path below returns `BAD_VALUE`
    ///      rather than reverting, so a bad approval composes cleanly with
    ///      `IAuthzModule.requireQuorum`'s own revert-on-below-threshold behavior instead of
    ///      reverting the whole quorum check on the first bad signer.
    function isValidSignature(bytes32 digest, bytes calldata sig) external view returns (bytes4) {
        (ActionContext memory ctx, bytes memory hint) = abi.decode(sig, (ActionContext, bytes));

        // Step 1: bind the claim to the digest. Without this, the arbiter approves a
        // *description* of an action rather than the action itself — the ctx embedded in
        // this signature payload is a separate copy from whatever the caller's top-level
        // ctx says, assembled by whoever built this approval, and must be shown to hash to
        // the exact digest AuthzModule is checking it against.
        if (DigestLib.digest(ctx) != digest) return BAD_VALUE;

        // Step 2 (the v3 headline, §2.2): bind the TERMS to the account by re-deriving its
        // address. Reached via staticcall with no account storage to trust, so ctx.economics
        // and ctx.pointers are verified here rather than assumed correct.
        address derived = TermsLib.deriveAccount(
            ctx.implementation, ctx.economics, ctx.pointers, ctx.homeChainId, ctx.positionManager, ctx.positionId
        );
        if (derived != ctx.account) return BAD_VALUE;

        // Step 3: delegate the semantic check to the position's own condition. `try/catch`
        // here is deliberate, not defensive boilerplate: this contract's own ERC-1271
        // contract is MUST-NOT-REVERT, but `ICondition` implementations are third-party,
        // pluggable per position type (§3.5) and reviewed only for the curated tier — an
        // uncurated or simply buggy condition that reverts must not be able to break the
        // arbiter's own no-revert guarantee. A revert here is treated exactly like a `false`
        // answer.
        try ICondition(ctx.pointers.condition).check(ctx, hint) returns (bool ok) {
            if (!ok) return BAD_VALUE;
        } catch {
            return BAD_VALUE;
        }

        return MAGIC_VALUE;
    }
}
