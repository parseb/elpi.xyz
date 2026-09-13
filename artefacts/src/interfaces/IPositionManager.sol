// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LiquidityProfile} from "../types/LiquidityProfile.sol";
import {Economics} from "../types/Economics.sol";
import {Pointers} from "../types/Pointers.sol";

interface IPositionManager {
    event PositionMinted(uint256 indexed positionId, address indexed account, Economics economics, Pointers pointers);
    event CommitmentReduced(bytes32 indexed profileHash, uint256 previousTotalUnits, uint256 newTotalUnits);

    error BelowConsumedUnits(uint256 consumedUnits, uint256 attemptedNewTotalUnits);
    error CapacityExceeded(uint256 consumedUnits, uint256 requestedUnits, uint256 totalUnits);
    error ChainNotAuthorized(uint256 chainId);
    error DurationOutOfBounds(uint16 minHours, uint16 maxHours, uint16 requested);
    error InvalidOptionType(uint8 optionType);
    error InvalidProfileSignature();
    error NotNarrowing(uint256 currentTotalUnits, uint256 attemptedNewTotalUnits);
    error NotProfileOwner();
    error OptionTypeNotSupported(uint8 supportsOptionType, uint8 requested);
    error PointersMismatch();
    error PriceAgeBelowCadence(uint32 maxPriceAge, uint32 cadenceHint);
    error PriceNotFresh();
    error ProfileInvalidated();
    error ProfileOwnerNotRecorded();
    error UnverifiedTermsNotAcknowledged();

    function FEE_BPS() external view returns (uint16);
    function consumedUnits(bytes32 profileHash) external view returns (uint256);
    function signerEpochOf(uint256 positionId) external view returns (uint256);
    function profileOwnerOf(bytes32 profileHash) external view returns (address);
    function mint(
        LiquidityProfile calldata profile,
        uint256 units,
        uint16 durationHours,
        Pointers calldata pointers,
        uint8 optionType,
        bool ackUnverifiedTerms
    ) external returns (uint256 positionId, address account);
    function reduceCommitment(bytes32 profileHash, uint256 newTotalUnits) external;
    function invalidateProfile(LiquidityProfile calldata profile) external;
    function setProfileDelegate(address delegate) external;
    function safeAccountState(address account) external view returns (bool deployed, uint256 state);
}
