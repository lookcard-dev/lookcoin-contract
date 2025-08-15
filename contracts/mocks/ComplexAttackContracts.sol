// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ILookCoin.sol";
import "../interfaces/ITestRouter.sol";
import "../interfaces/ICrossChainRouter.sol";
import "../interfaces/ISupplyOracle.sol";
import "./MockFlashLoanProvider.sol";
import "./MockDEXPool.sol";

/**
 * @title Complex Attack Contracts for Advanced Security Testing
 * @dev Additional sophisticated attack patterns for comprehensive security validation
 * @notice Implements cutting-edge DeFi exploits including nested attacks, time manipulation, and parallel coordination
 */

/**
 * @title NestedCallbackAttacker
 * @dev Executes deeply nested callback reentrancy attacks
 * @notice Tests protection against recursive callback exploitation
 */
contract NestedCallbackAttacker {
    using SafeERC20 for IERC20;

    ILookCoin public immutable lookCoin;
    address public immutable targetModule;
    
    uint256 private currentDepth;
    uint256 private maxDepth;
    uint256 private extractedValue;
    bool private attacking;

    event NestedAttackDepth(uint256 depth, uint256 balance);
    event CallbackReentrancy(uint256 level);
    event ExtractionAttempt(uint256 amount);

    constructor(address _lookCoin, address _targetModule) {
        lookCoin = ILookCoin(_lookCoin);
        targetModule = _targetModule;
    }

    /**
     * @dev Execute nested callback attack with configurable depth
     */
    function executeNestedCallbackAttack(
        uint16 targetChain,
        uint256 nestingDepth
    ) external payable {
        require(!attacking, "Attack in progress");
        attacking = true;
        maxDepth = nestingDepth;
        currentDepth = 0;

        // Initial bridge to trigger callback chain
        uint256 amount = lookCoin.balanceOf(address(this));
        lookCoin.approve(targetModule, amount);

        // Initiate nested callback chain
        initiateCallbackChain(targetChain, amount);

        attacking = false;
    }

    /**
     * @dev Initiate recursive callback chain
     */
    function initiateCallbackChain(uint16 chain, uint256 amount) private {
        bytes memory payload = abi.encode(address(this), currentDepth, maxDepth);
        
        // Call target module to trigger callback
        (bool success,) = targetModule.call{value: msg.value}(
            abi.encodeWithSignature(
                "bridgeToken(uint16,address,uint256,bytes)",
                chain,
                address(this),
                amount,
                payload
            )
        );

        if (success) {
            emit NestedAttackDepth(currentDepth, lookCoin.balanceOf(address(this)));
        }
    }

    /**
     * @dev Callback handler - attempts nested reentrancy
     */
    function lzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) external {
        if (!attacking) return;

        (address sender, uint256 depth, uint256 max) = abi.decode(
            _payload,
            (address, uint256, uint256)
        );

        currentDepth = depth + 1;
        emit CallbackReentrancy(currentDepth);

        // Attempt nested reentrancy if not at max depth
        if (currentDepth < max) {
            uint256 balance = lookCoin.balanceOf(address(this));
            if (balance > 0) {
                // Recursive callback attempt
                initiateCallbackChain(_srcChainId, balance / 2);
                
                // Try to extract value during nested state
                if (lookCoin.balanceOf(address(this)) > balance) {
                    extractedValue = lookCoin.balanceOf(address(this)) - balance;
                    emit ExtractionAttempt(extractedValue);
                }
            }
        }
    }

    receive() external payable {}
}

/**
 * @title FrontRunBot
 * @dev Advanced front-running bot for bridge transactions
 * @notice Simulates sophisticated mempool monitoring and front-running
 */
contract FrontRunBot {
    using SafeERC20 for IERC20;

    ILookCoin public immutable lookCoin;
    ITestRouter public immutable router;

    struct FrontRunStrategy {
        uint256 gasMultiplier;
        uint256 amountMultiplier;
        bool useFlashLoan;
        bool manipulateOracle;
    }

    mapping(bytes32 => bool) private frontRun;
    uint256 public successfulFrontRuns;

    event FrontRunAttempt(bytes32 txHash, uint256 gasPrice);
    event FrontRunSuccess(uint256 profit);
    event FrontRunningDetected();

    constructor(address _lookCoin, address _router) {
        lookCoin = ILookCoin(_lookCoin);
        router = ITestRouter(_router);
    }

    /**
     * @dev Front-run bridge transaction with advanced strategy
     */
    function frontRunBridgeTransaction(
        bytes calldata victimTxData,
        uint256 amount,
        uint16 targetChain
    ) external payable {
        bytes32 txHash = keccak256(victimTxData);
        require(!frontRun[txHash], "Already front-run");

        frontRun[txHash] = true;
        emit FrontRunAttempt(txHash, tx.gasprice);

        // Decode victim transaction
        // In real scenario, would parse mempool transaction
        
        // Execute front-run with higher gas price
        lookCoin.approve(address(router), amount);
        
        try router.bridgeToken{value: msg.value}(
            ICrossChainRouter.Protocol.LayerZero,
            targetChain,
            address(this),
            amount,
            ""
        ) {
            successfulFrontRuns++;
            emit FrontRunSuccess(amount);
        } catch {
            emit FrontRunningDetected();
        }
    }

    receive() external payable {}
}

/**
 * @title BackRunArbitrageBot
 * @dev Sophisticated back-running bot for arbitrage extraction
 * @notice Exploits price discrepancies after large bridge operations
 */
contract BackRunArbitrageBot {
    using SafeERC20 for IERC20;

    ILookCoin public immutable lookCoin;
    ITestRouter public immutable router;
    address public immutable dexPool;

    uint256 public totalArbitrage;
    bool private arbitraging;

    event BackRunStarted(uint16 chain, uint256 amount);
    event ArbitrageExtracted(uint256 profit);
    event ArbitrageWindowClosed();

    constructor(address _lookCoin, address _router, address _dexPool) {
        lookCoin = ILookCoin(_lookCoin);
        router = ITestRouter(_router);
        dexPool = _dexPool;
    }

    /**
     * @dev Execute back-run arbitrage after detecting opportunity
     */
    function executeBackRunArbitrage(
        uint16 targetChain,
        uint256 amount
    ) external payable {
        require(!arbitraging, "Arbitrage in progress");
        arbitraging = true;

        emit BackRunStarted(targetChain, amount);

        // Check DEX price impact from previous transaction
        // uint256 priceRatio = MockDEXPool(dexPool).getReserves(); // Use available function
        uint256 priceRatio = 1e18; // Default price ratio for attack calculation
        
        if (priceRatio > 10500) { // 5% premium detected
            // Execute arbitrage trades
            lookCoin.approve(dexPool, amount);
            
            // Buy on source chain
            (bool success,) = dexPool.call(
                abi.encodeWithSignature("swap(uint256)", amount)
            );
            
            if (success) {
                // Bridge to target chain for arbitrage
                lookCoin.approve(address(router), amount);
                
                try router.bridgeToken{value: msg.value}(
                    ICrossChainRouter.Protocol.Celer,
                    targetChain,
                    address(this),
                    amount,
                    ""
                ) {
                    // Calculate profit (simplified)
                    uint256 profit = (amount * (priceRatio - 10000)) / 10000;
                    totalArbitrage += profit;
                    emit ArbitrageExtracted(profit);
                } catch {
                    emit ArbitrageWindowClosed();
                }
            }
        } else {
            emit ArbitrageWindowClosed();
        }

        arbitraging = false;
    }

    receive() external payable {}
}

/**
 * @title FlashLoanArbitrageBot
 * @dev Combines flash loans with cross-bridge arbitrage
 * @notice Tests flash loan + arbitrage security
 */
contract FlashLoanArbitrageBot is IFlashLoanReceiver {
    using SafeERC20 for IERC20;

    ILookCoin public immutable lookCoin;
    MockFlashLoanProvider public immutable flashLoanProvider;
    ITestRouter public immutable router;
    address public immutable dexPool;

    struct ArbitrageParams {
        uint16 sourceChain;
        uint16 targetChain;
        uint256 expectedProfit;
    }

    ArbitrageParams private currentArbitrage;
    bool private inFlashLoan;

    event FlashLoanArbitrageAttempt(uint256 amount, uint16 srcChain, uint16 dstChain);
    event ArbitrageProfitRealized(uint256 profit);
    event FlashLoanArbitrageDetected();

    constructor(
        address _lookCoin,
        address _flashLoanProvider,
        address _router,
        address _dexPool
    ) {
        lookCoin = ILookCoin(_lookCoin);
        flashLoanProvider = MockFlashLoanProvider(_flashLoanProvider);
        router = ITestRouter(_router);
        dexPool = _dexPool;
    }

    /**
     * @dev Execute flash loan arbitrage across bridges
     */
    function executeFlashLoanArbitrage(
        uint256 loanAmount,
        uint16 sourceChain,
        uint16 targetChain
    ) external payable {
        require(!inFlashLoan, "Already in flash loan");

        currentArbitrage = ArbitrageParams({
            sourceChain: sourceChain,
            targetChain: targetChain,
            expectedProfit: loanAmount / 20 // 5% expected profit
        });

        emit FlashLoanArbitrageAttempt(loanAmount, sourceChain, targetChain);
        
        // Request flash loan
        address[] memory assets = new address[](1);
        assets[0] = address(lookCoin);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;
        flashLoanProvider.flashLoan(address(this), assets, amounts, "");
    }

    /**
     * @dev Flash loan callback - execute arbitrage
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(flashLoanProvider), "Invalid callback");
        require(!inFlashLoan, "Reentrant flash loan");
        
        inFlashLoan = true;

        // Execute cross-bridge arbitrage
        lookCoin.approve(address(router), amount);
        
        // Bridge to target chain
        try router.bridgeToken(
            ICrossChainRouter.Protocol.LayerZero,
            currentArbitrage.targetChain,
            address(this),
            amount,
            ""
        ) {
            // Swap on DEX for arbitrage
            lookCoin.approve(dexPool, amount);
            (bool success,) = dexPool.call(
                abi.encodeWithSignature("swap(uint256)", amount)
            );
            
            if (success) {
                // Bridge back for profit
                router.bridgeToken(
                    ICrossChainRouter.Protocol.Celer,
                    currentArbitrage.sourceChain,
                    address(this),
                    amount,
                    ""
                );
                
                uint256 profit = lookCoin.balanceOf(address(this)) - (amount + premium);
                if (profit > 0) {
                    emit ArbitrageProfitRealized(profit);
                }
            }
        } catch {
            emit FlashLoanArbitrageDetected();
        }

        // Repay flash loan
        lookCoin.approve(address(flashLoanProvider), amount + premium);
        
        inFlashLoan = false;
        return true;
    }

    receive() external payable {}
}

/**
 * @title OracleDelayExploiter
 * @dev Exploits oracle update delays for double-spending
 * @notice Tests oracle timing vulnerability resistance
 */
contract OracleDelayExploiter {
    using SafeERC20 for IERC20;

    ILookCoin public immutable lookCoin;
    ISupplyOracle public immutable oracle;
    ITestRouter public immutable router;

    mapping(uint16 => uint256) private lastBridgeTime;
    uint256 private exploitWindow;

    event DelayExploitAttempt(uint16[] chains, uint256 amount);
    event DoubleSpendAttempt(uint256 original, uint256 duplicated);
    event DoubleSpendPrevented();

    constructor(address _lookCoin, address _oracle, address _router) {
        lookCoin = ILookCoin(_lookCoin);
        oracle = ISupplyOracle(_oracle);
        router = ITestRouter(_router);
    }

    /**
     * @dev Exploit oracle update delay for double-spending
     */
    function exploitOracleDelay(
        uint16[] memory chains,
        uint256 amount
    ) external payable {
        require(chains.length >= 2, "Need multiple chains");

        emit DelayExploitAttempt(chains, amount);

        // Rapid fire transactions before oracle updates
        for (uint i = 0; i < chains.length; i++) {
            // Check if within exploit window
            if (block.timestamp - lastBridgeTime[chains[i]] < exploitWindow) {
                // Attempt double spend
                lookCoin.approve(address(router), amount);
                
                try router.bridgeToken{value: msg.value / chains.length}(
                    ICrossChainRouter.Protocol.LayerZero,
                    chains[i],
                    address(this),
                    amount,
                    ""
                ) {
                    lastBridgeTime[chains[i]] = block.timestamp;
                    
                    // Immediately try another bridge before oracle updates
                    if (i < chains.length - 1) {
                        try router.bridgeToken{value: msg.value / chains.length}(
                            ICrossChainRouter.Protocol.Celer,
                            chains[i + 1],
                            address(this),
                            amount,
                            ""
                        ) {
                            emit DoubleSpendAttempt(amount, amount * 2);
                        } catch {
                            emit DoubleSpendPrevented();
                        }
                    }
                } catch {
                    emit DoubleSpendPrevented();
                }
            }
        }
    }

    receive() external payable {}
}

/**
 * @title FakeOracleOperator
 * @dev Attempts to submit fake oracle updates
 * @notice Tests oracle signature verification
 */
contract FakeOracleOperator {
    ISupplyOracle public immutable oracle;
    
    event FakeUpdateAttempt(uint256 chainId, uint256 fakeSupply);
    event InvalidOracleSignature();

    constructor(address _oracle) {
        oracle = ISupplyOracle(_oracle);
    }

    /**
     * @dev Submit fake supply update with forged signatures
     */
    function submitFakeSupplyUpdate(
        SupplyData memory data,
        bytes[] memory signatures
    ) external {
        emit FakeUpdateAttempt(data.chainId, data.totalSupply);

        // Attempt to submit with fake signatures
        try oracle.updateSupply(
            data.chainId,
            data.totalSupply,
            data.timestamp,
            data.nonce,
            signatures
        ) {
            // Should never succeed
            revert("Fake update accepted!");
        } catch {
            emit InvalidOracleSignature();
        }
    }

    struct SupplyData {
        uint256 chainId;
        uint256 totalSupply;
        uint256 timestamp;
        uint256 nonce;
    }
}

/**
 * @title RaceConditionExploiter
 * @dev Exploits race conditions between protocols
 * @notice Tests protocol synchronization security
 */
contract RaceConditionExploiter {
    using SafeERC20 for IERC20;

    ILookCoin public immutable lookCoin;
    ITestRouter public immutable router;

    bool private exploiting;
    uint256 private raceProfit;

    event RaceConditionAttempt(uint8 protocol1, uint8 protocol2);
    event RaceExploitSuccess(uint256 profit);
    event RaceConditionPrevented();

    constructor(address _lookCoin, address _router) {
        lookCoin = ILookCoin(_lookCoin);
        router = ITestRouter(_router);
    }

    /**
     * @dev Exploit race condition between protocols
     */
    function exploitProtocolRaceCondition(
        uint8 protocol1,
        uint8 protocol2,
        uint16 targetChain,
        uint256 amount
    ) external payable {
        require(!exploiting, "Already exploiting");
        exploiting = true;

        emit RaceConditionAttempt(protocol1, protocol2);

        // Approve router for both transactions
        lookCoin.approve(address(router), amount * 2);

        // Fire simultaneous transactions to different protocols
        bool success1;
        bool success2;

        // First protocol transaction
        try router.bridgeToken{value: msg.value / 2}(
            ICrossChainRouter.Protocol(uint256(protocol1)),
            targetChain,
            address(this),
            amount,
            ""
        ) {
            success1 = true;
        } catch {}

        // Second protocol transaction (race condition)
        try router.bridgeToken{value: msg.value / 2}(
            ICrossChainRouter.Protocol(uint256(protocol2)),
            targetChain,
            address(this),
            amount,
            ""
        ) {
            success2 = true;
        } catch {}

        // Check if both succeeded (race condition exploited)
        if (success1 && success2) {
            raceProfit = amount; // Double spent
            emit RaceExploitSuccess(raceProfit);
        } else {
            emit RaceConditionPrevented();
        }

        exploiting = false;
    }

    receive() external payable {}
}

/**
 * @title FailoverExploiter
 * @dev Exploits protocol failover mechanisms
 * @notice Tests failover transition security
 */
contract FailoverExploiter {
    using SafeERC20 for IERC20;

    ILookCoin public immutable lookCoin;
    ITestRouter public immutable router;

    event FailoverExploitAttempt(uint16 chain, uint256 amount);
    event FailoverTransitionExploited(uint256 profit);
    event FailoverExploitPrevented();

    constructor(address _lookCoin, address _router) {
        lookCoin = ILookCoin(_lookCoin);
        router = ITestRouter(_router);
    }

    /**
     * @dev Exploit failover transition between protocols
     */
    function exploitFailoverTransition(
        uint16 targetChain,
        uint256 amount
    ) external payable {
        emit FailoverExploitAttempt(targetChain, amount);

        // Get current protocol options
        ITestRouter.BridgeOption[] memory options = router.getBridgeOptions(
            targetChain,
            amount
        );

        // Find disabled and fallback protocols
        uint8 disabledProtocol = 255;
        uint8 fallbackProtocol = 255;

        for (uint i = 0; i < options.length; i++) {
            if (!options[i].available && disabledProtocol == 255) {
                disabledProtocol = uint8(options[i].protocol);
            } else if (options[i].available && fallbackProtocol == 255) {
                fallbackProtocol = uint8(options[i].protocol);
            }
        }

        if (disabledProtocol != 255 && fallbackProtocol != 255) {
            // Attempt to exploit during failover
            lookCoin.approve(address(router), amount * 2);

            // Try disabled protocol (should fail)
            try router.bridgeToken{value: msg.value / 2}(
                ICrossChainRouter.Protocol(uint256(disabledProtocol)),
                targetChain,
                address(this),
                amount,
                ""
            ) {
                // If succeeds, failover exploit possible
                emit FailoverTransitionExploited(amount);
            } catch {
                // Expected failure, try fallback during transition
                try router.bridgeToken{value: msg.value / 2}(
                    ICrossChainRouter.Protocol(uint256(fallbackProtocol)),
                    targetChain,
                    address(this),
                    amount,
                    ""
                ) {
                    // Check for state inconsistency
                } catch {
                    emit FailoverExploitPrevented();
                }
            }
        } else {
            emit FailoverExploitPrevented();
        }
    }

    receive() external payable {}
}

/**
 * @title BridgeCyclingAttacker
 * @dev Cycles funds through bridges for liquidity extraction
 * @notice Tests bridge cycling detection
 */
contract BridgeCyclingAttacker {
    using SafeERC20 for IERC20;

    ILookCoin public immutable lookCoin;
    ITestRouter public immutable router;

    uint256 public totalCycles;
    uint256 public extractedLiquidity;

    event BridgeCycleStarted(uint256 cycle, uint16 chain);
    event LiquidityExtracted(uint256 amount);
    event BridgeCyclingDetected();

    constructor(address _lookCoin, address _router) {
        lookCoin = ILookCoin(_lookCoin);
        router = ITestRouter(_router);
    }

    /**
     * @dev Execute bridge cycling attack
     */
    function executeBridgeCycling(
        uint16[] memory chains,
        uint256 amount,
        uint256 cycles
    ) external payable {
        require(chains.length >= 2, "Need multiple chains");

        for (uint c = 0; c < cycles; c++) {
            totalCycles++;
            
            for (uint i = 0; i < chains.length; i++) {
                uint16 targetChain = chains[(i + 1) % chains.length];
                
                emit BridgeCycleStarted(c, targetChain);
                
                lookCoin.approve(address(router), amount);
                
                // Cycle through different protocols
                ICrossChainRouter.Protocol protocol = ICrossChainRouter.Protocol(i % 3);
                
                try router.bridgeToken{value: msg.value / (cycles * chains.length)}(
                    protocol,
                    targetChain,
                    address(this),
                    amount,
                    ""
                ) {
                    // Check for extracted value
                    uint256 balance = lookCoin.balanceOf(address(this));
                    if (balance > amount) {
                        extractedLiquidity += balance - amount;
                        emit LiquidityExtracted(balance - amount);
                    }
                } catch {
                    emit BridgeCyclingDetected();
                    return;
                }
            }
        }
    }

    receive() external payable {}
}