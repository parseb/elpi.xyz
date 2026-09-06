// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ILPSettlementHook
/// @author parseb
/// @notice Optional, best-effort callback a contract occupying a position's `lp` slot may
///         implement to learn it has just received an LP-directed settlement outflow —
///         without needing to be the caller that triggered settlement.
/// @dev `PositionAccount` invokes this via a gas-bounded `try/catch` immediately after every
///      transfer of position assets to `economics.lp` (see `PositionAccount._notifyLp`).
///      Found and fixed post-implementation: `LPRouter.settleAndCredit` used to be the only
///      place backers were credited, by measuring the router's own balance delta around a
///      call it made itself into the account — but `PositionAccount.settleToTaker`/
///      `settleToLp` are public and satisfiable by an ordinary `{taker, arbiter}` 2-of-3
///      quorum with zero router involvement (by design — see `ILPRouter`'s own NatSpec), so
///      any settlement submitted that way still paid the router (as `economics.lp`) but left
///      every backer's credited balance at zero, with no recovery path. This interface
///      decouples crediting from the call path: whichever entrypoint is used, the account
///      itself notifies `economics.lp` right after paying it, so a router-style LP can credit
///      its backers regardless of who actually submitted the settlement transaction.
/// @dev Implementations MUST NOT rely on being the only path proceeds can arrive through, and
///      MUST NOT attempt to revert in a way meant to block settlement — `PositionAccount`
///      treats any revert or out-of-gas here as a no-op and continues regardless.
interface ILPSettlementHook {
    /// @notice Notifies that `amount` of `asset` was just transferred to this address as the
    ///         LP-directed outflow of `positionId`'s settlement.
    /// @param positionId The position identifier being settled.
    /// @param asset The token asset address transferred to the LP.
    /// @param amount The quantity of tokens transferred.
    function onPositionSettled(uint256 positionId, address asset, uint256 amount) external;
}
