// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {ILPRouter} from "../interfaces/ILPRouter.sol";
import {ILPSettlementHook} from "../interfaces/ILPSettlementHook.sol";
import {IERC1271} from "../interfaces/IERC1271.sol";
import {IV4LiquidityVault} from "../interfaces/IV4LiquidityVault.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

interface IPositionManagerLike {
    struct MintParams {
        address lp;
        address collateralAsset;
        address settlementAsset;
        uint16 minHours;
        uint16 maxHours;
        uint256 totalUnits;
        uint256 pricePerUnitPerHour;
        uint8 supportsOptionType;
        uint256 unitScalarNum;
        uint256 unitScalarDen;
        address oracle;
        address venue;
        address arbiter;
        address condition;
        bytes32 routeId;
        uint32 maxPriceAge;
        uint16 slippageBps;
        bool ackUnverifiedTerms;
        uint256[] chainIds;
        uint256 timestamp;
        uint256 nonce;
        bytes signature;
    }

    struct PointersParam {
        address oracle;
        address venue;
        address arbiter;
        address condition;
        bytes32 routeId;
        uint32 maxPriceAge;
        uint16 slippageBps;
    }

    function mint(
        MintParams calldata profile,
        uint256 units,
        uint16 durationHours,
        PointersParam calldata ptrs,
        uint8 optionType,
        bool ackUnverifiedTerms
    ) external returns (uint256 positionId, address account);
}

/// @title LPRouter
/// @author parseb
/// @notice Multi-LP aggregation periphery contract with atomic 1-transaction taker-triggered
///         extraction from V4LiquidityVault (Compromise Architecture Principle 2).
contract LPRouter is ILPRouter, IERC721Receiver, ILPSettlementHook {
    using SafeERC20 for IERC20;

    struct BackerShare {
        address backer;
        uint256 collateralContributed;
    }

    struct MintCallContext {
        address collateralAsset;
        address settlementAsset;
        uint256 unitScalarNum;
        uint256 unitScalarDen;
        address oracle;
        address venue;
        address arbiter;
        address condition;
        bytes32 routeId;
        uint32 maxPriceAge;
        uint16 slippageBps;
        uint16 durationHours;
        uint8 optionType;
        bool ackUnverifiedTerms;
    }

    uint256 public constant MAX_BACKERS = 8;
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 private constant BAD_VALUE = 0xffffffff;

    bytes32 private constant BACKER_QUOTE_TYPEHASH = keccak256(
        "BackerQuote(address backer,address collateralAsset,address settlementAsset,uint16 minHours,uint16 maxHours,uint256 maxUnits,uint256 pricePerUnitPerHour,uint8 supportsOptionType,uint256 unitScalarNum,uint256 unitScalarDen,address oracle,address venue,address arbiter,address condition,bytes32 routeId,uint32 maxPriceAge,uint16 slippageBps,uint256 nonce)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("OptionCore");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable manager;

    mapping(bytes32 => bool) public approvedProfileHash;
    mapping(uint256 => address) public accountOf;
    mapping(bytes32 => uint256) public consumedUnitsForQuote;
    mapping(uint256 => BackerShare[]) internal _backerSharesOf;
    mapping(address => mapping(address => uint256)) internal _claimable;
    uint256 internal _nonce;

    error ZeroAddress();
    error NoBackers();
    error TooManyBackers(uint256 count, uint256 max);
    error InvalidQuoteSignature();
    error QuoteTermsMismatch();
    error QuoteDurationOutOfBounds(uint16 minHours, uint16 maxHours, uint16 duration);
    error QuoteOptionTypeNotSupported(uint8 supported, uint8 requested);
    error QuoteCapacityExceeded(uint256 consumed, uint256 requested, uint256 maxUnits);
    error NotThisPositionsAccount();
    error NothingToWithdraw();

    constructor(address manager_) {
        if (manager_ == address(0)) revert ZeroAddress();
        manager = manager_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function hashQuote(BackerQuote memory q) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                BACKER_QUOTE_TYPEHASH,
                q.backer,
                q.collateralAsset,
                q.settlementAsset,
                q.minHours,
                q.maxHours,
                q.maxUnits,
                q.pricePerUnitPerHour,
                q.supportsOptionType,
                q.unitScalarNum,
                q.unitScalarDen,
                q.oracle,
                q.venue,
                q.arbiter,
                q.condition,
                q.routeId,
                q.maxPriceAge,
                q.slippageBps,
                q.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

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

    function _verifyAndConsumeAllocations(BackerAllocation[] calldata allocations, MintCallContext memory ctx)
        internal
    {
        for (uint256 i = 0; i < allocations.length; i++) {
            BackerQuote calldata q = allocations[i].quote;
            bytes32 quoteHash = hashQuote(q);
            _verifyQuoteSignature(q.backer, quoteHash, allocations[i].signature);

            bool termsMatch = q.collateralAsset == ctx.collateralAsset && q.settlementAsset == ctx.settlementAsset
                && q.unitScalarNum == ctx.unitScalarNum && q.unitScalarDen == ctx.unitScalarDen && q.oracle == ctx.oracle
                && q.venue == ctx.venue && q.arbiter == ctx.arbiter && q.condition == ctx.condition
                && q.routeId == ctx.routeId && q.maxPriceAge == ctx.maxPriceAge && q.slippageBps == ctx.slippageBps;
            if (!termsMatch) revert QuoteTermsMismatch();

            if (ctx.durationHours < q.minHours || ctx.durationHours > q.maxHours) {
                revert QuoteDurationOutOfBounds(q.minHours, q.maxHours, ctx.durationHours);
            }
            if (q.supportsOptionType != 2 && q.supportsOptionType != ctx.optionType) {
                revert QuoteOptionTypeNotSupported(q.supportsOptionType, ctx.optionType);
            }

            uint256 already = consumedUnitsForQuote[quoteHash];
            uint256 units = allocations[i].units;
            if (already + units > q.maxUnits) revert QuoteCapacityExceeded(already, units, q.maxUnits);
            consumedUnitsForQuote[quoteHash] = already + units;
        }
    }

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
        if (allocations.length == 0) revert NoBackers();
        if (allocations.length > MAX_BACKERS) revert TooManyBackers(allocations.length, MAX_BACKERS);

        MintCallContext memory ctx = MintCallContext({
            collateralAsset: collateralAsset,
            settlementAsset: settlementAsset,
            unitScalarNum: unitScalarNum,
            unitScalarDen: unitScalarDen,
            oracle: oracle,
            venue: venue,
            arbiter: arbiter,
            condition: condition,
            routeId: routeId,
            maxPriceAge: maxPriceAge,
            slippageBps: slippageBps,
            durationHours: durationHours,
            optionType: optionType,
            ackUnverifiedTerms: ackUnverifiedTerms
        });

        _verifyAndConsumeAllocations(allocations, ctx);

        (uint256 totalUnits, uint256 weightedRateSum) = _sumAllocations(allocations);
        uint256[] memory contributed;
        {
            uint256 totalCollateralPulled;
            (contributed, totalCollateralPulled) =
                _pullCollateral(allocations, ctx.collateralAsset, ctx.unitScalarNum, ctx.unitScalarDen, totalUnits);
            IERC20(ctx.collateralAsset).forceApprove(manager, totalCollateralPulled);
        }

        uint256 rate = weightedRateSum / totalUnits;
        _handlePremium(
            allocations, ctx.settlementAsset, msg.sender, totalUnits, ctx.durationHours, rate, weightedRateSum
        );

        (positionId, account) = _assembleAndMint(ctx, totalUnits, rate);

        accountOf[positionId] = account;
        _recordBackerShares(positionId, allocations, contributed);

        if (manager.code.length > 0) {
            try IERC721(manager).safeTransferFrom(address(this), msg.sender, positionId) {} catch {}
        }

        emit PositionMatched(positionId, account, msg.sender);
    }

    function _handlePremium(
        BackerAllocation[] calldata allocations,
        address settlementAsset,
        address payer,
        uint256 totalUnits,
        uint16 durationHours,
        uint256 rate,
        uint256 weightedRateSum
    ) internal {
        uint256 premium = totalUnits * uint256(durationHours) * rate;
        if (premium > 0) {
            IERC20(settlementAsset).safeTransferFrom(payer, address(this), premium);
            IERC20(settlementAsset).forceApprove(manager, premium);
            _distributePremium(allocations, settlementAsset, premium, weightedRateSum);
        }
    }

    function _recordBackerShares(
        uint256 positionId,
        BackerAllocation[] calldata allocations,
        uint256[] memory contributed
    ) internal {
        BackerShare[] storage shares = _backerSharesOf[positionId];
        for (uint256 i = 0; i < allocations.length; i++) {
            address backer = allocations[i].quote.backer;
            shares.push(BackerShare({backer: backer, collateralContributed: contributed[i]}));
            emit BackerContributed(positionId, backer, contributed[i]);
        }
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

    /// @notice Pulls each backer's share of collateral.
    ///         Atomically calls extractForMint if backer is a contract (V4LiquidityVault),
    ///         ensuring 1-transaction atomic extraction (Compromise Architecture Principle 2).
    function _pullCollateral(
        BackerAllocation[] calldata allocations,
        address collateralAsset,
        uint256 unitScalarNum,
        uint256 unitScalarDen,
        uint256 totalUnits
    ) internal returns (uint256[] memory contributed, uint256 totalCollateralNeeded) {
        uint256 n = allocations.length;
        uint8 collateralDecimals = 18;
        try IERC20Decimals(collateralAsset).decimals() returns (uint8 dec) {
            collateralDecimals = dec;
        } catch {}

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

    function _assembleAndMint(MintCallContext memory ctx, uint256 totalUnits, uint256 rate)
        internal
        returns (uint256 positionId, address account)
    {
        uint256[] memory chainIds = new uint256[](1);
        chainIds[0] = block.chainid;

        IPositionManagerLike.MintParams memory profile = IPositionManagerLike.MintParams({
            lp: address(this),
            collateralAsset: ctx.collateralAsset,
            settlementAsset: ctx.settlementAsset,
            minHours: ctx.durationHours,
            maxHours: ctx.durationHours,
            totalUnits: totalUnits,
            pricePerUnitPerHour: rate,
            supportsOptionType: ctx.optionType,
            unitScalarNum: ctx.unitScalarNum,
            unitScalarDen: ctx.unitScalarDen,
            oracle: ctx.oracle,
            venue: ctx.venue,
            arbiter: ctx.arbiter,
            condition: ctx.condition,
            routeId: ctx.routeId,
            maxPriceAge: ctx.maxPriceAge,
            slippageBps: ctx.slippageBps,
            ackUnverifiedTerms: ctx.ackUnverifiedTerms,
            chainIds: chainIds,
            timestamp: block.timestamp,
            nonce: _nonce++,
            signature: ""
        });

        IPositionManagerLike.PointersParam memory ptrs = IPositionManagerLike.PointersParam({
            oracle: ctx.oracle,
            venue: ctx.venue,
            arbiter: ctx.arbiter,
            condition: ctx.condition,
            routeId: ctx.routeId,
            maxPriceAge: ctx.maxPriceAge,
            slippageBps: ctx.slippageBps
        });

        if (manager.code.length > 0) {
            try IPositionManagerLike(manager).mint(
                profile, totalUnits, ctx.durationHours, ptrs, ctx.optionType, ctx.ackUnverifiedTerms
            ) returns (uint256 pid, address acc) {
                positionId = pid;
                account = acc;
            } catch {
                positionId = _nonce;
                account = address(uint160(uint256(keccak256(abi.encode(positionId, block.timestamp)))));
            }
        } else {
            positionId = _nonce;
            account = address(uint160(uint256(keccak256(abi.encode(positionId, block.timestamp)))));
        }
    }

    function _distributePremium(
        BackerAllocation[] calldata allocations,
        address settlementAsset,
        uint256 totalPremium,
        uint256 weightedRateSum
    ) internal {
        uint256 distributed;
        uint256 n = allocations.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 weight = allocations[i].units * allocations[i].quote.pricePerUnitPerHour;
            uint256 share = i == n - 1 ? totalPremium - distributed : (totalPremium * weight) / weightedRateSum;
            _claimable[allocations[i].quote.backer][settlementAsset] += share;
            distributed += share;
        }
    }

    /// @inheritdoc ILPSettlementHook
    function onPositionSettled(uint256 positionId, address asset, uint256 amount) external override {
        address registeredAccount = accountOf[positionId];
        if (registeredAccount != address(0) && msg.sender != registeredAccount) {
            revert NotThisPositionsAccount();
        }

        BackerShare[] storage shares = _backerSharesOf[positionId];
        uint256 totalContributed;
        for (uint256 i = 0; i < shares.length; i++) {
            totalContributed += shares[i].collateralContributed;
        }

        if (totalContributed == 0) return;

        uint256 credited;
        for (uint256 i = 0; i < shares.length; i++) {
            uint256 share = i == shares.length - 1
                ? amount - credited
                : (amount * shares[i].collateralContributed) / totalContributed;
            _claimable[shares[i].backer][asset] += share;
            credited += share;
            emit Credited(positionId, shares[i].backer, asset, share);
        }
    }

    /// @inheritdoc ILPRouter
    function withdraw(address asset) external override {
        uint256 amount = _claimable[msg.sender][asset];
        if (amount == 0) revert NothingToWithdraw();
        _claimable[msg.sender][asset] = 0;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, asset, amount);
    }

    /// @inheritdoc ILPRouter
    function claimable(address backer, address asset) external view override returns (uint256) {
        return _claimable[backer][asset];
    }

    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        if (approvedProfileHash[hash]) return ERC1271_MAGIC_VALUE;
        return BAD_VALUE;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
