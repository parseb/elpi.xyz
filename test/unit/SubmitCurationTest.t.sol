// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SubmitCuration} from "../../script/SubmitCuration.s.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract SubmitCurationTest is Test {
    SubmitCuration internal script;

    function setUp() public {
        script = new SubmitCuration();
    }

    function test_formatCurationProposal_validHookFlags() public {
        // Address with flags 0xC8
        address validHook = address(uint160(0x12340000000000000000000000000000000000C8));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            fee: 0x800000,
            tickSpacing: 60,
            hooks: IHooks(validHook)
        });

        SubmitCuration.CurationRecord memory record = script.formatCurationProposal(address(0), key, 1_000_000);

        assertEq(record.routeId, keccak256(abi.encode(key)));
        assertEq(record.hook, validHook);
        assertEq(record.tier, "CURATED");
        assertEq(record.queuedAt, 1_000_000);
        assertEq(record.activatesAt, 1_000_000 + 5 days);
        assertTrue(record.isValid);
    }

    function test_formatCurationProposal_revertsOnInvalidHookFlags() public {
        address invalidHook = address(uint160(0x1234000000000000000000000000000000000000)); // No 0xC8

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            fee: 0x800000,
            tickSpacing: 60,
            hooks: IHooks(invalidHook)
        });

        vm.expectRevert("SubmitCuration: invalid hook flags (must be 0xC8)");
        script.formatCurationProposal(address(0), key, 1_000_000);
    }
}
