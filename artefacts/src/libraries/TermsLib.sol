// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Economics} from "../types/Economics.sol";
import {Pointers} from "../types/Pointers.sol";

/// @notice Real, deployed ERC-6551 Registry `account()` getter — the subset of
///         `IERC6551Registry` `TermsLib` needs. Address-identical across chains
///         (ARCHITECTURE.md §1.1). This is the one address constant permitted anywhere in
///         core (project constraint); every other address in the system arrives as a term
///         or a calldata argument.
interface IERC6551RegistryView {
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address);
}

/// @title TermsLib
/// @author parseb
/// @notice Pure/view terms-commitment helpers shared by `PositionAccount` and
///         `ConditionArbiter` (ARCHITECTURE.md §2.2, §3.2). Contains no settlement logic,
///         no authorization logic, and no condition logic — only the address-derivation
///         math both of those consumers need to verify a `Economics`/`Pointers` pair
///         against an account address, instead of trusting it.
/// @dev Deliberately calls the canonical registry's own `account()` view rather than
///      re-implementing the ERC-1167/CREATE2 bytecode-hash formula locally: the registry is
///      already "the single most load-bearing external dependency in the design" (§1.1),
///      it is immutable and adminless, and re-deriving via the real deployed getter is
///      cheaper to audit than a second, hand-rolled implementation of the same formula that
///      could silently drift from it.
library TermsLib {
    /// @dev Canonical ERC-6551 Registry, address-identical on every chain (ARCHITECTURE.md
    ///      §1.1). Verify with `cast code` before relying on it on a new chain (§7.3 step 1).
    address internal constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    /// @dev Domain-separates this preimage from unrelated `keccak256(abi.encode(...))` calls
    ///      elsewhere in the system. Not run through `_hashTypedDataV4` — the salt is a
    ///      CREATE2 input, not a signed digest; §2.4's action digest is the signed artifact.
    bytes32 internal constant TERMS_TYPEHASH = keccak256(
        "Terms(address lp,address collateralAsset,uint8 collateralDecimals,address settlementAsset,uint8 settlementDecimals,uint8 optionType,uint256 units,uint256 unitScalarNum,uint256 unitScalarDen,uint256 entryPrice,uint64 expiry,uint16 feeBps,address oracle,address venue,address arbiter,address condition,bytes32 routeId,uint32 maxPriceAge,uint16 slippageBps)"
    );

    /// @notice Commits every term of a position into one salt (ARCHITECTURE.md §3.2).
    /// @dev Every field of both structs participates; changing any single bit changes the
    ///      salt and therefore the derived address. This is I2's entire enforcement
    ///      mechanism — there is no separate registry or `termsHash` slot.
    /// @dev Encodes the structs directly rather than exploding all 19 fields as separate
    ///      `abi.encode` arguments — byte-identical output (both structs are entirely
    ///      static types: no dynamic arrays/strings/bytes, so ABI-encoding a struct is just
    ///      the concatenation of its members' own encodings, exactly like encoding the same
    ///      fields individually), but with far fewer live temporaries at each call site.
    ///      An earlier, field-exploded version of this function compiled fine in isolation
    ///      but hit a genuine Yul stack-too-deep once inlined into `PositionAccount`'s
    ///      larger functions, even under via-IR — caught by `forge build` failing outright,
    ///      not by inspection.
    function termsSalt(Economics memory economics, Pointers memory pointers) internal pure returns (bytes32) {
        return keccak256(abi.encode(TERMS_TYPEHASH, economics, pointers));
    }

    /// @notice Re-derives the account address a given terms pair, implementation, and
    ///         ERC-6551 binding tuple would produce.
    /// @dev The verification a caller performs is always: compute this, compare to a
    ///      claimed account address, reject on mismatch. `ConditionArbiter` uses this because
    ///      it is reached via `staticcall` and has no account storage to trust (§2.2 step
    ///      2); `PositionAccount` uses it to verify a caller's `Economics`/`Pointers` claim
    ///      against `address(this)` (§3.2) without ever storing either struct.
    function deriveAccount(
        address implementation,
        Economics memory economics,
        Pointers memory pointers,
        uint256 homeChainId,
        address positionManager,
        uint256 positionId
    ) internal view returns (address) {
        bytes32 salt = termsSalt(economics, pointers);
        return IERC6551RegistryView(REGISTRY).account(implementation, salt, homeChainId, positionManager, positionId);
    }
}
