// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @dev Minimal `AggregatorV3Interface` fragment — only what this adapter reads.
interface IChainlinkAggregator {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    /// @notice The feed's native decimal scale (e.g. 8 for most USD feeds).
    function decimals() external view returns (uint8);
}

/// @title ChainlinkPriceOracleAdapter
/// @author parseb
/// @notice A real `IPriceOracle` adapter over a real Chainlink feed (ARCHITECTURE.md §3.4,
///         §7.3). Chain-specific, human-written, fork-verified against the deployed feed's
///         real ABI — never generated (§8's "no-code adapter generator" prohibition is
///         about the companion app, not about engineers writing these).
/// @dev This adapter is deliberately narrow: it serves exactly ONE
///      (collateralAsset, settlementAsset) pair, fixed at construction, matching how one
///      Chainlink feed only ever means one specific pair. `price()` reverts on any other
///      pair rather than silently misreporting.
/// @dev Peg disclosure (§3.4, closing v2's Q6): if the feed quotes an asset against a fiat
///      reference (e.g. "ETH / USD") rather than directly against `settlementAsset`, this
///      adapter MUST be constructed with `peggedAsset_` set to the settlement asset being
///      assumed to hold its peg, and `pegAssumption()` will disclose it. This is not a
///      hypothetical: the reference deployment on Base (see `script/deploy/` /
///      `test/fork/`) reads a real "ETH / USD" feed while settling in USDC — exactly
///      OptionHood's undisclosed NVDA/USDG situation, done honestly instead.
contract ChainlinkPriceOracleAdapter is IPriceOracle {
    address public immutable collateralAsset;
    address public immutable settlementAsset;
    IChainlinkAggregator public immutable feed;
    uint8 public immutable feedDecimals;
    bool public immutable assumesPeg;
    address public immutable peggedAsset;
    uint32 private immutable _cadenceHint;

    error UnsupportedPair(address collateralAsset, address settlementAsset);
    error InvalidAnswer(int256 answer);
    error IncompleteRound(uint80 roundId, uint80 answeredInRound);
    error ZeroAddress();

    /// @param cadenceHint_ The feed's expected update cadence under normal operation
    ///        (Q13, DECISIONS.md) — MUST be measured against the feed's real, observed
    ///        round history before deployment, not guessed. The Base ETH/USD reference
    ///        deployment measured ~1,230s (≈20.5 min) across several consecutive rounds
    ///        live on-chain and used 1,800s (30 min) here, leaving headroom for jitter
    ///        while staying meaningfully tighter than an arbitrary "safe" default. Heartbeats
    ///        can change; re-verify before relying on this value long-term (§7.3 step 5).
    constructor(
        address collateralAsset_,
        address settlementAsset_,
        address feed_,
        address peggedAsset_,
        uint32 cadenceHint_
    ) {
        // peggedAsset_ == address(0) is a meaningful, valid value (no peg assumption) —
        // never zero-checked; the other three are never legitimately zero.
        if (collateralAsset_ == address(0) || settlementAsset_ == address(0) || feed_ == address(0)) {
            revert ZeroAddress();
        }
        collateralAsset = collateralAsset_;
        settlementAsset = settlementAsset_;
        feed = IChainlinkAggregator(feed_);
        feedDecimals = IChainlinkAggregator(feed_).decimals();
        assumesPeg = peggedAsset_ != address(0);
        peggedAsset = peggedAsset_;
        _cadenceHint = cadenceHint_;
    }

    /// @inheritdoc IPriceOracle
    function price(address collateralAsset_, address settlementAsset_)
        external
        view
        returns (uint256, uint256)
    {
        if (collateralAsset_ != collateralAsset || settlementAsset_ != settlementAsset) {
            revert UnsupportedPair(collateralAsset_, settlementAsset_);
        }
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0) revert InvalidAnswer(answer);
        // Round-completeness (defense-in-depth against the honest-but-buggy feed case, same
        // spirit as Q13's cadenceHint): answeredInRound < roundId means this round's answer
        // is carried over from a prior round rather than freshly reported; updatedAt == 0
        // means the round has never actually been answered at all.
        if (updatedAt == 0 || answeredInRound < roundId) revert IncompleteRound(roundId, answeredInRound);
        uint256 normalized = (uint256(answer) * 1e18) / (10 ** feedDecimals);
        return (normalized, updatedAt);
    }

    /// @inheritdoc IPriceOracle
    function oracleId() external view returns (bytes32) {
        return keccak256(abi.encode("ChainlinkPriceOracleAdapter", address(feed), assumesPeg, peggedAsset));
    }

    /// @inheritdoc IPriceOracle
    function pegAssumption() external view returns (bool, address) {
        return (assumesPeg, peggedAsset);
    }

    /// @inheritdoc IPriceOracle
    function cadenceHint() external view returns (uint32) {
        return _cadenceHint;
    }
}
