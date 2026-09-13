// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActionContext} from "../types/ActionContext.sol";

/// @title DigestLib
/// @notice EIP-712 hashing for ActionContext per position account.
library DigestLib {
    bytes32 internal constant ACTION_TYPEHASH = keccak256(
        "Action(uint256 chainId,address account,uint256 accountState,uint256 signerEpoch,uint8 actionKind,bytes32 paramsHash,uint256 deadline)"
    );
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("OptionCore");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    function domainSeparator(address account) internal view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, account));
    }

    function digest(ActionContext memory ctx) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ACTION_TYPEHASH,
                block.chainid,
                ctx.account,
                ctx.accountState,
                ctx.signerEpoch,
                uint8(ctx.actionKind),
                keccak256(ctx.params),
                ctx.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(ctx.account), structHash));
    }
}
