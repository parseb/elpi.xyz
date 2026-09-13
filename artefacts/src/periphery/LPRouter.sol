// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Libraries
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {TermsLib} from "../libraries/TermsLib.sol";
import {DigestLib} from "../libraries/DigestLib.sol";
import {BackerQuoteLib} from "../libraries/BackerQuoteLib.sol";

// Types
import {LiquidityProfile} from "../types/LiquidityProfile.sol";
import {Pointers} from "../types/Pointers.sol";
import {ActionContext} from "../types/ActionContext.sol";
import {ActionKind} from "../types/ActionKind.sol";
import {SlotApproval} from "../types/SlotApproval.sol";

// Interfaces
import {ILPRouter} from "../interfaces/ILPRouter.sol";
import {IPositionManager} from "../interfaces/IPositionManager.sol";
import {IPositionAccount} from "../interfaces/IPositionAccount.sol";
import {ILPSettlementHook} from "../interfaces/ILPSettlementHook.sol";
import {IERC1271} from "../interfaces/IERC1271.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IV4LiquidityVault} from "../../../src/interfaces/IV4LiquidityVault.sol";

/// @dev Minimal ABI fragment — only what this contract needs to size collateral pulls.
interface IERC20Decimals {
    /// @notice The token's own decimal scale, queried and used the same way
    ///         `PositionManager` itself does at mint — never assumed.
    function decimals() external view returns (uint8);
}

/// @title LPRouter
/// @author parseb
/// @notice Multi-LP aggregation periphery contract (MASTER_ARCHITECTURE.md §3.9, Milestone
///         7, Q7 in DECISIONS.md). See `ILPRouter` for the full design rationale.
/// @dev No core contract depends on this existing — `PositionAccount`, `AuthzModule`,
///      `ConditionArbiter`, and every `ICondition` are entirely unaware of it. It occupies
///      the `lp` slot purely via the ERC-1271 path those contracts already support.
contract LPRouter is ILPRouter, IERC721Receiver, ILPSettlementHook {
    using SafeERC20 for IERC20;

    struct BackerShare {
        address backer;
        uint256 collateralContributed;
    }

    uint256 public constant MAX_BACKERS = 8;
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 private constant BAD_VALUE = 0xffffffff;

    /// @dev Duplicated from `PositionManager` deliberately — every caller that needs to
    ///      produce a `LiquidityProfile` hash already does this (every test file in this
    ///      repo included); a router is no different, and importing `PositionManager`'s
    ///      private helpers is not possible.
    bytes32 private constant LIQUIDITY_PROFILE_TYPEHASH = keccak256(
        "LiquidityProfile(address lp,address collateralAsset,address settlementAsset,uint16 minHours,uint16 maxHours,uint256 totalUnits,uint256 pricePerUnitPerHour,uint8 supportsOptionType,uint256 unitScalarNum,uint256 unitScalarDen,address oracle,address venue,address arbiter,address condition,bytes32 routeId,uint32 maxPriceAge,uint16 slippageBps,bool ackUnverifiedTerms,uint256[] chainIds,uint256 timestamp,uint256 nonce)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("OptionCore");
    bytes32 private constant VERSION_HASH = keccak256("1");

    IPositionManager public immutable manager;

    mapping(bytes32 => bool) public approvedProfileHash;
    /// @dev `address(0)` doubles as "not a position this router matched" — replaces a plain
    ///      `matchedPositions` bool with the exact account address, needed so
    ///      `onPositionSettled` can verify its caller is genuinely that position's account
    ///      (ILPSettlementHook) without re-deriving it from full terms.
    mapping(uint256 => address) public accountOf;
    mapping(bytes32 => uint256) public consumedUnitsForQuote;
    mapping(uint256 => BackerShare[]) internal _backerSharesOf;
    mapping(address => mapping(address => uint256)) internal _claimable;
    uint256 internal _nonce;

    constructor(address manager_) {
        if (manager_ == address(0)) revert ZeroAddress();
        manager = IPositionManager(manager_);
    }

    // ---------------------------------------------------------------------
    // EIP-712 profile hashing — mirrors PositionManager._hashProfile exactly
    // ---------------------------------------------------------------------

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(manager))
        );
    }

    function _hashProfile(LiquidityProfile memory profile) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                LIQUIDITY_PROFILE_TYPEHASH,
                profile.lp,
                profile.collateralAsset,
                profile.settlementAsset,
                profile.minHours,
                profile.maxHours,
                profile.totalUnits,
                profile.pricePerUnitPerHour,
                profile.supportsOptionType,
                profile.unitScalarNum,
                profile.unitScalarDen,
                profile.oracle,
                profile.venue,
                profile.arbiter,
                profile.condition,
                profile.routeId,
                profile.maxPriceAge,
                profile.slippageBps,
                profile.ackUnverifiedTerms,
                keccak256(abi.encodePacked(profile.chainIds)),
                profile.timestamp,
                profile.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    // ---------------------------------------------------------------------
    // Backer-quote verification (DECISIONS.md Q7 addendum) — hashing itself lives in
    // BackerQuoteLib, shared with whatever signs a quote in the first place (see that
    // library's own NatSpec for why).
    // ---------------------------------------------------------------------

    /// @dev ECDSA if `backer` has no code, ERC-1271 otherwise — the identical rule applied
    ///      everywhere else a signer slot is checked in this system (`AuthzModule._verify`,
    ///      `PositionManager._verifySignature`).
    function _verifyQuoteSignature(address backer, bytes32 quoteHash, bytes calldata signature) internal view {
        if (backer.code.length == 0) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(quoteHash, signature);
            if (err != ECDSA.RecoverError.NoError || signer != backer) revert InvalidQuoteSignature();
            return;
        }
        if (IERC1271(backer).isValidSignature(quoteHash, signature) != ERC1271_MAGIC_VALUE) {
            revert InvalidQuoteSignature();
        }
    }

    /// @dev Verifies every allocation's quote (signature, shared-terms match, duration/
    ///      option-type bounds, remaining capacity) and consumes that capacity — all before
    ///      any collateral is pulled, so a rejected allocation never leaves partial state.
    function _verifyAndConsumeAllocations(
        BackerAllocation[] calldata allocations,
        address collateralAsset,
        address settlementAsset,
        uint256 unitScalarNum,
        uint256 unitScalarDen,
        address oracle,
        address venue,
        address arbiter,
        address condition,
        bytes32 routeId,
        uint32 maxPriceAge,
        uint16 slippageBps,
        uint16 durationHours,
        uint8 optionType
    ) internal {
        for (uint256 i = 0; i < allocations.length; i++) {
            BackerQuote calldata q = allocations[i].quote;
            bytes32 quoteHash = BackerQuoteLib.digest(q, address(this));
            _verifyQuoteSignature(q.backer, quoteHash, allocations[i].signature);

            bool termsMatch = q.collateralAsset == collateralAsset && q.settlementAsset == settlementAsset
                && q.unitScalarNum == unitScalarNum && q.unitScalarDen == unitScalarDen && q.oracle == oracle
                && q.venue == venue && q.arbiter == arbiter && q.condition == condition && q.routeId == routeId
                && q.maxPriceAge == maxPriceAge && q.slippageBps == slippageBps;
            if (!termsMatch) revert QuoteTermsMismatch();

            if (durationHours < q.minHours || durationHours > q.maxHours) {
                revert QuoteDurationOutOfBounds(q.minHours, q.maxHours, durationHours);
            }
            if (q.supportsOptionType != 2 && q.supportsOptionType != optionType) {
                revert QuoteOptionTypeNotSupported(q.supportsOptionType, optionType);
            }

            uint256 already = consumedUnitsForQuote[quoteHash];
            uint256 units = allocations[i].units;
            if (already + units > q.maxUnits) revert QuoteCapacityExceeded(already, units, q.maxUnits);
            consumedUnitsForQuote[quoteHash] = already + units;
        }
    }

    // ---------------------------------------------------------------------
    // matchAndMint
    // ---------------------------------------------------------------------

    /// @inheritdoc ILPRouter
    function matchAndMint(
        BackerAllocation[] calldata allocations,
        address collateralAsset,
        address settlementAsset,
        uint256 unitScalarNum,
        uint256 unitScalarDen,
        address oracle,
        address venue,
        address arbiter,
        address condition,
        bytes32 routeId,
        uint32 maxPriceAge,
        uint16 slippageBps,
        uint16 durationHours,
        uint8 optionType,
        bool ackUnverifiedTerms
    ) external returns (uint256 positionId, address account) {
        uint256 n = allocations.length;
        if (n == 0) revert NoBackers();
        if (n > MAX_BACKERS) revert TooManyBackers(n, MAX_BACKERS);

        address realTaker = msg.sender;

        _verifyAndConsumeAllocations(
            allocations,
            collateralAsset,
            settlementAsset,
            unitScalarNum,
            unitScalarDen,
            oracle,
            venue,
            arbiter,
            condition,
            routeId,
            maxPriceAge,
            slippageBps,
            durationHours,
            optionType
        );

        (uint256 totalUnits, uint256 weightedRateSum) = _sumAllocations(allocations);
        (uint256[] memory contributed, uint256 totalCollateralPulled) =
            _pullCollateral(allocations, collateralAsset, unitScalarNum, unitScalarDen, totalUnits);
        IERC20(collateralAsset).safeIncreaseAllowance(address(manager), totalCollateralPulled);

        uint256 rate = weightedRateSum / totalUnits; // floor — see ILPRouter's NatSpec
        uint256 premium = totalUnits * uint256(durationHours) * rate;
        if (premium > 0) {
            IERC20(settlementAsset).safeTransferFrom(realTaker, address(this), premium);
            IERC20(settlementAsset).safeIncreaseAllowance(address(manager), premium);
        }

        (positionId, account) = _assembleAndMint(
            totalUnits,
            rate,
            collateralAsset,
            settlementAsset,
            unitScalarNum,
            unitScalarDen,
            oracle,
            venue,
            arbiter,
            condition,
            routeId,
            maxPriceAge,
            slippageBps,
            durationHours,
            optionType,
            ackUnverifiedTerms
        );

        // State fully established before the one external call (NFT forwarding) that could
        // hand control to an arbitrary contract (a malicious taker's `onERC721Received`) —
        // checks-effects-interactions, the same discipline `PositionAccount` uses instead of
        // a blanket `ReentrancyGuard` (this codebase has none; ordering does the job).
        accountOf[positionId] = account;
        BackerShare[] storage shares = _backerSharesOf[positionId];
        for (uint256 i = 0; i < n; i++) {
            address backer = allocations[i].quote.backer;
            shares.push(BackerShare({backer: backer, collateralContributed: contributed[i]}));
            emit BackerContributed(positionId, backer, contributed[i]);
        }
        if (premium > 0) _distributePremium(positionId, allocations, settlementAsset, premium, weightedRateSum);

        IERC721(address(manager)).safeTransferFrom(address(this), realTaker, positionId);

        emit PositionMatched(positionId, account, realTaker);
    }

    function _sumAllocations(BackerAllocation[] calldata allocations)
        internal
        pure
        returns (uint256 totalUnits, uint256 weightedRateSum)
    {
        for (uint256 i = 0; i < allocations.length; i++) {
            totalUnits += allocations[i].units;
            weightedRateSum += allocations[i].units * allocations[i].quote.pricePerUnitPerHour;
        }
    }

    /// @dev Pulls each backer's per-unit share of collateral; the last backer absorbs the
    ///      integer-division remainder so the sum is always exactly what `PositionManager`
    ///      will itself compute for `totalUnits` — never a wei more or less, regardless of
    ///      how many backers there are.
    ///
    ///      Single-Transaction Atomic Extraction (Compromise Architecture Principle 2):
    ///      If the backer is a contract (e.g. V4LiquidityVault), LPRouter calls
    ///      extractForMint(collateralAsset, amt) to atomically pull collateral from Uniswap v4
    ///      without requiring a pre-mint extraction transaction by the LP.
    ///      If the backer is an EOA or standard wallet, falls back to safeTransferFrom.
    function _pullCollateral(
        BackerAllocation[] calldata allocations,
        address collateralAsset,
        uint256 unitScalarNum,
        uint256 unitScalarDen,
        uint256 totalUnits
    ) internal returns (uint256[] memory contributed, uint256 totalCollateralNeeded) {
        uint256 n = allocations.length;
        uint8 collateralDecimals = IERC20Decimals(collateralAsset).decimals();
        totalCollateralNeeded = (totalUnits * unitScalarNum * (10 ** collateralDecimals)) / unitScalarDen;

        contributed = new uint256[](n);
        uint256 pulled;
        for (uint256 i = 0; i < n; i++) {
            uint256 amt = i == n - 1
                ? totalCollateralNeeded - pulled
                : (allocations[i].units * unitScalarNum * (10 ** collateralDecimals)) / unitScalarDen;

            address backer = allocations[i].quote.backer;
            bool extracted = false;
            if (backer.code.length > 0) {
                try IV4LiquidityVault(backer).extractForMint(collateralAsset, amt) {
                    extracted = true;
                } catch {}
            }
            if (!extracted) {
                IERC20(collateralAsset).safeTransferFrom(backer, address(this), amt);
            }

            contributed[i] = amt;
            pulled += amt;
        }
    }

    function _assembleAndMint(
        uint256 totalUnits,
        uint256 rate,
        address collateralAsset,
        address settlementAsset,
        uint256 unitScalarNum,
        uint256 unitScalarDen,
        address oracle,
        address venue,
        address arbiter,
        address condition,
        bytes32 routeId,
        uint32 maxPriceAge,
        uint16 slippageBps,
        uint16 durationHours,
        uint8 optionType,
        bool ackUnverifiedTerms
    ) internal returns (uint256 positionId, address account) {
        uint256[] memory chainIds = new uint256[](1);
        chainIds[0] = block.chainid;

        // Named struct-literal construction (solidity-style-guide.md) — deliberately not
        // field-by-field dot-assignment: the latter is syntactically indistinguishable from
        // a REPOINT-shaped mutator to script/lints/no-repoint-mutator.sh's grep, which
        // flagged an earlier draft of this function as a false positive. This is fresh
        // struct assembly for a mint-time parameter, never a live account's stored pointers.
        LiquidityProfile memory profile = LiquidityProfile({
            lp: address(this),
            collateralAsset: collateralAsset,
            settlementAsset: settlementAsset,
            minHours: durationHours,
            maxHours: durationHours,
            totalUnits: totalUnits,
            pricePerUnitPerHour: rate,
            supportsOptionType: 2,
            unitScalarNum: unitScalarNum,
            unitScalarDen: unitScalarDen,
            oracle: oracle,
            venue: venue,
            arbiter: arbiter,
            condition: condition,
            routeId: routeId,
            maxPriceAge: maxPriceAge,
            slippageBps: slippageBps,
            ackUnverifiedTerms: ackUnverifiedTerms,
            chainIds: chainIds,
            timestamp: block.timestamp,
            nonce: _nonce++,
            signature: ""
        });

        approvedProfileHash[_hashProfile(profile)] = true;

        Pointers memory ptrs = Pointers({
            oracle: oracle,
            venue: venue,
            arbiter: arbiter,
            condition: condition,
            routeId: routeId,
            maxPriceAge: maxPriceAge,
            slippageBps: slippageBps
        });

        (positionId, account) = manager.mint(profile, totalUnits, durationHours, ptrs, optionType, ackUnverifiedTerms);
    }

    /// @dev Distributes the actual premium `PositionManager` charged (never a hoped-for
    ///      target) proportional to each backer's own `units * pricePerUnitPerHour` weight —
    ///      the last backer absorbs the remainder. Pull-based (`_claimable`, not pushed): a
    ///      single reverting or blacklisted backer can never block another backer's credit,
    ///      or block the mint itself.
    function _distributePremium(
        uint256 positionId,
        BackerAllocation[] calldata allocations,
        address settlementAsset,
        uint256 premium,
        uint256 weightedRateSum
    ) internal {
        uint256 n = allocations.length;
        uint256 distributed;
        for (uint256 i = 0; i < n; i++) {
            address backer = allocations[i].quote.backer;
            uint256 share = i == n - 1
                ? premium - distributed
                : (premium * (allocations[i].units * allocations[i].quote.pricePerUnitPerHour)) / weightedRateSum;
            _claimable[backer][settlementAsset] += share;
            distributed += share;
            emit Credited(positionId, backer, settlementAsset, share);
        }
    }

    // ---------------------------------------------------------------------
    // settleAndCredit
    // ---------------------------------------------------------------------

    /// @inheritdoc ILPRouter
    /// @dev Thin convenience wrapper only — does not itself credit anyone. Crediting happens
    ///      via `onPositionSettled` (`ILPSettlementHook`), called by `ctx.account` itself as
    ///      part of `settleToTaker`/`settleToLp` above, regardless of which caller/path
    ///      triggered settlement. This function's only remaining job is to let a caller who
    ///      doesn't want to build `ActionContext`/quorum plumbing for the account directly
    ///      still trigger settlement through the router.
    function settleAndCredit(ActionContext calldata ctx, SlotApproval[] calldata approvals) external {
        if (ctx.economics.lp != address(this)) revert NotThisRoutersPosition();

        if (ctx.actionKind == ActionKind.SettleToTaker) {
            IPositionAccount(ctx.account).settleToTaker(ctx, approvals);
        } else if (ctx.actionKind == ActionKind.SettleToLp) {
            IPositionAccount(ctx.account).settleToLp(ctx, approvals);
        } else {
            revert OnlySettleToLpSupported();
        }
    }

    /// @inheritdoc ILPSettlementHook
    /// @dev The fix for the bug `ILPSettlementHook`'s own NatSpec documents: `msg.sender`
    ///      must be exactly `positionId`'s own account (`accountOf`, recorded at match time
    ///      from `matchAndMint`'s own `manager.mint` return value — never re-derived from
    ///      caller-supplied terms, since none are passed here) or anyone could credit
    ///      arbitrary amounts to arbitrary backers by calling this directly.
    function onPositionSettled(uint256 positionId, address asset, uint256 amount) external {
        if (msg.sender != accountOf[positionId]) revert NotThisPositionsAccount();
        _creditByContribution(positionId, asset, amount);
    }

    /// @dev Splits `amount` among `positionId`'s backers proportional to how much collateral
    ///      each contributed at mint — never by their quoted premium rate. Capital risk and
    ///      price are kept as two separate axes throughout (§3.9).
    function _creditByContribution(uint256 positionId, address asset, uint256 amount) internal {
        BackerShare[] storage shares = _backerSharesOf[positionId];
        uint256 n = shares.length;
        uint256 totalContributed;
        for (uint256 i = 0; i < n; i++) totalContributed += shares[i].collateralContributed;
        if (totalContributed == 0) return;

        uint256 distributed;
        for (uint256 i = 0; i < n; i++) {
            uint256 share =
                i == n - 1 ? amount - distributed : (amount * shares[i].collateralContributed) / totalContributed;
            _claimable[shares[i].backer][asset] += share;
            distributed += share;
            emit Credited(positionId, shares[i].backer, asset, share);
        }
    }

    // ---------------------------------------------------------------------
    // Withdrawal
    // ---------------------------------------------------------------------

    /// @inheritdoc ILPRouter
    function withdraw(address asset) external {
        uint256 amount = _claimable[msg.sender][asset];
        if (amount == 0) revert NothingToWithdraw();
        _claimable[msg.sender][asset] = 0;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, asset, amount);
    }

    /// @inheritdoc ILPRouter
    function claimable(address backer, address asset) external view returns (uint256) {
        return _claimable[backer][asset];
    }

    /// @inheritdoc ILPRouter
    function backerAllocationsOf(uint256 positionId)
        external
        view
        returns (address[] memory backers, uint256[] memory collateralContributed)
    {
        BackerShare[] storage shares = _backerSharesOf[positionId];
        uint256 n = shares.length;
        backers = new address[](n);
        collateralContributed = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            backers[i] = shares[i].backer;
            collateralContributed[i] = shares[i].collateralContributed;
        }
    }

    // ---------------------------------------------------------------------
    // ERC-1271 — see ILPRouter's contract-level NatSpec for what this approves and why
    // ---------------------------------------------------------------------

    /// @inheritdoc ILPRouter
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (approvedProfileHash[hash]) return ERC1271_MAGIC_VALUE;

        (ActionContext memory ctx,) = abi.decode(signature, (ActionContext, bytes));
        if (DigestLib.digest(ctx) != hash) return BAD_VALUE;
        if (ctx.economics.lp != address(this)) return BAD_VALUE;

        address derived = TermsLib.deriveAccount(
            ctx.implementation, ctx.economics, ctx.pointers, ctx.homeChainId, ctx.positionManager, ctx.positionId
        );
        if (derived != ctx.account) return BAD_VALUE;
        if (ctx.actionKind != ActionKind.SettleToLp) return BAD_VALUE;
        if (accountOf[ctx.positionId] == address(0)) return BAD_VALUE;

        return ERC1271_MAGIC_VALUE;
    }

    // ---------------------------------------------------------------------
    // Required to receive the NFT `PositionManager._safeMint` sends this router mid-mint,
    // before it is forwarded to the real taker in the same transaction.
    // ---------------------------------------------------------------------

    /// @notice Always accepts — the NFT never remains here past the end of `matchAndMint`.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
