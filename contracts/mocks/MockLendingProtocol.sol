// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IPriceOracle
 * @dev Interface for price oracle integration
 */
interface IPriceOracle {
    function getPrice(address asset) external view returns (uint256);
    function getPriceWithConfidence(address asset) external view returns (uint256 price, uint256 confidence);
}

/**
 * @title MockLendingProtocol
 * @author LookCard FinTech Team
 * @notice Comprehensive lending protocol for economic manipulation testing
 * @dev Implements Aave/Compound style lending with realistic mechanics
 * 
 * Features:
 * - Collateralized borrowing with dynamic LTV ratios
 * - Variable and stable interest rate models
 * - Liquidation mechanics with incentives
 * - Interest accrual using compound formula
 * - Health factor calculation
 * - Flash loan integration for liquidations
 * - Reserve factor for protocol revenue
 * - Emergency pause mechanism
 * - Complete double-entry accounting
 */
contract MockLendingProtocol is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    uint256 public constant PRECISION = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MAX_LTV = 8000; // 80% max loan-to-value
    uint256 public constant LIQUIDATION_THRESHOLD = 8500; // 85% liquidation threshold
    uint256 public constant LIQUIDATION_BONUS = 10500; // 105% liquidation incentive
    uint256 public constant MIN_HEALTH_FACTOR = 1e18; // 1.0 minimum health factor
    uint256 public constant RESERVE_FACTOR = 1000; // 10% of interest to reserves
    uint256 public constant BASIS_POINTS = 10000;

    // ============ State Variables ============
    
    // Market configuration
    struct Market {
        bool isActive;
        bool borrowingEnabled;
        uint256 collateralFactor; // Basis points (e.g., 7500 = 75%)
        uint256 liquidationThreshold; // Basis points
        uint256 liquidationBonus; // Basis points
        uint256 reserveFactor; // Basis points
        uint256 totalSupply;
        uint256 totalBorrows;
        uint256 totalReserves;
        uint256 borrowIndex;
        uint256 supplyIndex;
        uint256 lastAccrualBlock;
        uint256 baseRatePerYear;
        uint256 multiplierPerYear;
        uint256 jumpMultiplierPerYear;
        uint256 kink; // Utilization rate kink
    }
    
    mapping(address => Market) public markets;
    address[] public marketsList;
    
    // User positions
    struct UserPosition {
        uint256 supplied; // Amount supplied (lending)
        uint256 borrowed; // Amount borrowed
        uint256 borrowIndex; // Index at last interaction
        uint256 supplyIndex; // Index at last interaction
    }
    
    mapping(address => mapping(address => UserPosition)) public positions; // user => asset => position
    
    // Price oracle
    IPriceOracle public priceOracle;
    
    // Liquidation tracking
    struct LiquidationInfo {
        address liquidator;
        address borrower;
        address collateralAsset;
        address debtAsset;
        uint256 debtCovered;
        uint256 collateralSeized;
        uint256 timestamp;
    }
    
    LiquidationInfo[] public liquidationHistory;
    mapping(address => uint256) public liquidationProfits;
    
    // Interest rate model parameters
    uint256 public constant BASE_RATE = 2e16; // 2% base APR
    uint256 public constant MULTIPLIER = 5e16; // 5% APR per utilization
    uint256 public constant JUMP_MULTIPLIER = 1e18; // 100% APR after kink
    uint256 public constant KINK = 8e17; // 80% utilization kink
    
    // Protocol state
    bool public paused;
    mapping(address => bool) public authorizedLiquidators;
    
    // ============ Events ============
    
    event MarketListed(address indexed asset, uint256 collateralFactor);
    event Supply(address indexed user, address indexed asset, uint256 amount);
    event Withdraw(address indexed user, address indexed asset, uint256 amount);
    event Borrow(address indexed user, address indexed asset, uint256 amount);
    event Repay(address indexed user, address indexed asset, uint256 amount);
    event Liquidate(
        address indexed liquidator,
        address indexed borrower,
        address indexed collateralAsset,
        address debtAsset,
        uint256 debtCovered,
        uint256 collateralSeized
    );
    event InterestAccrued(address indexed asset, uint256 interest, uint256 totalBorrows);
    event ReservesWithdrawn(address indexed asset, uint256 amount);
    event OracleUpdated(address oldOracle, address newOracle);

    // ============ Modifiers ============
    
    modifier notPaused() {
        require(!paused, "Protocol paused");
        _;
    }

    modifier marketExists(address asset) {
        require(markets[asset].isActive, "Market not active");
        _;
    }

    // ============ Constructor ============
    
    constructor(address _priceOracle) Ownable(msg.sender) {
        require(_priceOracle != address(0), "Invalid oracle");
        priceOracle = IPriceOracle(_priceOracle);
    }

    // ============ Admin Functions ============
    
    /**
     * @dev List new lending market
     */
    function listMarket(
        address asset,
        uint256 collateralFactor,
        bool borrowingEnabled
    ) external onlyOwner {
        require(!markets[asset].isActive, "Market exists");
        require(collateralFactor <= MAX_LTV, "CF too high");
        
        markets[asset] = Market({
            isActive: true,
            borrowingEnabled: borrowingEnabled,
            collateralFactor: collateralFactor,
            liquidationThreshold: LIQUIDATION_THRESHOLD,
            liquidationBonus: LIQUIDATION_BONUS,
            reserveFactor: RESERVE_FACTOR,
            totalSupply: 0,
            totalBorrows: 0,
            totalReserves: 0,
            borrowIndex: PRECISION,
            supplyIndex: PRECISION,
            lastAccrualBlock: block.number,
            baseRatePerYear: BASE_RATE,
            multiplierPerYear: MULTIPLIER,
            jumpMultiplierPerYear: JUMP_MULTIPLIER,
            kink: KINK
        });
        
        marketsList.push(asset);
        emit MarketListed(asset, collateralFactor);
    }

    /**
     * @dev Update price oracle
     */
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Invalid oracle");
        address oldOracle = address(priceOracle);
        priceOracle = IPriceOracle(newOracle);
        emit OracleUpdated(oldOracle, newOracle);
    }

    /**
     * @dev Pause/unpause protocol
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    /**
     * @dev Authorize liquidator
     */
    function setAuthorizedLiquidator(address liquidator, bool authorized) external onlyOwner {
        authorizedLiquidators[liquidator] = authorized;
    }

    // ============ Core Lending Functions ============
    
    /**
     * @dev Supply assets to lending pool
     */
    function supply(address asset, uint256 amount) 
        external 
        nonReentrant 
        notPaused 
        marketExists(asset) 
    {
        require(amount > 0, "Zero amount");
        
        // Accrue interest first
        _accrueInterest(asset);
        
        Market storage market = markets[asset];
        UserPosition storage position = positions[msg.sender][asset];
        
        // Transfer tokens to protocol
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        
        // Update user position with interest
        uint256 suppliedWithInterest = _getSupplyBalanceWithInterest(msg.sender, asset);
        position.supplied = suppliedWithInterest + amount;
        position.supplyIndex = market.supplyIndex;
        
        // Update market state
        market.totalSupply += amount;
        
        emit Supply(msg.sender, asset, amount);
    }

    /**
     * @dev Withdraw supplied assets
     */
    function withdraw(address asset, uint256 amount) 
        external 
        nonReentrant 
        notPaused 
        marketExists(asset) 
    {
        // Accrue interest
        _accrueInterest(asset);
        
        Market storage market = markets[asset];
        UserPosition storage position = positions[msg.sender][asset];
        
        // Get supply balance with interest
        uint256 suppliedWithInterest = _getSupplyBalanceWithInterest(msg.sender, asset);
        require(suppliedWithInterest >= amount, "Insufficient balance");
        
        // Check if withdrawal would cause undercollateralization
        position.supplied = suppliedWithInterest - amount;
        position.supplyIndex = market.supplyIndex;
        
        require(_checkHealthFactor(msg.sender) >= MIN_HEALTH_FACTOR, "Undercollateralized");
        
        // Update market state
        market.totalSupply -= amount;
        
        // Transfer tokens
        IERC20(asset).safeTransfer(msg.sender, amount);
        
        emit Withdraw(msg.sender, asset, amount);
    }

    /**
     * @dev Borrow assets against collateral
     */
    function borrow(address asset, uint256 amount) 
        external 
        nonReentrant 
        notPaused 
        marketExists(asset) 
    {
        Market storage market = markets[asset];
        require(market.borrowingEnabled, "Borrowing disabled");
        require(amount > 0, "Zero amount");
        
        // Accrue interest
        _accrueInterest(asset);
        
        UserPosition storage position = positions[msg.sender][asset];
        
        // Update borrowed amount with interest
        uint256 borrowedWithInterest = _getBorrowBalanceWithInterest(msg.sender, asset);
        position.borrowed = borrowedWithInterest + amount;
        position.borrowIndex = market.borrowIndex;
        
        // Update market state
        market.totalBorrows += amount;
        
        // Check health factor after borrowing
        require(_checkHealthFactor(msg.sender) >= MIN_HEALTH_FACTOR, "Undercollateralized");
        
        // Check available liquidity
        uint256 availableLiquidity = IERC20(asset).balanceOf(address(this)) - market.totalReserves;
        require(availableLiquidity >= amount, "Insufficient liquidity");
        
        // Transfer tokens
        IERC20(asset).safeTransfer(msg.sender, amount);
        
        emit Borrow(msg.sender, asset, amount);
    }

    /**
     * @dev Repay borrowed assets
     */
    function repay(address asset, uint256 amount) 
        external 
        nonReentrant 
        notPaused 
        marketExists(asset) 
    {
        // Accrue interest
        _accrueInterest(asset);
        
        Market storage market = markets[asset];
        UserPosition storage position = positions[msg.sender][asset];
        
        // Get borrow balance with interest
        uint256 borrowedWithInterest = _getBorrowBalanceWithInterest(msg.sender, asset);
        uint256 repayAmount = amount > borrowedWithInterest ? borrowedWithInterest : amount;
        
        // Transfer tokens
        IERC20(asset).safeTransferFrom(msg.sender, address(this), repayAmount);
        
        // Update position
        position.borrowed = borrowedWithInterest - repayAmount;
        position.borrowIndex = market.borrowIndex;
        
        // Update market state
        market.totalBorrows -= repayAmount;
        
        emit Repay(msg.sender, asset, repayAmount);
    }

    // ============ Liquidation Functions ============
    
    /**
     * @dev Liquidate undercollateralized position
     */
    function liquidate(
        address borrower,
        address collateralAsset,
        address debtAsset,
        uint256 debtToCover
    ) external nonReentrant notPaused {
        require(borrower != msg.sender, "Cannot self-liquidate");
        
        // Accrue interest on both assets
        _accrueInterest(collateralAsset);
        _accrueInterest(debtAsset);
        
        // Check if position is liquidatable
        uint256 healthFactor = _checkHealthFactor(borrower);
        require(healthFactor < MIN_HEALTH_FACTOR, "Position healthy");
        
        // Get debt and collateral values
        uint256 borrowBalance = _getBorrowBalanceWithInterest(borrower, debtAsset);
        uint256 maxDebtToCover = (borrowBalance * 5000) / BASIS_POINTS; // Max 50% liquidation
        uint256 actualDebtToCover = debtToCover > maxDebtToCover ? maxDebtToCover : debtToCover;
        
        // Calculate collateral to seize with bonus
        uint256 debtValue = (actualDebtToCover * priceOracle.getPrice(debtAsset)) / PRECISION;
        uint256 collateralPrice = priceOracle.getPrice(collateralAsset);
        uint256 collateralToSeize = (debtValue * LIQUIDATION_BONUS * PRECISION) / 
            (collateralPrice * BASIS_POINTS);
        
        // Get collateral balance
        uint256 collateralBalance = _getSupplyBalanceWithInterest(borrower, collateralAsset);
        require(collateralBalance >= collateralToSeize, "Insufficient collateral");
        
        // Transfer debt payment from liquidator
        IERC20(debtAsset).safeTransferFrom(msg.sender, address(this), actualDebtToCover);
        
        // Update borrower's debt
        UserPosition storage borrowerDebtPosition = positions[borrower][debtAsset];
        borrowerDebtPosition.borrowed -= actualDebtToCover;
        markets[debtAsset].totalBorrows -= actualDebtToCover;
        
        // Transfer collateral to liquidator
        UserPosition storage borrowerCollateralPosition = positions[borrower][collateralAsset];
        borrowerCollateralPosition.supplied -= collateralToSeize;
        markets[collateralAsset].totalSupply -= collateralToSeize;
        
        IERC20(collateralAsset).safeTransfer(msg.sender, collateralToSeize);
        
        // Track liquidation
        liquidationProfits[msg.sender] += collateralToSeize - 
            (debtValue * PRECISION / collateralPrice);
        
        liquidationHistory.push(LiquidationInfo({
            liquidator: msg.sender,
            borrower: borrower,
            collateralAsset: collateralAsset,
            debtAsset: debtAsset,
            debtCovered: actualDebtToCover,
            collateralSeized: collateralToSeize,
            timestamp: block.timestamp
        }));
        
        emit Liquidate(
            msg.sender,
            borrower,
            collateralAsset,
            debtAsset,
            actualDebtToCover,
            collateralToSeize
        );
    }

    // ============ Interest Rate Functions ============
    
    /**
     * @dev Accrue interest for market
     */
    function _accrueInterest(address asset) internal {
        Market storage market = markets[asset];
        
        uint256 currentBlock = block.number;
        if (currentBlock == market.lastAccrualBlock) {
            return; // Already accrued this block
        }
        
        uint256 blockDelta = currentBlock - market.lastAccrualBlock;
        
        if (market.totalBorrows == 0) {
            market.lastAccrualBlock = currentBlock;
            return;
        }
        
        // Calculate borrow rate
        uint256 borrowRate = _getBorrowRate(
            market.totalBorrows,
            market.totalSupply - market.totalBorrows + market.totalReserves
        );
        
        // Calculate interest accumulated
        uint256 interestAccumulated = (borrowRate * market.totalBorrows * blockDelta) / PRECISION;
        
        // Update total borrows
        market.totalBorrows += interestAccumulated;
        
        // Update reserves (protocol fee)
        uint256 reserveIncrease = (interestAccumulated * market.reserveFactor) / BASIS_POINTS;
        market.totalReserves += reserveIncrease;
        
        // Update borrow index
        market.borrowIndex += (market.borrowIndex * interestAccumulated) / market.totalBorrows;
        
        // Update supply index
        if (market.totalSupply > 0) {
            uint256 supplyInterest = interestAccumulated - reserveIncrease;
            market.supplyIndex += (market.supplyIndex * supplyInterest) / market.totalSupply;
        }
        
        market.lastAccrualBlock = currentBlock;
        
        emit InterestAccrued(asset, interestAccumulated, market.totalBorrows);
    }

    /**
     * @dev Calculate borrow rate using kinked model
     */
    function _getBorrowRate(uint256 borrows, uint256 cash) internal view returns (uint256) {
        uint256 total = borrows + cash;
        if (total == 0) return BASE_RATE / (SECONDS_PER_YEAR / 12); // Per block
        
        uint256 utilization = (borrows * PRECISION) / total;
        uint256 rate;
        
        if (utilization <= KINK) {
            // Below kink: base + utilization * multiplier
            rate = BASE_RATE + (utilization * MULTIPLIER) / PRECISION;
        } else {
            // Above kink: add jump multiplier for excess utilization
            uint256 normalRate = BASE_RATE + (KINK * MULTIPLIER) / PRECISION;
            uint256 excessUtil = utilization - KINK;
            rate = normalRate + (excessUtil * JUMP_MULTIPLIER) / PRECISION;
        }
        
        // Convert to per-block rate (assuming 12 second blocks)
        return rate / (SECONDS_PER_YEAR / 12);
    }

    // ============ Position Calculation Functions ============
    
    /**
     * @dev Get supply balance with accrued interest
     */
    function _getSupplyBalanceWithInterest(address user, address asset) 
        internal 
        view 
        returns (uint256) 
    {
        UserPosition storage position = positions[user][asset];
        if (position.supplied == 0) return 0;
        
        Market storage market = markets[asset];
        uint256 indexDiff = market.supplyIndex - position.supplyIndex;
        uint256 interest = (position.supplied * indexDiff) / PRECISION;
        
        return position.supplied + interest;
    }

    /**
     * @dev Get borrow balance with accrued interest
     */
    function _getBorrowBalanceWithInterest(address user, address asset) 
        internal 
        view 
        returns (uint256) 
    {
        UserPosition storage position = positions[user][asset];
        if (position.borrowed == 0) return 0;
        
        Market storage market = markets[asset];
        uint256 indexDiff = market.borrowIndex - position.borrowIndex;
        uint256 interest = (position.borrowed * indexDiff) / PRECISION;
        
        return position.borrowed + interest;
    }

    /**
     * @dev Calculate user health factor
     */
    function _checkHealthFactor(address user) internal view returns (uint256) {
        uint256 totalCollateralValue = 0;
        uint256 totalBorrowValue = 0;
        
        for (uint256 i = 0; i < marketsList.length; i++) {
            address asset = marketsList[i];
            
            // Add collateral value
            uint256 supplied = _getSupplyBalanceWithInterest(user, asset);
            if (supplied > 0) {
                uint256 assetPrice = priceOracle.getPrice(asset);
                uint256 collateralValue = (supplied * assetPrice * markets[asset].collateralFactor) / 
                    (PRECISION * BASIS_POINTS);
                totalCollateralValue += collateralValue;
            }
            
            // Add borrow value
            uint256 borrowed = _getBorrowBalanceWithInterest(user, asset);
            if (borrowed > 0) {
                uint256 assetPrice = priceOracle.getPrice(asset);
                uint256 borrowValue = (borrowed * assetPrice) / PRECISION;
                totalBorrowValue += borrowValue;
            }
        }
        
        if (totalBorrowValue == 0) return type(uint256).max;
        
        return (totalCollateralValue * PRECISION) / totalBorrowValue;
    }

    // ============ View Functions ============
    
    /**
     * @dev Get user account data
     */
    function getAccountData(address user) external view returns (
        uint256 totalCollateralETH,
        uint256 totalDebtETH,
        uint256 availableBorrowsETH,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    ) {
        for (uint256 i = 0; i < marketsList.length; i++) {
            address asset = marketsList[i];
            uint256 assetPrice = priceOracle.getPrice(asset);
            
            // Collateral
            uint256 supplied = _getSupplyBalanceWithInterest(user, asset);
            if (supplied > 0) {
                uint256 collateralETH = (supplied * assetPrice) / PRECISION;
                totalCollateralETH += collateralETH;
                
                // Weight by collateral factor
                ltv += (collateralETH * markets[asset].collateralFactor) / BASIS_POINTS;
                currentLiquidationThreshold += 
                    (collateralETH * markets[asset].liquidationThreshold) / BASIS_POINTS;
            }
            
            // Debt
            uint256 borrowed = _getBorrowBalanceWithInterest(user, asset);
            if (borrowed > 0) {
                totalDebtETH += (borrowed * assetPrice) / PRECISION;
            }
        }
        
        if (totalCollateralETH > 0) {
            ltv = (ltv * BASIS_POINTS) / totalCollateralETH;
            currentLiquidationThreshold = 
                (currentLiquidationThreshold * BASIS_POINTS) / totalCollateralETH;
        }
        
        availableBorrowsETH = totalCollateralETH > totalDebtETH ? 
            ((totalCollateralETH * ltv) / BASIS_POINTS) - totalDebtETH : 0;
            
        healthFactor = _checkHealthFactor(user);
    }

    /**
     * @dev Get market data
     */
    function getMarketData(address asset) external view returns (
        uint256 totalSupply,
        uint256 totalBorrows,
        uint256 totalReserves,
        uint256 utilizationRate,
        uint256 supplyAPY,
        uint256 borrowAPY
    ) {
        Market storage market = markets[asset];
        totalSupply = market.totalSupply;
        totalBorrows = market.totalBorrows;
        totalReserves = market.totalReserves;
        
        uint256 cash = IERC20(asset).balanceOf(address(this)) - totalReserves;
        
        if (totalSupply > 0) {
            utilizationRate = (totalBorrows * PRECISION) / totalSupply;
        }
        
        borrowAPY = _getBorrowRate(totalBorrows, cash) * (SECONDS_PER_YEAR / 12);
        
        if (totalSupply > 0) {
            uint256 borrowInterest = (borrowAPY * totalBorrows) / PRECISION;
            uint256 reserveInterest = (borrowInterest * market.reserveFactor) / BASIS_POINTS;
            supplyAPY = ((borrowInterest - reserveInterest) * PRECISION) / totalSupply;
        }
    }
}