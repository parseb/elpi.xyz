// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Libraries
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TermsLib} from "./libraries/TermsLib.sol";

// Types
import {LiquidityProfile} from "./types/LiquidityProfile.sol";
import {Economics} from "./types/Economics.sol";
import {Pointers} from "./types/Pointers.sol";

// Interfaces
import {IPositionManager} from "./interfaces/IPositionManager.sol";
import {IPositionAccountMintHooks} from "./interfaces/IPositionAccountMintHooks.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {ISettlementVenue} from "./interfaces/ISettlementVenue.sol";
import {IERC1271} from "./interfaces/IERC1271.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Real, deployed ERC-6551 Registry `createAccount()` — the subset of
///         `IERC6551Registry` this contract needs. Same registry `TermsLib.REGISTRY` names.
interface IERC6551RegistryCreate {
    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        returns (address);
}

interface IERC20Decimals {
    /// @notice Queried and pinned at mint, never assumed (§3.6 step 5).
    function decimals() external view returns (uint8);
}

/// @title PositionManager
/// @author parseb
/// @notice The ERC-721 position ledger and mint entry point (ARCHITECTURE.md §3.6). Holds
///         no custody, no settlement math, and no global per-asset mappings — one
///         `PositionAccount` per position does that.
/// @dev The only address constant is (transitively, via `TermsLib`) the ERC-6551 registry —
///      `positionAccountImplementation` is a constructor parameter, not hardcoded, matching
///      "version per mint" (§1.4): a future deployment could point at a newer implementation
///      without touching this contract's code.
contract PositionManager is IPositionManager, ERC721 {
    using SafeERC20 for IERC20;

    /// @inheritdoc IPositionManager
    uint16 public constant FEE_BPS = 100; // 1% (I4) — fixed, not LP- or admin-configurable.
    uint16 private constant MAX_SLIPPAGE_BPS = 500;
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    bytes32 private constant LIQUIDITY_PROFILE_TYPEHASH = keccak256(
        "LiquidityProfile(address lp,address collateralAsset,address settlementAsset,uint16 minHours,uint16 maxHours,uint256 totalUnits,uint256 pricePerUnitPerHour,uint8 supportsOptionType,uint256 unitScalarNum,uint256 unitScalarDen,address oracle,address venue,address arbiter,address condition,bytes32 routeId,uint32 maxPriceAge,uint16 slippageBps,bool ackUnverifiedTerms,uint256[] chainIds,uint256 timestamp,uint256 nonce)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("OptionCore");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable positionAccountImplementation;

    /// @inheritdoc IPositionManager
    mapping(bytes32 => uint256) public consumedUnits;
    /// @inheritdoc IPositionManager
    mapping(uint256 => uint256) public signerEpochOf;
    /// @inheritdoc IPositionManager
    mapping(bytes32 => address) public profileOwnerOf;
    mapping(bytes32 => bool) public invalidatedProfileOf;
    mapping(address => address) public profileDelegateOf;

    /// @dev The profile's `totalUnits` at first use (mint or invalidate), separate from
    ///      `consumedUnits` — `reduceCommitment` narrows THIS value going forward, since the
    ///      original signed profile is never stored and `reduceCommitment` only ever
    ///      receives a hash, not the full profile, on later calls.
    mapping(bytes32 => uint256) public totalUnitsOf;

    uint256 private _nextPositionId = 1;

    error DecimalsQueryFailed();
    error SlippageTooHigh(uint16 slippageBps, uint16 max);
    error ZeroAddress();

    constructor(address positionAccountImplementation_) ERC721("OptionCore Position", "OCP") {
        if (positionAccountImplementation_ == address(0)) revert ZeroAddress();
        positionAccountImplementation = positionAccountImplementation_;
    }

    /// @dev Bumps `signerEpoch` on every real transfer (not the initial mint, where
    ///      `from == address(0)`) — §1.5's replay-protection mechanism for the taker slot.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0)) signerEpochOf[tokenId]++;
    }

    // ---------------------------------------------------------------------
    // EIP-712 profile hashing
    // ---------------------------------------------------------------------

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /// @dev Signature-in-struct-excluded-from-hash (§2.4): `profile.signature` never
    ///      participates here.
    function _hashProfile(LiquidityProfile calldata profile) internal view returns (bytes32) {
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
    // Mint
    // ---------------------------------------------------------------------

    /// @inheritdoc IPositionManager
    function mint(
        LiquidityProfile calldata profile,
        uint256 units,
        uint16 durationHours,
        Pointers calldata pointers,
        uint8 optionType,
        bool ackUnverifiedTerms
    ) external returns (uint256 positionId, address account) {
        bytes32 profileHash = _hashProfile(profile);
        _verifySignature(profile, profileHash);
        _verifyChainAndLifecycle(profile, profileHash);
        uint256 entryPrice = _verifyMintBounds(profile, pointers, durationHours, optionType, ackUnverifiedTerms);
        _consumeCapacity(profile, profileHash, units);

        Economics memory econ = _buildEconomics(profile, units, durationHours, optionType, entryPrice);

        positionId = _nextPositionId++;
        bytes32 salt = TermsLib.termsSalt(econ, pointers);
        account = IERC6551RegistryCreate(TermsLib.REGISTRY).createAccount(
            positionAccountImplementation, salt, block.chainid, address(this), positionId
        );
        _safeMint(msg.sender, positionId);

        _settleMintTransfersAndRecord(profile, pointers, econ, account, units, durationHours, optionType);

        emit PositionMinted(positionId, account, econ, pointers);
    }

    /// @dev ECDSA if `profile.lp` has no code, ERC-1271 otherwise — the identical rule
    ///      `AuthzModule._verify` already applies to every signer slot (§2.2), extended here
    ///      so a contract (e.g. `LPRouter`, §3.9) can be `profile.lp` at all. Before this,
    ///      only `ECDSA.tryRecover` was ever consulted, with no way for a contract address to
    ///      satisfy it.
    function _verifySignature(LiquidityProfile calldata profile, bytes32 profileHash) internal view {
        if (profile.lp.code.length == 0) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(profileHash, profile.signature);
            if (err != ECDSA.RecoverError.NoError || signer != profile.lp) revert InvalidProfileSignature();
            return;
        }
        if (IERC1271(profile.lp).isValidSignature(profileHash, profile.signature) != ERC1271_MAGIC_VALUE) {
            revert InvalidProfileSignature();
        }
    }

    function _verifyChainAndLifecycle(LiquidityProfile calldata profile, bytes32 profileHash) internal view {
        bool authorized = false;
        for (uint256 i = 0; i < profile.chainIds.length; i++) {
            if (profile.chainIds[i] == block.chainid) {
                authorized = true;
                break;
            }
        }
        if (!authorized) revert ChainNotAuthorized(block.chainid);
        if (invalidatedProfileOf[profileHash]) revert ProfileInvalidated();
    }

    /// @dev Returns the fresh, validated price read here so `_buildEconomics` doesn't need a
    ///      second `oracle.price()` call for the same value in the same transaction.
    function _verifyMintBounds(
        LiquidityProfile calldata profile,
        Pointers calldata pointers,
        uint16 durationHours,
        uint8 optionType,
        bool ackUnverifiedTerms
    ) internal view returns (uint256 price) {
        if (durationHours < profile.minHours || durationHours > profile.maxHours) {
            revert DurationOutOfBounds(profile.minHours, profile.maxHours, durationHours);
        }
        if (optionType != 0 && optionType != 1) revert InvalidOptionType(optionType);
        if (profile.supportsOptionType != 2 && profile.supportsOptionType != optionType) {
            revert OptionTypeNotSupported(profile.supportsOptionType, optionType);
        }
        _verifyPointersMatch(profile, pointers);
        if (profile.ackUnverifiedTerms && !ackUnverifiedTerms) revert UnverifiedTermsNotAcknowledged();
        if (pointers.slippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(pointers.slippageBps, MAX_SLIPPAGE_BPS);

        uint256 updatedAt;
        (price, updatedAt) = IPriceOracle(pointers.oracle).price(profile.collateralAsset, profile.settlementAsset);
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > pointers.maxPriceAge) revert PriceNotFresh();

        uint32 cadenceHint = IPriceOracle(pointers.oracle).cadenceHint();
        if (pointers.maxPriceAge < cadenceHint) revert PriceAgeBelowCadence(pointers.maxPriceAge, cadenceHint);
    }

    function _verifyPointersMatch(LiquidityProfile calldata profile, Pointers calldata pointers) internal pure {
        bool matches = pointers.oracle == profile.oracle && pointers.venue == profile.venue
            && pointers.arbiter == profile.arbiter && pointers.condition == profile.condition
            && pointers.routeId == profile.routeId && pointers.maxPriceAge == profile.maxPriceAge
            && pointers.slippageBps == profile.slippageBps;
        if (!matches) revert PointersMismatch();
    }

    function _consumeCapacity(LiquidityProfile calldata profile, bytes32 profileHash, uint256 units) internal {
        if (profileOwnerOf[profileHash] == address(0)) {
            profileOwnerOf[profileHash] = profile.lp;
            totalUnitsOf[profileHash] = profile.totalUnits;
        }
        uint256 currentTotal = totalUnitsOf[profileHash];
        uint256 already = consumedUnits[profileHash];
        uint256 newConsumed = already + units;
        if (newConsumed > currentTotal) revert CapacityExceeded(already, units, currentTotal);
        consumedUnits[profileHash] = newConsumed;
    }

    /// @dev `entryPrice` is passed in from `_verifyMintBounds`'s own oracle read rather than
    ///      re-reading `oracle.price()` a second time in the same transaction for the same
    ///      value.
    function _buildEconomics(
        LiquidityProfile calldata profile,
        uint256 units,
        uint16 durationHours,
        uint8 optionType,
        uint256 entryPrice
    ) internal view returns (Economics memory econ) {
        econ.lp = profile.lp;
        econ.collateralAsset = profile.collateralAsset;
        econ.collateralDecimals = _queryDecimals(profile.collateralAsset);
        econ.settlementAsset = profile.settlementAsset;
        econ.settlementDecimals = _queryDecimals(profile.settlementAsset);
        econ.optionType = optionType;
        econ.units = units;
        econ.unitScalarNum = profile.unitScalarNum;
        econ.unitScalarDen = profile.unitScalarDen;
        econ.entryPrice = entryPrice;
        econ.expiry = uint64(block.timestamp + uint256(durationHours) * 1 hours);
        econ.feeBps = FEE_BPS;
    }

    /// @dev staticcall + explicit success/length check (§3.3: "queried, never assumed") —
    ///      a plain interface call would instead revert with an opaque ABI-decode panic on a
    ///      token lacking `decimals()`, never the declared `DecimalsQueryFailed`.
    function _queryDecimals(address token) internal view returns (uint8) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!success || data.length < 32) revert DecimalsQueryFailed();
        return abi.decode(data, (uint8));
    }

    /// @dev Pulls LP collateral (recorded as `balanceAfter - balanceBefore`, §1.5/§3.6 step
    ///      10), pulls the taker's premium directly to the LP (never entering the account,
    ///      §3.6), then either records a CALL directly or performs the PUT creation swap
    ///      with an oracle-derived `minAmountOut` (§3.4 — never zero, never venue spot).
    function _settleMintTransfersAndRecord(
        LiquidityProfile calldata profile,
        Pointers calldata pointers,
        Economics memory econ,
        address account,
        uint256 units,
        uint16 durationHours,
        uint8 optionType
    ) internal {
        uint256 collateralAmount = (units * profile.unitScalarNum * (10 ** econ.collateralDecimals)) / profile.unitScalarDen;
        uint256 balBefore = IERC20(profile.collateralAsset).balanceOf(account);
        IERC20(profile.collateralAsset).safeTransferFrom(profile.lp, account, collateralAmount);
        uint256 recordedCollateral = IERC20(profile.collateralAsset).balanceOf(account) - balBefore;

        uint256 premium = units * uint256(durationHours) * profile.pricePerUnitPerHour;
        IERC20(profile.settlementAsset).safeTransferFrom(msg.sender, profile.lp, premium);

        if (optionType == 0) {
            IPositionAccountMintHooks(account).recordMint(recordedCollateral, 0);
        } else {
            uint256 minAmountOut = _expectedSwapOutput(recordedCollateral, econ, pointers.slippageBps);
            IPositionAccountMintHooks(account).initialSwapAndRecord(
                profile.collateralAsset,
                profile.settlementAsset,
                recordedCollateral,
                minAmountOut,
                block.timestamp + 1 hours,
                pointers.routeId,
                pointers.venue
            );
        }
    }

    /// @dev Oracle-derived expected output, minus `slippageBps` tolerance — §3.4's rule
    ///      applies at mint's PUT creation swap exactly as it does at settlement.
    function _expectedSwapOutput(uint256 amountIn, Economics memory econ, uint16 slippageBps)
        internal
        pure
        returns (uint256)
    {
        uint256 expectedOut =
            (amountIn * econ.entryPrice * (10 ** econ.settlementDecimals)) / ((10 ** econ.collateralDecimals) * 1e18);
        return (expectedOut * (10_000 - slippageBps)) / 10_000;
    }

    // ---------------------------------------------------------------------
    // Profile lifecycle
    // ---------------------------------------------------------------------

    /// @inheritdoc IPositionManager
    function reduceCommitment(bytes32 profileHash, uint256 newTotalUnits) external {
        address owner = profileOwnerOf[profileHash];
        if (owner == address(0)) revert ProfileOwnerNotRecorded();
        if (msg.sender != owner && msg.sender != profileDelegateOf[owner]) revert NotProfileOwner();

        uint256 currentTotal = totalUnitsOf[profileHash];
        if (newTotalUnits >= currentTotal) revert NotNarrowing(currentTotal, newTotalUnits);
        uint256 consumed = consumedUnits[profileHash];
        if (newTotalUnits < consumed) revert BelowConsumedUnits(consumed, newTotalUnits);

        totalUnitsOf[profileHash] = newTotalUnits;
        emit CommitmentReduced(profileHash, currentTotal, newTotalUnits);
    }

    /// @inheritdoc IPositionManager
    function invalidateProfile(LiquidityProfile calldata profile) external {
        bytes32 profileHash = _hashProfile(profile);
        _verifySignature(profile, profileHash);
        if (msg.sender != profile.lp && msg.sender != profileDelegateOf[profile.lp]) revert NotProfileOwner();

        invalidatedProfileOf[profileHash] = true;
        if (profileOwnerOf[profileHash] == address(0)) {
            profileOwnerOf[profileHash] = profile.lp;
            totalUnitsOf[profileHash] = profile.totalUnits;
        }
    }

    /// @inheritdoc IPositionManager
    function setProfileDelegate(address delegate) external {
        profileDelegateOf[msg.sender] = delegate;
    }

    // ---------------------------------------------------------------------
    // Safe account introspection
    // ---------------------------------------------------------------------

    /// @inheritdoc IPositionManager
    /// @dev Checks `account.code.length` before calling `accountState()` so callers receive
    ///      `(false, 0)` during the counterfactual window (between mint and first settlement)
    ///      instead of a low-level revert. Uses a minimal inline interface cast rather than
    ///      importing the full `IPositionAccount` (which carries `ActionContext` + `SlotApproval`)
    ///      — all we need is the `accountState()` public getter that every `PositionAccount`
    ///      exposes (it is a plain public `uint256` storage variable).
    function safeAccountState(address account) external view returns (bool deployed, uint256 state) {
        deployed = account.code.length > 0;
        if (deployed) {
            // `accountState` is a `public uint256` on PositionAccount — the Solidity-generated
            // getter's selector is keccak256("accountState()")[0:4] = 0x6f1ae108.
            (bool ok, bytes memory data) = account.staticcall(abi.encodeWithSelector(0x6f1ae108));
            if (ok && data.length >= 32) state = abi.decode(data, (uint256));
        }
    }
}
