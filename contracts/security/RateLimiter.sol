// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title RateLimiter
 * @dev Abstract contract that implements a sliding window rate limiting algorithm
 * @notice Enforces rate limits on transactions: 500K tokens per transaction, 3 transactions per hour per account
 */
abstract contract RateLimiter is Initializable {
    // Rate limit parameters
    uint256 public constant MAX_TOKENS_PER_TRANSACTION = 500_000 * 10**18; // 500K tokens
    uint256 public constant MAX_TRANSACTIONS_PER_WINDOW = 3;
    uint256 public constant RATE_LIMIT_WINDOW = 1 hours;
    
    // Per-user transaction tracking
    struct UserTransactionData {
        uint256[] timestamps;    // Timestamps of transactions within the window
        uint256[] amounts;       // Amounts of each transaction
        uint256 windowStart;     // Start of the current sliding window
    }
    
    // Storage
    mapping(address => UserTransactionData) internal _userTransactions;
    bool public rateLimitEnabled;
    
    // Storage gap for upgradeable contracts
    uint256[48] private __gap;
    
    // Events
    event RateLimitExceeded(address indexed user, uint256 amount, string reason);
    event RateLimitStatusChanged(bool enabled);
    
    // Errors
    error TransactionAmountExceedsLimit(uint256 amount, uint256 limit);
    error TransactionCountExceedsLimit(uint256 count, uint256 limit);
    error RateLimitWindowViolation();
    
    /**
     * @dev Initializes the rate limiter
     */
    function __RateLimiter_init() internal onlyInitializing {
        __RateLimiter_init_unchained();
    }
    
    function __RateLimiter_init_unchained() internal onlyInitializing {
        rateLimitEnabled = true;
    }
    
    /**
     * @dev Checks if a transaction violates rate limits
     * @param user The user address attempting the transaction
     * @param amount The amount of tokens in the transaction
     */
    function _checkRateLimit(address user, uint256 amount) internal {
        if (!rateLimitEnabled) {
            return;
        }
        
        // Check per-transaction limit
        if (amount > MAX_TOKENS_PER_TRANSACTION) {
            revert TransactionAmountExceedsLimit(amount, MAX_TOKENS_PER_TRANSACTION);
        }
        
        UserTransactionData storage userData = _userTransactions[user];
        uint256 currentTime = block.timestamp;
        
        // Clean up old transactions outside the window
        _cleanupOldTransactions(userData, currentTime);
        
        // Check transaction count limit
        if (userData.timestamps.length >= MAX_TRANSACTIONS_PER_WINDOW) {
            revert TransactionCountExceedsLimit(
                userData.timestamps.length + 1, 
                MAX_TRANSACTIONS_PER_WINDOW
            );
        }
        
        // Record this transaction
        userData.timestamps.push(currentTime);
        userData.amounts.push(amount);
        
        // Update window start if necessary
        if (userData.windowStart == 0 || currentTime >= userData.windowStart + RATE_LIMIT_WINDOW) {
            userData.windowStart = currentTime;
        }
    }
    
    /**
     * @dev Removes transactions that are outside the current sliding window
     * @param userData The user's transaction data
     * @param currentTime The current block timestamp
     */
    function _cleanupOldTransactions(
        UserTransactionData storage userData,
        uint256 currentTime
    ) private {
        uint256 windowStart = currentTime - RATE_LIMIT_WINDOW;
        
        // Find the index of the first transaction within the window
        uint256 validStartIndex = 0;
        for (uint256 i = 0; i < userData.timestamps.length; i++) {
            if (userData.timestamps[i] >= windowStart) {
                validStartIndex = i;
                break;
            }
        }
        
        // If all transactions are old, clear the arrays
        if (validStartIndex == 0 && userData.timestamps.length > 0 && userData.timestamps[0] < windowStart) {
            delete userData.timestamps;
            delete userData.amounts;
            return;
        }
        
        // If some transactions are old, remove them
        if (validStartIndex > 0) {
            // Shift valid transactions to the beginning
            uint256 validCount = userData.timestamps.length - validStartIndex;
            for (uint256 i = 0; i < validCount; i++) {
                userData.timestamps[i] = userData.timestamps[i + validStartIndex];
                userData.amounts[i] = userData.amounts[i + validStartIndex];
            }
            
            // Remove the remaining elements
            for (uint256 i = userData.timestamps.length - 1; i >= validCount; i--) {
                userData.timestamps.pop();
                userData.amounts.pop();
                if (i == 0) break; // Prevent underflow
            }
        }
    }
    
    /**
     * @dev Gets the current transaction count for a user within the rate limit window
     * @param user The user address to check
     * @return count The number of transactions within the current window
     */
    function getUserTransactionCount(address user) public view returns (uint256 count) {
        UserTransactionData storage userData = _userTransactions[user];
        uint256 currentTime = block.timestamp;
        uint256 windowStart = currentTime - RATE_LIMIT_WINDOW;
        
        count = 0;
        for (uint256 i = 0; i < userData.timestamps.length; i++) {
            if (userData.timestamps[i] >= windowStart) {
                count++;
            }
        }
    }
    
    /**
     * @dev Gets the remaining transaction allowance for a user
     * @param user The user address to check
     * @return remaining The number of transactions the user can still make
     */
    function getRemainingTransactionAllowance(address user) public view returns (uint256 remaining) {
        uint256 currentCount = getUserTransactionCount(user);
        remaining = currentCount >= MAX_TRANSACTIONS_PER_WINDOW ? 0 : MAX_TRANSACTIONS_PER_WINDOW - currentCount;
    }
    
    /**
     * @dev Enables or disables rate limiting
     * @param enabled Whether rate limiting should be enabled
     */
    function _setRateLimitEnabled(bool enabled) internal {
        rateLimitEnabled = enabled;
        emit RateLimitStatusChanged(enabled);
    }
    
    /**
     * @dev Resets rate limit data for a specific user (emergency use only)
     * @param user The user address to reset
     */
    function _resetUserRateLimit(address user) internal {
        delete _userTransactions[user];
    }
}