// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {OptionSettlementHook} from "../src/hooks/OptionSettlementHook.sol";

/// @notice Brute-force a CREATE2 salt that produces an OptionSettlementHook address
///         satisfying Uniswap v4's hook flag bitmap.
///
/// Required flags:
///   BEFORE_SWAP                = bit 7  (mask 0x0080)
///   BEFORE_SWAP_RETURNS_DELTA  = bit 3  (mask 0x0008)
///   AFTER_SWAP                 = bit 6  (mask 0x0040)
///
/// The hook address encodes these flags in the lower 14 bits of the address.
/// This script mines a salt such that:
///   address(hook) & FLAG_MASK == REQUIRED_FLAGS
///
/// Usage:
///   forge script script/MineHookSalt.s.sol --sig "run(address,address)" \
///     <POOL_MANAGER_ADDR> <OWNER_ADDR>
///
/// Output: the salt and the expected hook address. Deploy with:
///   forge create src/hooks/OptionSettlementHook.sol:OptionSettlementHook \
///     --constructor-args <POOL_MANAGER> <OWNER> \
///     --create2-salt <SALT>
contract MineHookSalt is Script {
    // Hook flag bits (Uniswap v4 Hooks.sol encoding)
    uint160 constant BEFORE_SWAP_FLAG = 1 << 7;
    uint160 constant AFTER_SWAP_FLAG = 1 << 6;
    uint160 constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3;

    uint160 constant REQUIRED_FLAGS = BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG;

    function run(address poolManager, address owner) external view {
        bytes memory creationCode =
            abi.encodePacked(type(OptionSettlementHook).creationCode, abi.encode(IPoolManager(poolManager), owner));
        bytes32 codeHash = keccak256(creationCode);

        address deployer = msg.sender;
        uint256 found = 0;

        console.log("Mining CREATE2 salt for OptionSettlementHook...");
        console.log("Required flag bits (lower 14 bits of address):", REQUIRED_FLAGS);

        for (uint256 salt = 0; salt < 200_000; salt++) {
            bytes32 saltBytes = bytes32(salt);
            address predicted = _computeAddress(deployer, saltBytes, codeHash);

            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == REQUIRED_FLAGS) {
                found = salt;
                console.log(">>> Found salt:", salt);
                console.log(">>> Hook address:", predicted);
                break;
            }
        }

        if (found == 0) {
            console.log("No salt found in 200k iterations -- increase search range.");
        }
    }

    function _computeAddress(address deployer, bytes32 salt, bytes32 codeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, codeHash)))));
    }
}
