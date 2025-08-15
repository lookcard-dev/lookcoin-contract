// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IFlashLoanReceiver
 * @dev Interface for contracts that can receive flash loans
 * @notice Implemented by contracts that want to receive flash loan callbacks
 */
interface IFlashLoanReceiver {
    /**
     * @dev Execute operation after receiving flash loan
     * @param amount The amount of tokens received
     * @param fee The fee to be paid back
     * @param params Additional parameters for the operation
     * @return bool indicating success of the operation
     */
    function executeOperation(
        uint256 amount,
        uint256 fee,
        bytes calldata params
    ) external returns (bool);
}

/**
 * @title IFlashLoanProvider
 * @dev Interface for flash loan providers
 * @notice Provides flash loan functionality for testing
 */
interface IFlashLoanProvider {
    /**
     * @dev Initiate a flash loan
     * @param receiver The contract that will receive the loan
     * @param amount The amount to loan
     */
    function flashLoan(address receiver, uint256 amount) external;

    /**
     * @dev Set the token to be used for flash loans
     * @param token The token address
     */
    function setToken(address token) external;

    /**
     * @dev Get the current flash loan fee
     * @return The fee amount in basis points
     */
    function flashLoanFee() external view returns (uint256);
}