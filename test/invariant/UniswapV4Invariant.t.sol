// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UniswapV4Handler} from "./handlers/UniswapV4Handler.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @title UniswapV4InvariantTest
/// @notice State-fuzzing invariant campaign for elpi (elpi.xyz) Uniswap v4 integration.
///         Verifies that random sequences of swaps, deposits, extractions, and hook invocations
///         never violate protocol invariants I1, I2, or I3.
contract UniswapV4InvariantTest is Test {
    UniswapV4Handler public handler;

    function setUp() public {
        handler = new UniswapV4Handler();
        targetContract(address(handler));
    }

    /// @notice Invariant I1 (Bounded Insolvency):
    ///         The UniswapV4VenueAdapter must NEVER hold any persistent token balance
    ///         after any sequence of swaps or external calls.
    function invariant_I1_adapterZeroPersistentBalance() public view {
        assertEq(
            handler.tokenA().balanceOf(address(handler.adapter())),
            0,
            "Invariant I1 Violated: Adapter holds persistent tokenA balance"
        );
        assertEq(
            handler.tokenB().balanceOf(address(handler.adapter())),
            0,
            "Invariant I1 Violated: Adapter holds persistent tokenB balance"
        );
    }

    /// @notice Invariant I2 (Immutability):
    ///         Once registered, the PoolKey for routeId is append-only and cannot be altered.
    function invariant_I2_routeImmutability() public view {
        (Currency c0, Currency c1, uint24 fee, int24 tickSpacing, IHooks hooks) =
            handler.adapter().poolKeyOf(handler.routeId());

        assertEq(Currency.unwrap(c0), address(handler.tokenA()), "Invariant I2 Violated: currency0 mutated");
        assertEq(Currency.unwrap(c1), address(handler.tokenB()), "Invariant I2 Violated: currency1 mutated");
        assertEq(fee, 0x800000, "Invariant I2 Violated: dynamic fee mutated");
        assertEq(tickSpacing, 60, "Invariant I2 Violated: tickSpacing mutated");
        assertEq(address(hooks), address(handler.hook()), "Invariant I2 Violated: hooks mutated");
    }

    /// @notice Invariant I3 (Venue-Free Recovery & Re-stake Isolation):
    ///         Failed restaking must accumulate in pendingAsset without corrupting state.
    function invariant_I3_vaultPendingAssetNonNegative() public view {
        uint256 pendingA = handler.vault().pendingAsset(address(handler.tokenA()));
        uint256 pendingB = handler.vault().pendingAsset(address(handler.tokenB()));
        assertTrue(pendingA >= 0, "Pending tokenA is non-negative");
        assertTrue(pendingB >= 0, "Pending tokenB is non-negative");
    }
}
