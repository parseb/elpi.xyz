// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ILPRouter} from "../interfaces/ILPRouter.sol";

/// @title BackerQuoteLib
/// @author parseb
/// @notice The EIP-712 hash of an `ILPRouter.BackerQuote` (DECISIONS.md Q7 addendum),
///         computed identically by `LPRouter` (to verify a backer's signature against) and
///         by whoever signs one in the first place (a backer's wallet, or a test/off-chain
///         tool reproducing that same signature) — the same role `DigestLib`/`TermsLib`
///         play for `ActionContext`/account-address derivation: a hash that must be
///         reproducible outside the contract that verifies it belongs in a shared library,
///         not a private contract method (unlike `LPRouter._hashProfile`, which only the
///         router itself ever needs, since it self-signs that one).
/// @dev Pure hashing only — no verification, no authorization logic.
library BackerQuoteLib {
    bytes32 internal constant BACKER_QUOTE_TYPEHASH = keccak256(
        "BackerQuote(address backer,address collateralAsset,address settlementAsset,uint16 minHours,uint16 maxHours,uint256 maxUnits,uint256 pricePerUnitPerHour,uint8 supportsOptionType,uint256 unitScalarNum,uint256 unitScalarDen,address oracle,address venue,address arbiter,address condition,bytes32 routeId,uint32 maxPriceAge,uint16 slippageBps,uint256 nonce)"
    );
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("OptionCore");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    /// @notice The EIP-712 domain separator for `router` as `verifyingContract` — a
    ///         `BackerQuote` is verified by the router directly, never by `PositionManager`,
    ///         so the router's own address is `verifyingContract` here (mirrors
    ///         `DigestLib.domainSeparator`'s identical rule for `ActionContext`).
    function domainSeparator(address router) internal view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, router));
    }

    /// @notice The signable/verifiable digest of `q` for `router`.
    function digest(ILPRouter.BackerQuote memory q, address router) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                BACKER_QUOTE_TYPEHASH,
                q.backer,
                q.collateralAsset,
                q.settlementAsset,
                q.minHours,
                q.maxHours,
                q.maxUnits,
                q.pricePerUnitPerHour,
                q.supportsOptionType,
                q.unitScalarNum,
                q.unitScalarDen,
                q.oracle,
                q.venue,
                q.arbiter,
                q.condition,
                q.routeId,
                q.maxPriceAge,
                q.slippageBps,
                q.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(router), structHash));
    }
}
