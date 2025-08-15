// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IFeeManager
 * @dev Interface for the FeeManager contract
 * @notice Manages fee calculations and collection for bridge operations
 */
interface IFeeManager {
    // Fee structure
    struct FeeConfig {
        uint256 baseFee;
        uint256 percentageFee;
        uint256 minFee;
        uint256 maxFee;
    }

    // Events
    event FeeCollected(address from, uint256 amount, uint256 chainId);
    event FeeConfigUpdated(uint256 chainId, FeeConfig config);
    event FeeExemptionGranted(address account);

    // Core functions
    function calculateFee(
        uint256 amount,
        uint256 destinationChain,
        uint8 protocol
    ) external view returns (uint256);

    function collectFee(
        address from,
        uint256 amount,
        uint256 destinationChain
    ) external returns (uint256);

    function setFeeConfig(uint256 chainId, FeeConfig memory config) external;
    function getFeeConfig(uint256 chainId) external view returns (FeeConfig memory);
    function withdrawFees(address recipient, uint256 amount) external;
    function isExempt(address account) external view returns (bool);
    function setExemption(address account, bool exempt) external;

    // Custom errors
    error FeeManipulationDetected();
    error InsufficientFee();
    error FeeExceedsMaximum();
    error UnauthorizedFeeChange();
}