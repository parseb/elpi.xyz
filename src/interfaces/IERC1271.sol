// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Standard signature-validation interface (EIP-1271). Referenced by the account's
///         uniform signer-verification rule (ARCHITECTURE.md §2.2): if a slot's signer has
///         code, its approval is checked via this interface instead of `ECDSA.recover`.
///         `ConditionArbiter` implements this to occupy slot 2 as a real signer rather than
///         a bespoke approval path.
interface IERC1271 {
    /// @notice Returns `0x1626ba7e` if `signature` is a valid signature for `digest`,
    ///         or any other value (e.g. `0xffffffff`) otherwise. MUST NOT revert on an
    ///         invalid signature (§2.2 — `ConditionArbiter` returns `0xffffffff` rather
    ///         than reverting on every rejection branch, so a failed check composes cleanly
    ///         with `IAuthzModule.requireQuorum`'s below-threshold revert).
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4);
}
