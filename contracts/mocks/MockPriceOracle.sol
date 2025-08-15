// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockPriceOracle
 * @author LookCard FinTech Team
 * @notice Sophisticated price oracle for manipulation attack testing
 * @dev Implements Chainlink-style oracle with manipulation scenarios
 * 
 * Features:
 * - Multi-source price aggregation
 * - TWAP (Time-Weighted Average Price) calculation
 * - Price manipulation detection and circuit breakers
 * - Confidence scoring for price feeds
 * - Historical price tracking
 * - Flash crash simulation
 * - Oracle attack scenarios
 * - Deviation thresholds and staleness checks
 */
contract MockPriceOracle is Ownable, ReentrancyGuard {
    
    // ============ Constants ============
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_PRICE_DEVIATION = 2000; // 20% max deviation
    uint256 public constant TWAP_PERIOD = 3600; // 1 hour TWAP
    uint256 public constant STALENESS_PERIOD = 3600; // 1 hour staleness
    uint256 public constant MIN_SOURCES = 3; // Minimum price sources
    uint256 public constant CONFIDENCE_THRESHOLD = 8000; // 80% confidence required
    uint256 public constant BASIS_POINTS = 10000;

    // ============ State Variables ============
    
    // Price feed structure
    struct PriceFeed {
        uint256 price;
        uint256 timestamp;
        uint256 confidence; // 0-10000 basis points
        address source;
        bool isActive;
    }
    
    // Asset price data
    struct AssetPrice {
        uint256 currentPrice;
        uint256 twapPrice;
        uint256 lastUpdateTime;
        uint256[] priceHistory;
        uint256[] timestampHistory;
        PriceFeed[] feeds;
        bool circuitBreakerActive;
        uint256 maxDeviation;
        uint256 minPrice;
        uint256 maxPrice;
    }
    
    mapping(address => AssetPrice) public assetPrices;
    
    // Price sources
    mapping(address => bool) public authorizedSources;
    address[] public sources;
    
    // Manipulation tracking
    struct ManipulationAttempt {
        address manipulator;
        address asset;
        uint256 attemptedPrice;
        uint256 actualPrice;
        uint256 timestamp;
        bool blocked;
    }
    
    ManipulationAttempt[] public manipulationHistory;
    mapping(address => uint256) public manipulationScore; // Track suspicious actors
    
    // Circuit breaker configuration
    uint256 public globalCircuitBreaker;
    mapping(address => uint256) public assetCircuitBreakers;
    
    // Oracle attack simulation
    bool public attackModeEnabled;
    mapping(address => uint256) public attackPrices;
    
    // ============ Events ============
    
    event PriceUpdated(
        address indexed asset,
        uint256 price,
        uint256 confidence,
        address source
    );
    
    event TWAPUpdated(
        address indexed asset,
        uint256 twapPrice,
        uint256 period
    );
    
    event ManipulationDetected(
        address indexed asset,
        address indexed manipulator,
        uint256 attemptedPrice,
        uint256 deviation
    );
    
    event CircuitBreakerTriggered(
        address indexed asset,
        uint256 price,
        string reason
    );
    
    event PriceSourceAdded(address indexed source);
    event PriceSourceRemoved(address indexed source);
    
    event FlashCrashSimulated(
        address indexed asset,
        uint256 crashPrice,
        uint256 duration
    );

    // ============ Constructor ============
    
    constructor() Ownable(msg.sender) {
        // Initialize with owner as authorized source
        authorizedSources[msg.sender] = true;
        sources.push(msg.sender);
    }

    // ============ Price Feed Functions ============
    
    /**
     * @dev Submit price update from authorized source
     */
    function submitPrice(
        address asset,
        uint256 price,
        uint256 confidence
    ) external nonReentrant {
        require(authorizedSources[msg.sender], "Unauthorized source");
        require(price > 0, "Invalid price");
        require(confidence <= BASIS_POINTS, "Invalid confidence");
        
        AssetPrice storage assetData = assetPrices[asset];
        
        // Check for manipulation
        if (assetData.currentPrice > 0) {
            uint256 deviation = _calculateDeviation(price, assetData.currentPrice);
            
            if (deviation > MAX_PRICE_DEVIATION) {
                // Potential manipulation detected
                _handleManipulation(asset, msg.sender, price, deviation);
                return;
            }
        }
        
        // Add to price feeds
        PriceFeed memory feed = PriceFeed({
            price: price,
            timestamp: block.timestamp,
            confidence: confidence,
            source: msg.sender,
            isActive: true
        });
        
        // Update or add feed from this source
        bool updated = false;
        for (uint i = 0; i < assetData.feeds.length; i++) {
            if (assetData.feeds[i].source == msg.sender) {
                assetData.feeds[i] = feed;
                updated = true;
                break;
            }
        }
        
        if (!updated) {
            assetData.feeds.push(feed);
        }
        
        // Aggregate price from multiple sources
        uint256 aggregatedPrice = _aggregatePrices(asset);
        
        // Update current price
        assetData.currentPrice = aggregatedPrice;
        assetData.lastUpdateTime = block.timestamp;
        
        // Update price history
        assetData.priceHistory.push(aggregatedPrice);
        assetData.timestampHistory.push(block.timestamp);
        
        // Maintain history size
        if (assetData.priceHistory.length > 100) {
            for (uint i = 0; i < assetData.priceHistory.length - 100; i++) {
                assetData.priceHistory[i] = assetData.priceHistory[i + 100];
                assetData.timestampHistory[i] = assetData.timestampHistory[i + 100];
            }
            // Resize arrays
            while (assetData.priceHistory.length > 100) {
                assetData.priceHistory.pop();
                assetData.timestampHistory.pop();
            }
        }
        
        // Update TWAP
        _updateTWAP(asset);
        
        emit PriceUpdated(asset, aggregatedPrice, confidence, msg.sender);
    }

    /**
     * @dev Aggregate prices from multiple sources
     */
    function _aggregatePrices(address asset) internal view returns (uint256) {
        AssetPrice storage assetData = assetPrices[asset];
        
        uint256 totalPrice = 0;
        uint256 totalWeight = 0;
        uint256 activeSources = 0;
        
        for (uint i = 0; i < assetData.feeds.length; i++) {
            PriceFeed memory feed = assetData.feeds[i];
            
            // Skip stale feeds
            if (block.timestamp - feed.timestamp > STALENESS_PERIOD) {
                continue;
            }
            
            // Skip low confidence feeds
            if (feed.confidence < CONFIDENCE_THRESHOLD) {
                continue;
            }
            
            // Weight by confidence
            uint256 weight = feed.confidence;
            totalPrice += feed.price * weight;
            totalWeight += weight;
            activeSources++;
        }
        
        // Require minimum sources
        require(activeSources >= MIN_SOURCES || activeSources == assetData.feeds.length, 
                "Insufficient price sources");
        require(totalWeight > 0, "No valid prices");
        
        return totalPrice / totalWeight;
    }

    /**
     * @dev Update TWAP for asset
     */
    function _updateTWAP(address asset) internal {
        AssetPrice storage assetData = assetPrices[asset];
        
        if (assetData.priceHistory.length < 2) {
            assetData.twapPrice = assetData.currentPrice;
            return;
        }
        
        uint256 timeWeightedSum = 0;
        uint256 totalTime = 0;
        uint256 cutoffTime = block.timestamp > TWAP_PERIOD ? 
            block.timestamp - TWAP_PERIOD : 0;
        
        // Calculate time-weighted average
        for (uint i = assetData.priceHistory.length - 1; i > 0; i--) {
            if (assetData.timestampHistory[i] < cutoffTime) {
                break;
            }
            
            uint256 timeDelta = assetData.timestampHistory[i] - 
                (i > 0 ? assetData.timestampHistory[i-1] : cutoffTime);
            
            timeWeightedSum += assetData.priceHistory[i] * timeDelta;
            totalTime += timeDelta;
        }
        
        if (totalTime > 0) {
            assetData.twapPrice = timeWeightedSum / totalTime;
            emit TWAPUpdated(asset, assetData.twapPrice, TWAP_PERIOD);
        }
    }

    // ============ Manipulation Detection ============
    
    /**
     * @dev Handle potential price manipulation
     */
    function _handleManipulation(
        address asset,
        address source,
        uint256 attemptedPrice,
        uint256 deviation
    ) internal {
        // Record manipulation attempt
        manipulationHistory.push(ManipulationAttempt({
            manipulator: source,
            asset: asset,
            attemptedPrice: attemptedPrice,
            actualPrice: assetPrices[asset].currentPrice,
            timestamp: block.timestamp,
            blocked: true
        }));
        
        // Increase manipulator score
        manipulationScore[source]++;
        
        // Trigger circuit breaker if score too high
        if (manipulationScore[source] > 3) {
            _triggerCircuitBreaker(asset, "Repeated manipulation attempts");
        }
        
        emit ManipulationDetected(asset, source, attemptedPrice, deviation);
    }

    /**
     * @dev Trigger circuit breaker for asset
     */
    function _triggerCircuitBreaker(address asset, string memory reason) internal {
        assetPrices[asset].circuitBreakerActive = true;
        assetCircuitBreakers[asset] = block.timestamp;
        
        emit CircuitBreakerTriggered(asset, assetPrices[asset].currentPrice, reason);
    }

    /**
     * @dev Calculate price deviation in basis points
     */
    function _calculateDeviation(uint256 newPrice, uint256 oldPrice) 
        internal 
        pure 
        returns (uint256) 
    {
        if (oldPrice == 0) return 0;
        
        uint256 diff = newPrice > oldPrice ? 
            newPrice - oldPrice : oldPrice - newPrice;
            
        return (diff * BASIS_POINTS) / oldPrice;
    }

    // ============ Oracle Attack Simulation ============
    
    /**
     * @dev Enable attack mode for testing
     */
    function enableAttackMode(bool enabled) external onlyOwner {
        attackModeEnabled = enabled;
    }

    /**
     * @dev Set attack price for asset
     */
    function setAttackPrice(address asset, uint256 price) external onlyOwner {
        require(attackModeEnabled, "Attack mode disabled");
        attackPrices[asset] = price;
    }

    /**
     * @dev Simulate flash crash
     */
    function simulateFlashCrash(
        address asset,
        uint256 crashPercentage,
        uint256 duration
    ) external onlyOwner {
        require(crashPercentage <= 9000, "Crash too severe"); // Max 90% crash
        
        AssetPrice storage assetData = assetPrices[asset];
        uint256 originalPrice = assetData.currentPrice;
        uint256 crashPrice = (originalPrice * (BASIS_POINTS - crashPercentage)) / BASIS_POINTS;
        
        // Temporarily set crash price
        assetData.currentPrice = crashPrice;
        
        emit FlashCrashSimulated(asset, crashPrice, duration);
        
        // Note: In production, would need mechanism to restore price after duration
    }

    /**
     * @dev Simulate coordinated oracle attack
     */
    function simulateCoordinatedAttack(
        address[] calldata assets,
        uint256[] calldata prices
    ) external onlyOwner {
        require(attackModeEnabled, "Attack mode disabled");
        require(assets.length == prices.length, "Array mismatch");
        
        for (uint i = 0; i < assets.length; i++) {
            attackPrices[assets[i]] = prices[i];
        }
    }

    // ============ Public View Functions ============
    
    /**
     * @dev Get current price for asset
     */
    function getPrice(address asset) external view returns (uint256) {
        // Return attack price if in attack mode
        if (attackModeEnabled && attackPrices[asset] > 0) {
            return attackPrices[asset];
        }
        
        AssetPrice storage assetData = assetPrices[asset];
        
        // Check circuit breaker
        if (assetData.circuitBreakerActive) {
            // Use TWAP during circuit breaker
            return assetData.twapPrice > 0 ? assetData.twapPrice : assetData.currentPrice;
        }
        
        // Check staleness
        require(
            block.timestamp - assetData.lastUpdateTime <= STALENESS_PERIOD,
            "Price stale"
        );
        
        return assetData.currentPrice;
    }

    /**
     * @dev Get price with confidence score
     */
    function getPriceWithConfidence(address asset) 
        external 
        view 
        returns (uint256 price, uint256 confidence) 
    {
        AssetPrice storage assetData = assetPrices[asset];
        
        // Calculate aggregate confidence
        uint256 totalConfidence = 0;
        uint256 validFeeds = 0;
        
        for (uint i = 0; i < assetData.feeds.length; i++) {
            if (block.timestamp - assetData.feeds[i].timestamp <= STALENESS_PERIOD) {
                totalConfidence += assetData.feeds[i].confidence;
                validFeeds++;
            }
        }
        
        price = this.getPrice(asset);
        confidence = validFeeds > 0 ? totalConfidence / validFeeds : 0;
    }

    /**
     * @dev Get TWAP for asset
     */
    function getTWAP(address asset) external view returns (uint256) {
        return assetPrices[asset].twapPrice;
    }

    /**
     * @dev Check if price is valid (not stale, not in circuit breaker)
     */
    function isPriceValid(address asset) external view returns (bool) {
        AssetPrice storage assetData = assetPrices[asset];
        
        return !assetData.circuitBreakerActive &&
               block.timestamp - assetData.lastUpdateTime <= STALENESS_PERIOD &&
               assetData.currentPrice > 0;
    }

    /**
     * @dev Get price volatility (standard deviation)
     */
    function getVolatility(address asset) external view returns (uint256) {
        AssetPrice storage assetData = assetPrices[asset];
        
        if (assetData.priceHistory.length < 2) return 0;
        
        // Calculate mean
        uint256 sum = 0;
        for (uint i = 0; i < assetData.priceHistory.length; i++) {
            sum += assetData.priceHistory[i];
        }
        uint256 mean = sum / assetData.priceHistory.length;
        
        // Calculate variance
        uint256 variance = 0;
        for (uint i = 0; i < assetData.priceHistory.length; i++) {
            uint256 diff = assetData.priceHistory[i] > mean ?
                assetData.priceHistory[i] - mean : mean - assetData.priceHistory[i];
            variance += (diff * diff);
        }
        variance = variance / assetData.priceHistory.length;
        
        // Return square root (simplified)
        return _sqrt(variance);
    }

    // ============ Admin Functions ============
    
    /**
     * @dev Add authorized price source
     */
    function addPriceSource(address source) external onlyOwner {
        require(!authorizedSources[source], "Already authorized");
        authorizedSources[source] = true;
        sources.push(source);
        emit PriceSourceAdded(source);
    }

    /**
     * @dev Remove price source
     */
    function removePriceSource(address source) external onlyOwner {
        require(authorizedSources[source], "Not authorized");
        authorizedSources[source] = false;
        
        // Remove from sources array
        for (uint i = 0; i < sources.length; i++) {
            if (sources[i] == source) {
                sources[i] = sources[sources.length - 1];
                sources.pop();
                break;
            }
        }
        
        emit PriceSourceRemoved(source);
    }

    /**
     * @dev Set price bounds for asset
     */
    function setPriceBounds(
        address asset,
        uint256 minPrice,
        uint256 maxPrice
    ) external onlyOwner {
        require(maxPrice > minPrice, "Invalid bounds");
        assetPrices[asset].minPrice = minPrice;
        assetPrices[asset].maxPrice = maxPrice;
    }

    /**
     * @dev Reset circuit breaker
     */
    function resetCircuitBreaker(address asset) external onlyOwner {
        assetPrices[asset].circuitBreakerActive = false;
        assetCircuitBreakers[asset] = 0;
    }

    /**
     * @dev Force price update (emergency)
     */
    function forceSetPrice(address asset, uint256 price) external onlyOwner {
        assetPrices[asset].currentPrice = price;
        assetPrices[asset].lastUpdateTime = block.timestamp;
    }

    // ============ Helper Functions ============
    
    /**
     * @dev Calculate square root (Babylonian method)
     */
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}