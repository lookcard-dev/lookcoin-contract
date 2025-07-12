// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RateLimiter
 * @dev Abstract contract implementing sliding window rate limiting for fintech-grade security
 */
abstract contract RateLimiter is Ownable {
    // Rate limit configuration
    struct RateLimitConfig {
        uint256 windowDuration; // Duration of the sliding window in seconds
        uint256 maxTokensPerWindow; // Maximum tokens allowed per window
        uint256 maxTxPerWindow; // Maximum transactions allowed per window
        bool enabled; // Whether rate limiting is enabled
    }

    // Rate limit data for tracking usage
    struct RateLimitData {
        uint256 tokensUsed; // Tokens transferred in current window
        uint256 txCount; // Transaction count in current window
        uint256 windowStart; // Start timestamp of current window
    }

    // Operation types for different rate limits
    enum OperationType {
        TRANSFER,
        BRIDGE_OUT,
        BRIDGE_IN,
        MINT,
        BURN
    }

    // Rate limit configurations per operation type
    mapping(OperationType => RateLimitConfig) public rateLimitConfigs;

    // User-specific rate limits
    mapping(address => mapping(OperationType => RateLimitData))
        public userRateLimits;

    // Global rate limits
    mapping(OperationType => RateLimitData) public globalRateLimits;

    // User tiers for different rate limits
    mapping(address => uint8) public userTiers;
    mapping(uint8 => uint256) public tierMultipliers; // Basis points (10000 = 100%)

    // Emergency override
    mapping(address => bool) public rateLimitExempt;

    // Events
    event RateLimitConfigured(
        OperationType indexed opType,
        uint256 windowDuration,
        uint256 maxTokens,
        uint256 maxTx
    );
    event RateLimitExceeded(
        address indexed user,
        OperationType indexed opType,
        uint256 attemptedAmount
    );
    event UserTierUpdated(address indexed user, uint8 tier);
    event RateLimitExemptionSet(address indexed user, bool exempt);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Check if operation is within rate limits
     * @param user User address
     * @param opType Operation type
     * @param amount Token amount
     */
    function checkRateLimit(
        address user,
        OperationType opType,
        uint256 amount
    ) internal view returns (bool) {
        if (rateLimitExempt[user]) return true;

        RateLimitConfig memory config = rateLimitConfigs[opType];
        if (!config.enabled) return true;

        uint256 currentTime = block.timestamp;

        // Check user rate limit
        RateLimitData memory userData = userRateLimits[user][opType];
        if (
            !_isWithinLimit(
                userData,
                config,
                amount,
                currentTime,
                userTiers[user]
            )
        ) {
            return false;
        }

        // Check global rate limit
        RateLimitData memory globalData = globalRateLimits[opType];
        if (!_isWithinLimit(globalData, config, amount, currentTime, 0)) {
            return false;
        }

        return true;
    }

    /**
     * @dev Update rate limit usage
     * @param user User address
     * @param opType Operation type
     * @param amount Token amount
     */
    function updateRateLimit(
        address user,
        OperationType opType,
        uint256 amount
    ) internal {
        if (rateLimitExempt[user]) return;

        RateLimitConfig memory config = rateLimitConfigs[opType];
        if (!config.enabled) return;

        uint256 currentTime = block.timestamp;

        // Update user rate limit
        _updateLimitData(
            userRateLimits[user][opType],
            config,
            amount,
            currentTime
        );

        // Update global rate limit
        _updateLimitData(globalRateLimits[opType], config, amount, currentTime);
    }

    /**
     * @dev Set rate limit configuration
     * @param opType Operation type
     * @param windowDuration Window duration in seconds
     * @param maxTokens Maximum tokens per window
     * @param maxTx Maximum transactions per window
     * @param enabled Whether rate limiting is enabled
     */
    function setRateLimitConfig(
        OperationType opType,
        uint256 windowDuration,
        uint256 maxTokens,
        uint256 maxTx,
        bool enabled
    ) external onlyOwner {
        require(windowDuration > 0, "RateLimiter: invalid window duration");

        rateLimitConfigs[opType] = RateLimitConfig({
            windowDuration: windowDuration,
            maxTokensPerWindow: maxTokens,
            maxTxPerWindow: maxTx,
            enabled: enabled
        });

        emit RateLimitConfigured(opType, windowDuration, maxTokens, maxTx);
    }

    /**
     * @dev Set user tier
     * @param user User address
     * @param tier Tier level
     */
    function setUserTier(address user, uint8 tier) external onlyOwner {
        require(tier <= 10, "RateLimiter: invalid tier");
        userTiers[user] = tier;
        emit UserTierUpdated(user, tier);
    }

    /**
     * @dev Set tier multiplier
     * @param tier Tier level
     * @param multiplier Multiplier in basis points
     */
    function setTierMultiplier(
        uint8 tier,
        uint256 multiplier
    ) external onlyOwner {
        require(tier <= 10, "RateLimiter: invalid tier");
        require(multiplier >= 10000, "RateLimiter: multiplier too low"); // At least 100%
        tierMultipliers[tier] = multiplier;
    }

    /**
     * @dev Set rate limit exemption
     * @param user User address
     * @param exempt Exemption status
     */
    function setRateLimitExemption(
        address user,
        bool exempt
    ) external onlyOwner {
        rateLimitExempt[user] = exempt;
        emit RateLimitExemptionSet(user, exempt);
    }

    /**
     * @dev Get remaining capacity for user
     * @param user User address
     * @param opType Operation type
     * @return remainingTokens Remaining token capacity
     * @return remainingTx Remaining transaction capacity
     */
    function getRemainingCapacity(
        address user,
        OperationType opType
    ) external view returns (uint256 remainingTokens, uint256 remainingTx) {
        if (rateLimitExempt[user]) {
            return (type(uint256).max, type(uint256).max);
        }

        RateLimitConfig memory config = rateLimitConfigs[opType];
        if (!config.enabled) {
            return (type(uint256).max, type(uint256).max);
        }

        uint256 currentTime = block.timestamp;
        RateLimitData memory userData = userRateLimits[user][opType];

        if (currentTime > userData.windowStart + config.windowDuration) {
            // New window
            uint256 userMaxTokens = _getUserMaxTokens(
                config.maxTokensPerWindow,
                userTiers[user]
            );
            return (userMaxTokens, config.maxTxPerWindow);
        } else {
            // Current window
            uint256 userMaxTokens = _getUserMaxTokens(
                config.maxTokensPerWindow,
                userTiers[user]
            );
            remainingTokens = userMaxTokens > userData.tokensUsed
                ? userMaxTokens - userData.tokensUsed
                : 0;
            remainingTx = config.maxTxPerWindow > userData.txCount
                ? config.maxTxPerWindow - userData.txCount
                : 0;
        }
    }

    /**
     * @dev Check if operation is within limit
     */
    function _isWithinLimit(
        RateLimitData memory data,
        RateLimitConfig memory config,
        uint256 amount,
        uint256 currentTime,
        uint8 tier
    ) private view returns (bool) {
        if (currentTime > data.windowStart + config.windowDuration) {
            // New window - only check if amount exceeds single tx limit
            uint256 maxTokens = _getUserMaxTokens(
                config.maxTokensPerWindow,
                tier
            );
            return amount <= maxTokens;
        } else {
            // Current window - check cumulative limits
            uint256 maxTokens = _getUserMaxTokens(
                config.maxTokensPerWindow,
                tier
            );
            return
                data.tokensUsed + amount <= maxTokens &&
                data.txCount + 1 <= config.maxTxPerWindow;
        }
    }

    /**
     * @dev Update limit data
     */
    function _updateLimitData(
        RateLimitData storage data,
        RateLimitConfig memory config,
        uint256 amount,
        uint256 currentTime
    ) private {
        if (currentTime > data.windowStart + config.windowDuration) {
            // Start new window
            data.windowStart = currentTime;
            data.tokensUsed = amount;
            data.txCount = 1;
        } else {
            // Update current window
            data.tokensUsed += amount;
            data.txCount += 1;
        }
    }

    /**
     * @dev Get user's maximum tokens based on tier
     */
    function _getUserMaxTokens(
        uint256 baseMax,
        uint8 tier
    ) private view returns (uint256) {
        if (tier == 0) return baseMax;

        uint256 multiplier = tierMultipliers[tier];
        if (multiplier == 0) multiplier = 10000; // Default 100%

        return (baseMax * multiplier) / 10000;
    }

    /**
     * @dev Modifier to enforce rate limits
     */
    modifier rateLimited(
        address user,
        OperationType opType,
        uint256 amount
    ) {
        require(
            checkRateLimit(user, opType, amount),
            "RateLimiter: rate limit exceeded"
        );
        _;
        updateRateLimit(user, opType, amount);
    }
}
