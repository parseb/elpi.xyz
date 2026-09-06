// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ISettlementVenue
/// @author parseb
/// @notice Venue-agnostic settlement/swap adapter (ARCHITECTURE.md §3.4). Core knows only
///         this interface; router-specific calldata shapes live in one adapter per venue —
///         OptionHood's bug #1 (a `SwapRouter02` ABI mismatch) is exactly the class of
///         defect this boundary confines to a single, per-chain, fork-tested file (§6.1,
///         §7.3).
interface ISettlementVenue {
    /// @notice Executes a swap. `minAmountOut` MUST have been derived from
    ///         `IPriceOracle.price`, never from this venue's own `quote` (§3.4) — enforced
    ///         by the caller, not by this interface, but load-bearing for the whole design.
    /// @param tokenIn Address of the token to be sold.
    /// @param tokenOut Address of the token to be bought.
    /// @param amountIn Exact input amount to swap.
    /// @param minAmountOut Minimum acceptable output amount derived from oracle.
    /// @param deadline Unix timestamp deadline.
    /// @param routeId Opaque route identifier committing the venue pool.
    /// @return amountOut The actual amount received and delivered to caller.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 routeId
    ) external returns (uint256 amountOut);

    /// @notice Advisory only. NEVER used to derive `minAmountOut` for an actual swap — it
    ///         exists so the app can warn "this route is illiquid" before anyone pays gas
    ///         (§8.2), the direct fix for OptionHood's finding that two of three onboarded
    ///         tickers were untradeable and nothing on-chain surfaced it.
    /// @param tokenIn Address of the token to be sold.
    /// @param tokenOut Address of the token to be bought.
    /// @param amountIn Input amount to simulate.
    /// @param routeId Opaque route identifier committing the venue pool.
    /// @return The estimated amount out (advisory).
    function quote(address tokenIn, address tokenOut, uint256 amountIn, bytes32 routeId)
        external
        view
        returns (uint256);
}
