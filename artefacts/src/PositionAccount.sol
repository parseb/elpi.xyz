// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Libraries
import {ERC6551AccountLib} from "erc6551-reference/lib/ERC6551AccountLib.sol";
import {TermsLib} from "./libraries/TermsLib.sol";
import {DigestLib} from "./libraries/DigestLib.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Types
import {Realized} from "./types/Realized.sol";
import {ActionContext} from "./types/ActionContext.sol";
import {ActionKind} from "./types/ActionKind.sol";
import {SlotApproval} from "./types/SlotApproval.sol";
import {SettleToTakerParams, MutualUnwindParams, SweepDustParams, RawExecuteParams} from "./types/ActionParams.sol";

// Interfaces
import {IPositionAccount} from "./interfaces/IPositionAccount.sol";
import {IPositionAccountMintHooks} from "./interfaces/IPositionAccountMintHooks.sol";
import {IAuthzModule} from "./interfaces/IAuthzModule.sol";
import {IPositionManager} from "./interfaces/IPositionManager.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {ISettlementVenue} from "./interfaces/ISettlementVenue.sol";
import {ILPSettlementHook} from "./interfaces/ILPSettlementHook.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";

/// @title PositionAccount
/// @author parseb
/// @notice Holds all collateral for exactly one position (ARCHITECTURE.md §0-§3). Deployed
///         only as an ERC-6551 minimal-proxy clone via the canonical registry — never
///         `new`-deployed directly, since `token()`/`recordMint`'s access control both
///         depend on the registry-appended immutable context data every real clone carries.
/// @dev Storage is exactly `Realized` (2 slots), `accountState` (the `state()` nonce), and
///      `rawExecutePendingSince` (a procedural timelock record — not a term: it encodes
///      only "has this exact already-terms-verified digest been proposed, and when," never
///      any economic parameter). Nothing else may ever be added here — enforced by
///      `script/lints/no-term-sstore.sh`.
contract PositionAccount is IPositionAccount, IPositionAccountMintHooks, IERC721Receiver, IERC1155Receiver {
    using SafeERC20 for IERC20;

    bytes4 private constant ERC6551_VALID_SIGNER = 0x523e3260;
    uint256 private constant RAW_EXECUTE_DELAY = 48 hours;

    /// @dev Gas stipend forwarded to `ILPSettlementHook.onPositionSettled` (see `_notifyLp`).
    ///      Sized generously above what `LPRouter`'s own implementation needs (a loop over at
    ///      most `MAX_BACKERS` = 8 backers, one cold SSTORE + one event each) while still
    ///      bounding how much an adversarial or buggy contract-`lp` could waste per call —
    ///      it can never consume the whole transaction's gas, only this stipend.
    uint256 private constant LP_HOOK_GAS = 300_000;

    IAuthzModule public immutable authzModule;
    address public immutable feeVault;

    Realized public realized;
    uint256 public accountState;
    mapping(bytes32 => uint256) public rawExecutePendingSince;

    error TermsMismatch();
    error StaleAccountState(uint256 live, uint256 provided);
    error StaleSignerEpoch(uint256 live, uint256 provided);
    error OnlyPositionManager();
    error AlreadyRecorded();
    error PriceInFuture();
    error PriceStale();
    error UnprofitablePosition();
    error PayoutBelowMinimum(uint256 payout, uint256 minPayoutToTaker);
    error CannotSweepPositionAsset();
    error UnsupportedOperation(uint8 operation);
    error RawExecuteDelayNotElapsed(uint256 availableAt, uint256 currentTimestamp);
    error RawExecuteCallFailed();
    error Unreachable();
    error ZeroAddress();

    constructor(IAuthzModule authzModule_, address feeVault_) {
        if (address(authzModule_) == address(0) || feeVault_ == address(0)) revert ZeroAddress();
        authzModule = authzModule_;
        feeVault = feeVault_;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // Mint-time recording — gated to the real, immutable positionManager only
    // ---------------------------------------------------------------------

    /// @dev Access control the counterfactual-deployment story (§3.6) needs but a bare
    ///      Realized-writing function wouldn't have on its own: a stranger who
    ///      pre-deploys this account before the real mint cannot corrupt it, because only
    ///      the `tokenContract` baked into the account's OWN immutable bytecode by the
    ///      registry — read via `ERC6551AccountLib.token()`, unspoofable — may call, and
    ///      only once (`Realized` is written-once, checked here, not merely by convention).
    function _requirePositionManagerFirstWrite() internal view {
        (, address positionManager,) = ERC6551AccountLib.token();
        if (msg.sender != positionManager) revert OnlyPositionManager();
        if (realized.recordedCollateral != 0 || realized.recordedSettlement != 0) revert AlreadyRecorded();
    }

    /// @notice Records a CALL's collateral, measured by the caller as
    ///         `balanceAfter - balanceBefore` around its own `transferFrom` (§3.6 step 10) —
    ///         never re-derived here from a requested amount or from `balanceOf`.
    function recordMint(uint256 recordedCollateral, uint256 recordedSettlement) external {
        _requirePositionManagerFirstWrite();
        realized = Realized(recordedCollateral, recordedSettlement);
    }

    /// @notice The PUT creation-time swap (§3.6 step 12): swaps `amountIn` of `tokenIn`
    ///         (already sitting in this account from the LP's transfer) and records the
    ///         EXACT output as `recordedSettlement` — never re-derived from price.
    function initialSwapAndRecord(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bytes32 routeId,
        address venue
    ) external {
        _requirePositionManagerFirstWrite();
        IERC20(tokenIn).safeIncreaseAllowance(venue, amountIn);
        uint256 out = ISettlementVenue(venue).swap(tokenIn, tokenOut, amountIn, minAmountOut, deadline, routeId);
        realized = Realized(0, out);
    }

    // ---------------------------------------------------------------------
    // IERC6551Account
    // ---------------------------------------------------------------------

    /// @notice The immutable `(chainId, tokenContract, tokenId)` tuple the registry baked
    ///         into this account's own bytecode at deployment.
    function token() external view returns (uint256, address, uint256) {
        return ERC6551AccountLib.token();
    }

    /// @notice Monotonic; doubles as the quorum replay nonce (§1.3, §2.4).
    function state() external view returns (uint256) {
        return accountState;
    }

    /// @notice Returns the magic value only for the bound `authzModule` — never for the
    ///         NFT owner directly. This NFT conveys economic rights, not custody (§1.2).
    function isValidSigner(address signer, bytes calldata) external view returns (bytes4) {
        if (signer == address(authzModule)) return ERC6551_VALID_SIGNER;
        return bytes4(0);
    }

    // ---------------------------------------------------------------------
    // IERC6551Executable — see the NatSpec below for why this is intentionally unreachable
    // ---------------------------------------------------------------------

    /// @notice Always reverts.
    /// @dev The raw `IERC6551Executable` ABI (`address,uint256,bytes,uint8`, no quorum
    ///      payload) has no room to carry `ActionContext`/`SlotApproval[]`, so there is no
    ///      way to gate it safely against arbitrary callers. `AuthzModule` is a stateless,
    ///      view-only predicate (see its own NatSpec) that never itself becomes
    ///      `msg.sender` anywhere in this system, so ARCHITECTURE.md §1.2's "gate relocated
    ///      to authzModule" cannot mean a literal `msg.sender == authzModule` check — no
    ///      caller could ever satisfy it. Rather than ship a function whose documented gate
    ///      is unsatisfiable (dead code masquerading as a safety check), this reverts
    ///      unconditionally; `rawExecute` (quorum- and 48h-delay-gated) is the real,
    ///      reachable raw-call path (§9 Milestone 3).
    function execute(address, uint256, bytes calldata, uint8) external payable returns (bytes memory) {
        revert Unreachable();
    }

    // ---------------------------------------------------------------------
    // Shared verification
    // ---------------------------------------------------------------------

    /// @dev I2 (address re-derivation), replay protection (accountState + signerEpoch, the
    ///      Milestone 3 gap `DigestLib`'s own NatSpec flagged as the account's
    ///      responsibility), and quorum — in that order, cheapest checks first.
    function _verifyAndRequireQuorum(ActionContext calldata ctx, SlotApproval[] calldata approvals)
        internal
        view
        returns (bytes32 digest)
    {
        if (ctx.accountState != accountState) revert StaleAccountState(accountState, ctx.accountState);
        _verifyTerms(ctx);

        uint256 liveSignerEpoch = IPositionManager(ctx.positionManager).signerEpochOf(ctx.positionId);
        if (ctx.signerEpoch != liveSignerEpoch) revert StaleSignerEpoch(liveSignerEpoch, ctx.signerEpoch);

        digest = DigestLib.digest(ctx);
        authzModule.requireQuorum(address(this), digest, ctx, approvals);
    }

    /// @dev I2: re-derive this account's own address from the caller-supplied terms and
    ///      compare to `address(this)`. Isolated into its own function (rather than inlined
    ///      into `_verifyAndRequireQuorum`) purely to keep the Yul optimizer's stack
    ///      pressure at each call site manageable — `ActionContext` carries enough nested
    ///      calldata fields that combining this with the rest of that function's locals hit
    ///      a genuine stack-too-deep even under via-IR.
    function _verifyTerms(ActionContext calldata ctx) internal view {
        address derived = TermsLib.deriveAccount(
            ctx.implementation, ctx.economics, ctx.pointers, ctx.homeChainId, ctx.positionManager, ctx.positionId
        );
        if (derived != address(this)) revert TermsMismatch();
    }

    function _taker(ActionContext calldata ctx) internal view returns (address) {
        return IERC721(ctx.positionManager).ownerOf(ctx.positionId);
    }

    /// @dev I4: fee rounds up, payout rounds down, remainder implicitly to the LP —
    ///      confirmed with worked examples in DECISIONS.md.
    function _feeAndPayout(uint256 gross, uint16 feeBps) internal pure returns (uint256 fee, uint256 payout) {
        fee = (gross * feeBps + 9_999) / 10_000;
        payout = gross - fee;
    }

    /// @dev Best-effort notification to a contract-`lp` that it just received `amount` of
    ///      `asset` as this settlement's LP-directed outflow (`ILPSettlementHook`) — see that
    ///      interface's NatSpec for the bug this closes. An EOA `lp` has no code and is
    ///      skipped without a call; a non-conforming or malicious contract `lp` can waste at
    ///      most `LP_HOOK_GAS` and can never revert or block the settlement itself, since any
    ///      failure here is caught and ignored. Always called AFTER the corresponding
    ///      transfer, and after this settlement's own state (`realized`, `accountState`) has
    ///      already advanced, so nothing this call does can be used to replay or re-enter the
    ///      settlement that triggered it.
    function _notifyLp(address lp, uint256 positionId, address asset, uint256 amount) private {
        if (amount == 0 || lp.code.length == 0) return;
        try ILPSettlementHook(lp).onPositionSettled{gas: LP_HOOK_GAS}(positionId, asset, amount) {} catch {}
    }

    // ---------------------------------------------------------------------
    // SettleToTaker
    // ---------------------------------------------------------------------

    /// @inheritdoc IPositionAccount
    /// @dev CALL and PUT are genuinely different branches (DECISIONS.md's P&L table), not a
    ///      cost-model simplification carried forward: CALL swaps only the PROFIT PORTION
    ///      of the held collateral, transferring the unswapped remainder to the LP
    ///      directly; PUT pays the taker directly from the already-settlement-denominated
    ///      `recordedSettlement` (no swap for the taker) and swaps only the LP's remainder
    ///      back to collateral. Profitability, freshness, and the payout floor are
    ///      re-verified here independently of whatever `ICondition` may or may not have
    ///      already checked — a direct LP+taker 2-of-2 approval never routes through
    ///      `ConditionArbiter` at all, so this account-level check is the only enforcement
    ///      that path gets. Deliberately not among these: `TakerProfitCondition.check` also
    ///      requires `block.timestamp < expiry`, but `_requireProfitable` does not — an
    ///      arbiter-assembled approval is still gated on that by the condition, while a direct
    ///      LP+taker 2-of-2 may settle to the taker post-expiry too, since that requires the
    ///      LP's own consent regardless.
    function settleToTaker(ActionContext calldata ctx, SlotApproval[] calldata approvals) external {
        _verifyAndRequireQuorum(ctx, approvals);

        SettleToTakerParams memory p = abi.decode(ctx.params, (SettleToTakerParams));
        (uint256 pnl, uint256 livePrice) = _requireProfitable(ctx);

        Realized memory r = realized;
        realized = Realized(0, 0);
        accountState++;

        uint256 fee;
        uint256 payout;
        if (r.recordedCollateral > 0) {
            (fee, payout) = _settleToTakerCall(ctx, p, r.recordedCollateral, pnl, livePrice);
        } else {
            (fee, payout) = _settleToTakerPut(ctx, p, r.recordedSettlement, pnl, livePrice);
        }

        if (payout < p.minPayoutToTaker) revert PayoutBelowMinimum(payout, p.minPayoutToTaker);

        IERC20(ctx.economics.settlementAsset).safeTransfer(feeVault, fee);
        IERC20(ctx.economics.settlementAsset).safeTransfer(_taker(ctx), payout);
    }

    /// @dev Reads the oracle, checks freshness (including the future-dated guard the
    ///      Milestone 2 conditions also apply), and requires strict profitability —
    ///      independent of whatever `ICondition` may have already checked, since a direct
    ///      LP+taker approval never routes through `ConditionArbiter` at all. Also returns
    ///      the live price itself so callers that need it again (`_settleToTakerCall`/
    ///      `_settleToTakerPut`) don't re-read the same oracle a second time in the same
    ///      transaction.
    function _requireProfitable(ActionContext calldata ctx) internal view returns (uint256 pnl, uint256 livePrice) {
        uint256 updatedAt;
        (livePrice, updatedAt) =
            IPriceOracle(ctx.pointers.oracle).price(ctx.economics.collateralAsset, ctx.economics.settlementAsset);
        if (updatedAt > block.timestamp) revert PriceInFuture();
        if (block.timestamp - updatedAt > ctx.pointers.maxPriceAge) revert PriceStale();

        int256 signedPnl = ctx.economics.optionType == 0
            ? int256(livePrice) - int256(ctx.economics.entryPrice)
            : int256(ctx.economics.entryPrice) - int256(livePrice);
        if (signedPnl <= 0) revert UnprofitablePosition();
        pnl = uint256(signedPnl);
    }

    /// @dev Oracle-derived floor for a settlement-time swap, mirroring
    ///      `PositionManager._expectedSwapOutput`'s mint-time computation (same slippage
    ///      tolerance, `ctx.pointers.slippageBps`) but against the live price rather than the
    ///      frozen `entryPrice` — settlement, not mint — and parameterized by direction so it
    ///      covers both the CALL taker-swap (collateral -> settlement) and the PUT
    ///      LP-remainder swap-back (settlement -> collateral). Caller-supplied
    ///      `SettleToTakerParams.minAmountOut` is honored as a tightening-only bound on top of
    ///      this — never a way to waive it (§3.4: a pool-price manipulator must never be able
    ///      to force a worse-than-oracle fill on either party).
    function _oracleFloor(uint256 amountIn, uint256 livePrice, uint8 decimalsIn, uint8 decimalsOut, uint16 slippageBps, bool collateralToSettlement)
        internal
        pure
        returns (uint256)
    {
        uint256 expectedOut = collateralToSettlement
            ? (amountIn * livePrice * (10 ** decimalsOut)) / ((10 ** decimalsIn) * 1e18)
            : (amountIn * 1e18 * (10 ** decimalsOut)) / ((10 ** decimalsIn) * livePrice);
        return (expectedOut * (10_000 - slippageBps)) / 10_000;
    }

    /// @dev CALL: swap only the profit portion of the held collateral for the taker;
    ///      transfer the unswapped remainder to the LP directly (DECISIONS.md's P&L table).
    /// @dev Milestone 4 correction: computes `units * unitScalarNum` and defers the division
    ///      by `unitScalarDen` (folded into the same final division as `livePrice`) rather
    ///      than pre-truncating a `wholeUnits` intermediate — see `TakerProfitCondition`'s
    ///      NatSpec for the fractional-share bug this avoids.
    function _settleToTakerCall(
        ActionContext calldata ctx,
        SettleToTakerParams memory p,
        uint256 recordedCollateral,
        uint256 pnl,
        uint256 livePrice
    ) internal returns (uint256 fee, uint256 payout) {
        uint256 swapAmount = (pnl * ctx.economics.units * ctx.economics.unitScalarNum * (10 ** ctx.economics.collateralDecimals))
            / (ctx.economics.unitScalarDen * livePrice);
        if (swapAmount > recordedCollateral) swapAmount = recordedCollateral;
        uint256 remainder = recordedCollateral - swapAmount;

        if (remainder > 0) {
            IERC20(ctx.economics.collateralAsset).safeTransfer(ctx.economics.lp, remainder);
            _notifyLp(ctx.economics.lp, ctx.positionId, ctx.economics.collateralAsset, remainder);
        }

        uint256 floor = _oracleFloor(
            swapAmount, livePrice, ctx.economics.collateralDecimals, ctx.economics.settlementDecimals, ctx.pointers.slippageBps, true
        );
        uint256 minOut = p.minAmountOut > floor ? p.minAmountOut : floor;

        IERC20(ctx.economics.collateralAsset).safeIncreaseAllowance(ctx.pointers.venue, swapAmount);
        uint256 swapped = ISettlementVenue(ctx.pointers.venue).swap(
            ctx.economics.collateralAsset,
            ctx.economics.settlementAsset,
            swapAmount,
            minOut,
            p.swapDeadline,
            ctx.pointers.routeId
        );
        (fee, payout) = _feeAndPayout(swapped, ctx.economics.feeBps);
    }

    /// @dev PUT: pay the taker directly from the already-settlement-denominated
    ///      `recordedSettlement` (no swap for the taker); swap only the LP's remainder back
    ///      to the collateral asset. Same fractional-share fix as the CALL branch above.
    function _settleToTakerPut(
        ActionContext calldata ctx,
        SettleToTakerParams memory p,
        uint256 recordedSettlement,
        uint256 pnl,
        uint256 livePrice
    ) internal returns (uint256 fee, uint256 payout) {
        uint256 profitValue = (pnl * ctx.economics.units * ctx.economics.unitScalarNum * (10 ** ctx.economics.settlementDecimals))
            / (ctx.economics.unitScalarDen * 1e18);
        if (profitValue > recordedSettlement) profitValue = recordedSettlement;
        (fee, payout) = _feeAndPayout(profitValue, ctx.economics.feeBps);

        uint256 remainder = recordedSettlement - profitValue;
        if (remainder > 0) {
            uint256 floor = _oracleFloor(
                remainder, livePrice, ctx.economics.settlementDecimals, ctx.economics.collateralDecimals, ctx.pointers.slippageBps, false
            );
            uint256 minOut = p.minAmountOut > floor ? p.minAmountOut : floor;

            IERC20(ctx.economics.settlementAsset).safeIncreaseAllowance(ctx.pointers.venue, remainder);
            uint256 swappedBack = ISettlementVenue(ctx.pointers.venue).swap(
                ctx.economics.settlementAsset,
                ctx.economics.collateralAsset,
                remainder,
                minOut,
                p.swapDeadline,
                ctx.pointers.routeId
            );
            IERC20(ctx.economics.collateralAsset).safeTransfer(ctx.economics.lp, swappedBack);
            _notifyLp(ctx.economics.lp, ctx.positionId, ctx.economics.collateralAsset, swappedBack);
        }
    }

    // ---------------------------------------------------------------------
    // SettleToLp — I3: oracle-free, venue-free, condition-free
    // ---------------------------------------------------------------------

    /// @inheritdoc IPositionAccount
    function settleToLp(ActionContext calldata ctx, SlotApproval[] calldata approvals) external {
        _verifyAndRequireQuorum(ctx, approvals);

        Realized memory r = realized;
        realized = Realized(0, 0);
        accountState++;

        if (r.recordedCollateral > 0) {
            IERC20(ctx.economics.collateralAsset).safeTransfer(ctx.economics.lp, r.recordedCollateral);
            _notifyLp(ctx.economics.lp, ctx.positionId, ctx.economics.collateralAsset, r.recordedCollateral);
        }
        if (r.recordedSettlement > 0) {
            IERC20(ctx.economics.settlementAsset).safeTransfer(ctx.economics.lp, r.recordedSettlement);
            _notifyLp(ctx.economics.lp, ctx.positionId, ctx.economics.settlementAsset, r.recordedSettlement);
        }
    }

    // ---------------------------------------------------------------------
    // MutualUnwind — LP + taker only (enforced by AuthzModule's eligibleSlotMask)
    // ---------------------------------------------------------------------

    /// @inheritdoc IPositionAccount
    function mutualUnwind(ActionContext calldata ctx, SlotApproval[] calldata approvals) external {
        _verifyAndRequireQuorum(ctx, approvals);

        MutualUnwindParams memory p = abi.decode(ctx.params, (MutualUnwindParams));

        Realized memory r = realized;
        realized = Realized(0, 0);
        accountState++;

        (address asset, uint256 total) = r.recordedCollateral > 0
            ? (ctx.economics.collateralAsset, r.recordedCollateral)
            : (ctx.economics.settlementAsset, r.recordedSettlement);

        uint256 takerGross = (total * p.takerBps) / 10_000;
        (uint256 fee, uint256 takerPayout) = _feeAndPayout(takerGross, ctx.economics.feeBps);
        uint256 lpPayout = total - takerGross;

        IERC20(asset).safeTransfer(feeVault, fee);
        IERC20(asset).safeTransfer(_taker(ctx), takerPayout);
        IERC20(asset).safeTransfer(ctx.economics.lp, lpPayout);
        _notifyLp(ctx.economics.lp, ctx.positionId, asset, lpPayout);
    }

    // ---------------------------------------------------------------------
    // SweepDust
    // ---------------------------------------------------------------------

    /// @inheritdoc IPositionAccount
    /// @dev The collateral/settlement-asset refusal is enforced HERE, unconditionally — not
    ///      solely inside `DustCondition`. A direct LP+taker 2-of-2 approval never invokes
    ///      `ConditionArbiter`/`DustCondition` at all, and without this independent check
    ///      that path would let the two parties jointly drain the position's real assets
    ///      with none of `MutualUnwind`'s I4 fee applied — a strictly worse bypass than the
    ///      already-documented off-chain-side-payment evasion (§3.6), because this one would
    ///      be structural rather than requiring off-chain trust. Found while implementing
    ///      this function, not assumed safe by construction.
    function sweepDust(ActionContext calldata ctx, SlotApproval[] calldata approvals) external {
        _verifyAndRequireQuorum(ctx, approvals);

        SweepDustParams memory p = abi.decode(ctx.params, (SweepDustParams));
        if (p.token == ctx.economics.collateralAsset || p.token == ctx.economics.settlementAsset) {
            revert CannotSweepPositionAsset();
        }

        IERC20(p.token).safeTransfer(p.to, p.amount);
    }

    // ---------------------------------------------------------------------
    // RawExecute — 3-of-3 + 48h delay; DELEGATECALL/CREATE/CREATE2 rejected
    // ---------------------------------------------------------------------

    /// @inheritdoc IPositionAccount
    /// @dev Single function serves as both "propose" and "execute": the first call for a
    ///      given digest records `block.timestamp` and returns without acting; a second
    ///      call before the delay reverts; a second call after it performs the raw call.
    ///      Quorum is independently re-verified on both calls. Under the standard
    ///      `ConditionArbiter` + `NeverCondition` wiring this can never reach 3-of-3 at
    ///      all — the arbiter's own approval always fails `NeverCondition` — so it is only
    ///      reachable when a position's `pointers.arbiter` is some other signer willing to
    ///      directly co-sign (a human overseer, a multisig), which is a legitimate but
    ///      deliberately rare configuration (§2.2's default-deny intent for this action).
    function rawExecute(ActionContext calldata ctx, SlotApproval[] calldata approvals) external {
        bytes32 digest = _verifyAndRequireQuorum(ctx, approvals);

        uint256 pendingSince = rawExecutePendingSince[digest];
        if (pendingSince == 0) {
            rawExecutePendingSince[digest] = block.timestamp;
            return;
        }

        uint256 availableAt = pendingSince + RAW_EXECUTE_DELAY;
        if (block.timestamp < availableAt) revert RawExecuteDelayNotElapsed(availableAt, block.timestamp);

        delete rawExecutePendingSince[digest];

        RawExecuteParams memory p = abi.decode(ctx.params, (RawExecuteParams));
        if (p.operation != 0) revert UnsupportedOperation(p.operation);

        accountState++;
        (bool ok,) = p.to.call{value: p.value}(p.data);
        if (!ok) revert RawExecuteCallFailed();
    }

    // ---------------------------------------------------------------------
    // Receiver hooks — forward-looking (§1.2); nothing is in scope to accept yet
    // ---------------------------------------------------------------------

    /// @notice Always reverts — no NFT is in scope for this position type yet.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert Unreachable();
    }

    /// @notice Always reverts — no ERC-1155 asset is in scope for this position type yet.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert Unreachable();
    }

    /// @notice Always reverts — no ERC-1155 asset is in scope for this position type yet.
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert Unreachable();
    }

    /// @notice Minimal stub; no interface ID is advertised as supported.
    function supportsInterface(bytes4) external pure returns (bool) {
        return false;
    }
}
