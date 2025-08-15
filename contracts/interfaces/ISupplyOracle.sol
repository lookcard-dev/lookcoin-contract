// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ISupplyOracle
 * @dev Interface for the SupplyOracle contract
 * @notice Manages cross-chain token supply tracking and consistency
 */
interface ISupplyOracle {
    // Events
    event SupplyUpdated(uint256 chainId, uint256 supply, uint256 timestamp);
    event ReconciliationCompleted(uint256 totalSupply);
    event SupplyDeviationDetected(uint256 deviation);

    // Core functions
    function updateSupply(
        uint256 chainId,
        uint256 supply,
        uint256 timestamp,
        uint256 nonce,
        bytes[] memory signatures
    ) external;

    function totalSupplyAcrossChains() external view returns (uint256);
    function getChainSupply(uint256 chainId) external view returns (uint256);
    function forceReconcile() external;
    function addOracleOperator(address operator) external;
    function removeOracleOperator(address operator) external;
    function isOracleOperator(address operator) external view returns (bool);

    // Custom errors
    error SupplyManipulationDetected();
    error DoubleSpendPrevented();
    error InvalidOracleSignature();
    error ReconciliationFailed();
    error UnauthorizedOperator();
}