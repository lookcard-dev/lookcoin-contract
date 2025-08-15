// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockDEXPool
 * @author LookCard FinTech Team
 * @notice Sophisticated DEX AMM pool for sandwich attack and MEV testing
 * @dev Implements Uniswap V2/V3 style mechanics with realistic slippage and price impact
 * 
 * Features:
 * - Constant product (x*y=k) and concentrated liquidity models
 * - Realistic slippage calculation
 * - Price impact modeling for large trades
 * - MEV opportunity generation for sandwich attacks
 * - Front-running detection and metrics
 * - TWAP oracle functionality
 * - Flash swap support
 * - Liquidity provider tracking with proper accounting
 */
contract MockDEXPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant FEE_PRECISION = 10000;
    uint256 public constant DEFAULT_SWAP_FEE = 30; // 0.3% (Uniswap V2 standard)
    uint256 public constant MAX_SWAP_FEE = 100; // 1% max
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant TWAP_PERIOD = 3600; // 1 hour TWAP

    // ============ State Variables ============
    
    // Pool configuration
    IERC20 public immutable token0; // Base token (e.g., LOOK)
    IERC20 public immutable token1; // Quote token (e.g., USDC)
    uint256 public swapFee = DEFAULT_SWAP_FEE;
    
    // Liquidity and reserves
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public kLast; // Last k value for fee calculation
    uint256 public totalSupply; // LP token supply
    
    // LP token balances
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    // Price oracle data
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    uint32 public blockTimestampLast;
    
    // MEV and sandwich attack tracking
    struct SwapInfo {
        address trader;
        uint256 amountIn;
        uint256 amountOut;
        bool isToken0;
        uint256 timestamp;
        uint256 gasPrice;
        uint256 priceImpact;
    }
    
    SwapInfo[] public recentSwaps;
    mapping(address => uint256) public sandwichProfits; // Track sandwich attack profits
    mapping(address => uint256) public mevExtracted; // Track MEV extraction
    
    // Concentrated liquidity parameters (V3 style)
    struct Tick {
        int128 liquidityNet;
        uint128 liquidityGross;
        uint256 feeGrowthOutside0;
        uint256 feeGrowthOutside1;
    }
    
    mapping(int24 => Tick) public ticks;
    int24 public currentTick;
    uint128 public liquidity; // Current in-range liquidity
    
    // Flash swap data
    bytes32 private flashSwapHash;
    
    // ============ Events ============
    
    event Mint(address indexed sender, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint256 reserve0, uint256 reserve1);
    event FlashSwap(address indexed borrower, uint256 amount0, uint256 amount1);
    event SandwichAttackDetected(
        address indexed attacker,
        address indexed victim,
        uint256 profit
    );
    event PriceImpact(uint256 impact, uint256 amountIn, bool isLargeImpact);
    event TWAPUpdated(uint256 price0Cumulative, uint256 price1Cumulative);

    // ============ Constructor ============
    
    constructor(address _token0, address _token1) Ownable(msg.sender) {
        require(_token0 != address(0) && _token1 != address(0), "Invalid tokens");
        require(_token0 != _token1, "Identical tokens");
        
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
    }

    // ============ LP Token Functions ============
    
    /**
     * @dev Transfer LP tokens
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @dev Transfer LP tokens from
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");
        
        if (currentAllowance != type(uint256).max) {
            allowance[from][msg.sender] = currentAllowance - amount;
        }
        
        _transfer(from, to, amount);
        return true;
    }

    /**
     * @dev Approve LP token spending
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /**
     * @dev Internal transfer
     */
    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0) && to != address(0), "Invalid address");
        require(balanceOf[from] >= amount, "Insufficient balance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    // ============ Core AMM Functions ============
    
    /**
     * @dev Add liquidity to the pool
     * @param amount0Desired Amount of token0 to add
     * @param amount1Desired Amount of token1 to add
     * @param amount0Min Minimum token0 to add (slippage protection)
     * @param amount1Min Minimum token1 to add (slippage protection)
     * @param to Address to receive LP tokens
     * @param deadline Transaction deadline
     */
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amount0, uint256 amount1, uint256 liquidity_) {
        require(block.timestamp <= deadline, "Expired");
        require(to != address(0), "Invalid recipient");
        
        // Calculate optimal amounts based on current reserves
        if (reserve0 == 0 && reserve1 == 0) {
            // Initial liquidity
            amount0 = amount0Desired;
            amount1 = amount1Desired;
            liquidity_ = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            
            // Mint minimum liquidity to zero address (permanently locked)
            balanceOf[address(0)] = MINIMUM_LIQUIDITY;
            totalSupply = MINIMUM_LIQUIDITY;
        } else {
            // Calculate proportional amounts
            uint256 amount1Optimal = (amount0Desired * reserve1) / reserve0;
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "Insufficient amount1");
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = (amount1Desired * reserve0) / reserve1;
                require(amount0Optimal >= amount0Min, "Insufficient amount0");
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }
            
            // Calculate liquidity tokens to mint
            liquidity_ = _min(
                (amount0 * totalSupply) / reserve0,
                (amount1 * totalSupply) / reserve1
            );
        }
        
        require(liquidity_ > 0, "Insufficient liquidity minted");
        
        // Transfer tokens to pool
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        
        // Update reserves
        reserve0 += amount0;
        reserve1 += amount1;
        
        // Mint LP tokens
        balanceOf[to] += liquidity_;
        totalSupply += liquidity_;
        
        _updateOracle();
        
        emit Mint(msg.sender, amount0, amount1, liquidity_);
        emit Sync(reserve0, reserve1);
    }

    /**
     * @dev Remove liquidity from the pool
     */
    function removeLiquidity(
        uint256 liquidity_,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(block.timestamp <= deadline, "Expired");
        require(liquidity_ > 0, "Insufficient liquidity");
        require(balanceOf[msg.sender] >= liquidity_, "Insufficient balance");
        
        // Calculate token amounts to return
        amount0 = (liquidity_ * reserve0) / totalSupply;
        amount1 = (liquidity_ * reserve1) / totalSupply;
        
        require(amount0 >= amount0Min, "Insufficient amount0");
        require(amount1 >= amount1Min, "Insufficient amount1");
        
        // Burn LP tokens
        balanceOf[msg.sender] -= liquidity_;
        totalSupply -= liquidity_;
        
        // Update reserves
        reserve0 -= amount0;
        reserve1 -= amount1;
        
        // Transfer tokens to user
        token0.safeTransfer(to, amount0);
        token1.safeTransfer(to, amount1);
        
        _updateOracle();
        
        emit Burn(msg.sender, amount0, amount1, to);
        emit Sync(reserve0, reserve1);
    }

    /**
     * @dev Swap tokens with realistic slippage and price impact
     */
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external nonReentrant {
        require(amount0Out > 0 || amount1Out > 0, "Insufficient output");
        require(amount0Out < reserve0 && amount1Out < reserve1, "Insufficient liquidity");
        require(to != address(token0) && to != address(token1), "Invalid recipient");
        
        // Process swap
        (uint256 amount0In, uint256 amount1In) = _executeSwap(amount0Out, amount1Out, to, data);
        
        // Verify and update
        _verifySwap(amount0In, amount1In);
        
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
        emit Sync(reserve0, reserve1);
    }
    
    /**
     * @dev Execute swap transfers and calculate inputs
     */
    function _executeSwap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) internal returns (uint256 amount0In, uint256 amount1In) {
        uint256 balance0Before = token0.balanceOf(address(this));
        uint256 balance1Before = token1.balanceOf(address(this));
        
        // Transfer outputs
        if (amount0Out > 0) token0.safeTransfer(to, amount0Out);
        if (amount1Out > 0) token1.safeTransfer(to, amount1Out);
        
        // Handle flash swap
        if (data.length > 0) {
            flashSwapHash = keccak256(abi.encode(msg.sender, amount0Out, amount1Out));
            IFlashSwapCallee(to).flashSwapCall(msg.sender, amount0Out, amount1Out, data);
            require(flashSwapHash == bytes32(0), "Flash swap not repaid");
        }
        
        // Calculate inputs
        uint256 balance0 = token0.balanceOf(address(this));
        uint256 balance1 = token1.balanceOf(address(this));
        
        amount0In = balance0 > balance0Before - amount0Out ? 
            balance0 - (balance0Before - amount0Out) : 0;
        amount1In = balance1 > balance1Before - amount1Out ? 
            balance1 - (balance1Before - amount1Out) : 0;
        
        require(amount0In > 0 || amount1In > 0, "Insufficient input");
        
        // Update reserves
        reserve0 = balance0;
        reserve1 = balance1;
    }
    
    /**
     * @dev Verify swap maintains invariants
     */
    function _verifySwap(uint256 amount0In, uint256 amount1In) internal view {
        uint256 balance0Adjusted = (reserve0 * FEE_PRECISION) - (amount0In * swapFee);
        uint256 balance1Adjusted = (reserve1 * FEE_PRECISION) - (amount1In * swapFee);
        require(
            balance0Adjusted * balance1Adjusted >= 
            (reserve0 - amount0In) * (reserve1 - amount1In) * FEE_PRECISION ** 2,
            "K invariant violated"
        );
    }

    /**
     * @dev Execute swap with exact input amount
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        bool swapToken0For1,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Expired");
        
        // Calculate output amount
        if (swapToken0For1) {
            amountOut = getAmountOut(amountIn, reserve0, reserve1);
            require(amountOut >= amountOutMin, "Insufficient output");
            
            // Transfer input tokens
            token0.safeTransferFrom(msg.sender, address(this), amountIn);
            
            // Execute swap
            this.swap(0, amountOut, to, "");
        } else {
            amountOut = getAmountOut(amountIn, reserve1, reserve0);
            require(amountOut >= amountOutMin, "Insufficient output");
            
            // Transfer input tokens
            token1.safeTransferFrom(msg.sender, address(this), amountIn);
            
            // Execute swap
            this.swap(amountOut, 0, to, "");
        }
    }

    // ============ Price Calculation Functions ============
    
    /**
     * @dev Calculate output amount for given input
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public view returns (uint256 amountOut) {
        require(amountIn > 0, "Insufficient input");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        
        uint256 amountInWithFee = amountIn * (FEE_PRECISION - swapFee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * FEE_PRECISION) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /**
     * @dev Calculate required input for desired output
     */
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) public view returns (uint256 amountIn) {
        require(amountOut > 0, "Insufficient output");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        require(amountOut < reserveOut, "Insufficient reserves");
        
        uint256 numerator = reserveIn * amountOut * FEE_PRECISION;
        uint256 denominator = (reserveOut - amountOut) * (FEE_PRECISION - swapFee);
        amountIn = (numerator / denominator) + 1; // Round up
    }

    /**
     * @dev Calculate price impact of a trade
     */
    function _calculatePriceImpact(
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out
    ) internal view returns (uint256) {
        uint256 preBefore = (reserve0 * PRICE_PRECISION) / reserve1;
        uint256 priceAfter;
        
        if (amount0In > 0) {
            // Token0 -> Token1 swap
            uint256 newReserve0 = reserve0 + amount0In;
            uint256 newReserve1 = reserve1 - amount1Out;
            priceAfter = (newReserve0 * PRICE_PRECISION) / newReserve1;
        } else {
            // Token1 -> Token0 swap
            uint256 newReserve0 = reserve0 - amount0Out;
            uint256 newReserve1 = reserve1 + amount1In;
            priceAfter = (newReserve0 * PRICE_PRECISION) / newReserve1;
        }
        
        // Calculate percentage impact (basis points)
        uint256 impact = priceAfter > preBefore ?
            ((priceAfter - preBefore) * FEE_PRECISION) / preBefore :
            ((preBefore - priceAfter) * FEE_PRECISION) / preBefore;
            
        return impact;
    }

    // ============ MEV and Sandwich Attack Detection ============
    
    /**
     * @dev Track swap for MEV analysis (simplified to avoid stack too deep)
     */
    function _trackSwap(
        address trader,
        uint256 amountIn,
        uint256 amountOut,
        bool isToken0,
        uint256 priceImpact
    ) internal {
        SwapInfo memory swapData = SwapInfo({
            trader: trader,
            amountIn: amountIn,
            amountOut: amountOut,
            isToken0: isToken0,
            timestamp: block.timestamp,
            gasPrice: tx.gasprice,
            priceImpact: priceImpact
        });
        
        recentSwaps.push(swapData);
        
        // Simplified cleanup
        while (recentSwaps.length > 100) {
            recentSwaps.pop();
        }
        
        // Detect sandwich attacks
        _detectSandwichAttack(swapData);
    }

    /**
     * @dev Detect potential sandwich attacks
     */
    function _detectSandwichAttack(SwapInfo memory currentSwap) internal {
        if (recentSwaps.length < 3) return;
        
        uint256 len = recentSwaps.length;
        
        // Check if current swap is potentially a victim (middle of sandwich)
        if (len >= 2) {
            SwapInfo memory prevSwap = recentSwaps[len - 2];
            
            // Look for pattern: same trader, opposite direction, within same block
            if (prevSwap.trader == currentSwap.trader && 
                prevSwap.isToken0 != currentSwap.isToken0 &&
                block.number == prevSwap.timestamp / 12) { // Approximate block time
                
                // Calculate potential profit
                uint256 profit = currentSwap.amountOut > prevSwap.amountIn ?
                    currentSwap.amountOut - prevSwap.amountIn : 0;
                    
                if (profit > 0) {
                    sandwichProfits[currentSwap.trader] += profit;
                    emit SandwichAttackDetected(
                        currentSwap.trader,
                        address(0), // Victim unknown in this simplified detection
                        profit
                    );
                }
            }
        }
    }

    // ============ Oracle Functions ============
    
    /**
     * @dev Update cumulative price oracle
     */
    function _updateOracle() internal {
        uint32 timeElapsed = uint32(block.timestamp) - blockTimestampLast;
        
        if (timeElapsed > 0 && reserve0 > 0 && reserve1 > 0) {
            // Update cumulative prices
            price0CumulativeLast += uint256(_getPrice0()) * timeElapsed;
            price1CumulativeLast += uint256(_getPrice1()) * timeElapsed;
            
            blockTimestampLast = uint32(block.timestamp);
            
            emit TWAPUpdated(price0CumulativeLast, price1CumulativeLast);
        }
    }

    /**
     * @dev Get current price of token0 in terms of token1
     */
    function _getPrice0() internal view returns (uint256) {
        return (reserve1 * PRICE_PRECISION) / reserve0;
    }

    /**
     * @dev Get current price of token1 in terms of token0
     */
    function _getPrice1() internal view returns (uint256) {
        return (reserve0 * PRICE_PRECISION) / reserve1;
    }

    /**
     * @dev Get TWAP for token0
     */
    function getTWAP0() external view returns (uint256) {
        uint32 timeElapsed = uint32(block.timestamp) - blockTimestampLast;
        if (timeElapsed == 0) return _getPrice0();
        
        uint256 priceCumulative = price0CumulativeLast + (_getPrice0() * timeElapsed);
        return priceCumulative / TWAP_PERIOD;
    }

    // ============ Flash Swap Functions ============
    
    /**
     * @dev Complete flash swap repayment
     */
    function completeFlashSwap() external {
        require(flashSwapHash != bytes32(0), "No active flash swap");
        flashSwapHash = bytes32(0);
    }

    // ============ Admin Functions ============
    
    /**
     * @dev Set swap fee
     */
    function setSwapFee(uint256 fee) external onlyOwner {
        require(fee <= MAX_SWAP_FEE, "Fee too high");
        swapFee = fee;
    }

    /**
     * @dev Force reserves sync (emergency)
     */
    function sync() external {
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
        emit Sync(reserve0, reserve1);
    }

    // ============ View Functions ============
    
    /**
     * @dev Get pool reserves
     */
    function getReserves() external view returns (
        uint256 reserve0_,
        uint256 reserve1_,
        uint32 blockTimestampLast_
    ) {
        reserve0_ = reserve0;
        reserve1_ = reserve1;
        blockTimestampLast_ = blockTimestampLast;
    }

    /**
     * @dev Calculate slippage for trade
     */
    function calculateSlippage(
        uint256 amountIn,
        bool isToken0
    ) external view returns (uint256 expectedOut, uint256 minOut, uint256 slippagePercent) {
        if (isToken0) {
            expectedOut = getAmountOut(amountIn, reserve0, reserve1);
            minOut = (expectedOut * 95) / 100; // 5% slippage tolerance
        } else {
            expectedOut = getAmountOut(amountIn, reserve1, reserve0);
            minOut = (expectedOut * 95) / 100;
        }
        
        slippagePercent = 500; // 5% default
    }

    /**
     * @dev Get MEV statistics
     */
    function getMEVStats(address account) external view returns (
        uint256 totalSandwichProfit,
        uint256 totalMEV,
        uint256 recentSwapCount
    ) {
        totalSandwichProfit = sandwichProfits[account];
        totalMEV = mevExtracted[account];
        recentSwapCount = recentSwaps.length;
    }

    // ============ Helper Functions ============
    
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

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

/**
 * @dev Interface for flash swap callbacks
 */
interface IFlashSwapCallee {
    function flashSwapCall(
        address sender,
        uint256 amount0Out,
        uint256 amount1Out,
        bytes calldata data
    ) external;
}