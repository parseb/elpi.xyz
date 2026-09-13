// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActionContext} from "../types/ActionContext.sol";
import {SlotApproval} from "../types/SlotApproval.sol";

/// @title ILPRouter
/// @author parseb
/// @notice Interface for multi-backer aggregation LPRouter in elpi.xyz.
interface ILPRouter {
    struct BackerQuote {
        address backer;
        address collateralAsset;
        address settlementAsset;
        uint16 minHours;
        uint16 maxHours;
        uint256 maxUnits;
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
        uint256 nonce;
    }

    struct BackerAllocation {
        BackerQuote quote;
        uint256 units;
        bytes signature;
    }

    error InvalidQuoteSignature();
    error NoBackers();
    error TooManyBackers(uint256 count, uint256 max);
    error QuoteTermsMismatch();
    error QuoteDurationOutOfBounds(uint16 minHours, uint16 maxHours, uint16 duration);
    error QuoteOptionTypeNotSupported(uint8 supported, uint8 requested);
    error QuoteCapacityExceeded(uint256 alreadyConsumed, uint256 requesting, uint256 maxUnits);
    error NotThisPositionsAccount();
    error NotThisRoutersPosition();
    error OnlySettleToLpSupported();
    error NothingToWithdraw();
    error ZeroAddress();

    event Credited(uint256 indexed positionId, address indexed backer, address indexed asset, uint256 amount);
    event Withdrawn(address indexed backer, address indexed asset, uint256 amount);
    event PositionMatched(uint256 indexed positionId, address indexed account, address indexed taker);
    event BackerContributed(uint256 indexed positionId, address indexed backer, uint256 amount);

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
    ) external returns (uint256 positionId, address account);

    function settleAndCredit(ActionContext calldata ctx, SlotApproval[] calldata approvals) external;

    function withdraw(address asset) external;

    function claimable(address backer, address asset) external view returns (uint256);

    function backerAllocationsOf(uint256 positionId)
        external
        view
        returns (address[] memory backers, uint256[] memory collateralContributed);

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}
