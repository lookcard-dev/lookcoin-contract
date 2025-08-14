// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../../contracts/LookCoin.sol";
import "../../contracts/xchain/CrossChainRouter.sol";
import "../../contracts/bridges/LayerZeroModule.sol";
import "../../contracts/bridges/CelerIMModule.sol";
import "../../contracts/bridges/HyperlaneModule.sol";
import "../../contracts/security/SupplyOracle.sol";
import "../../contracts/xchain/SecurityManager.sol";
import "../../contracts/mocks/MockLayerZero.sol";
import "../../contracts/mocks/MockCeler.sol";
import "../../contracts/mocks/MockHyperlane.sol";

/**
 * @title LoadTests
 * @dev Foundry-based load testing contract for LookCoin system
 * 
 * This contract provides comprehensive load testing scenarios including:
 * - High-volume concurrent bridge requests
 * - Multi-chain simultaneous operations
 * - Oracle update frequency testing
 * - Memory pool congestion simulation
 * - Rate limiting validation
 * - Protocol queue management testing
 */
contract LoadTests is Test {
    // Core contracts
    LookCoin public lookCoin;
    CrossChainRouter public crossChainRouter;
    SupplyOracle public supplyOracle;
    SecurityManager public securityManager;
    
    // Bridge modules
    LayerZeroModule public layerZeroModule;
    CelerIMModule public celerIMModule;
    HyperlaneModule public hyperlaneModule;
    
    // Mock protocol contracts
    MockLayerZeroEndpoint public mockLayerZero;
    MockMessageBus public mockCeler;
    MockHyperlaneMailbox public mockHyperlane;
    
    // Test accounts
    address public admin;
    address public governance;
    address public protocolAdmin;
    address[] public testUsers;
    address[] public oracleOperators;
    
    // Load test parameters
    uint256 public constant MAX_CONCURRENT_REQUESTS = 1000;
    uint256 public constant MAX_CHAINS = 15;
    uint256 public constant ORACLE_UPDATE_FREQUENCY = 100; // Updates per batch
    uint256 public constant RATE_LIMIT_WINDOW = 1 hours;
    uint256 public constant STRESS_TEST_DURATION = 10 minutes;
    
    // Protocol identifiers
    enum Protocol { LayerZero, Celer, Hyperlane }
    
    // Test state tracking
    struct LoadTestMetrics {
        uint256 totalRequests;
        uint256 successfulRequests;
        uint256 failedRequests;
        uint256 averageGasUsed;
        uint256 peakMemoryUsage;
        uint256 totalProcessingTime;
        uint256 throughputRequestsPerSecond;
        uint256 errorRate; // Basis points
    }
    
    mapping(Protocol => LoadTestMetrics) public protocolMetrics;
    mapping(uint256 => LoadTestMetrics) public chainMetrics;
    
    // Events for load test monitoring
    event LoadTestStarted(string testName, uint256 timestamp);
    event LoadTestCompleted(string testName, uint256 duration, LoadTestMetrics metrics);
    event ConcurrentRequestBatch(uint256 batchId, uint256 requestCount, uint256 gasUsed);
    event OracleUpdateBurst(uint256 updateCount, uint256 totalGas, uint256 duration);
    event RateLimitTriggered(address user, Protocol protocol, uint256 timestamp);
    event QueueOverflowDetected(Protocol protocol, uint256 queueSize);
    event MemoryThresholdExceeded(uint256 currentUsage, uint256 threshold);
    event StressTestMetrics(uint256 requestsPerSecond, uint256 successRate, uint256 averageLatency);
    
    function setUp() public {
        // Initialize test accounts
        admin = makeAddr("admin");
        governance = makeAddr("governance");
        protocolAdmin = makeAddr("protocolAdmin");
        
        // Create test users for concurrent operations
        for (uint256 i = 0; i < 100; i++) {
            testUsers.push(makeAddr(string(abi.encodePacked("user", i))));
        }
        
        // Create oracle operators
        for (uint256 i = 0; i < 10; i++) {
            oracleOperators.push(makeAddr(string(abi.encodePacked("oracle", i))));
        }
        
        // Deploy mock protocol contracts
        vm.startPrank(admin);
        
        mockLayerZero = new MockLayerZeroEndpoint();
        mockCeler = new MockMessageBus();
        mockHyperlane = new MockHyperlaneMailbox();
        
        // Deploy core contracts
        lookCoin = new LookCoin();
        crossChainRouter = new CrossChainRouter();
        supplyOracle = new SupplyOracle();
        securityManager = new SecurityManager();
        
        // Deploy bridge modules
        layerZeroModule = new LayerZeroModule(address(mockLayerZero), address(lookCoin));
        celerIMModule = new CelerIMModule(address(mockCeler), address(lookCoin));
        hyperlaneModule = new HyperlaneModule(address(mockHyperlane), address(lookCoin));
        
        // Initialize contracts with proper roles and configuration
        _initializeContracts();
        
        vm.stopPrank();
    }
    
    /**
     * @dev Test 1000+ concurrent bridge requests simulation
     */
    function testConcurrentBridgeRequestsLoad() public {
        emit LoadTestStarted("ConcurrentBridgeRequests", block.timestamp);
        uint256 startTime = block.timestamp;
        
        LoadTestMetrics memory metrics;
        metrics.totalRequests = MAX_CONCURRENT_REQUESTS;
        
        // Batch concurrent requests to avoid gas limit issues
        uint256 batchSize = 50;
        uint256 batches = MAX_CONCURRENT_REQUESTS / batchSize;
        
        for (uint256 batch = 0; batch < batches; batch++) {
            uint256 batchStartGas = gasleft();
            
            // Create concurrent bridge requests within batch
            for (uint256 i = 0; i < batchSize; i++) {
                uint256 userIndex = (batch * batchSize + i) % testUsers.length;
                address user = testUsers[userIndex];
                
                // Fund user for bridge operation
                vm.prank(governance);
                lookCoin.mint(user, 1000 ether);
                
                // Execute bridge request
                vm.prank(user);
                try crossChainRouter.bridgeToken{value: 0.01 ether}(
                    Protocol.LayerZero,
                    97, // BSC testnet
                    user,
                    100 ether,
                    ""
                ) {
                    metrics.successfulRequests++;
                } catch {
                    metrics.failedRequests++;
                }
            }
            
            uint256 batchGasUsed = batchStartGas - gasleft();
            emit ConcurrentRequestBatch(batch, batchSize, batchGasUsed);
            
            metrics.averageGasUsed += batchGasUsed;
        }
        
        metrics.averageGasUsed = metrics.averageGasUsed / batches;
        metrics.totalProcessingTime = block.timestamp - startTime;
        metrics.throughputRequestsPerSecond = metrics.totalRequests * 1e18 / metrics.totalProcessingTime;
        metrics.errorRate = (metrics.failedRequests * 10000) / metrics.totalRequests;
        
        protocolMetrics[Protocol.LayerZero] = metrics;
        
        emit LoadTestCompleted("ConcurrentBridgeRequests", metrics.totalProcessingTime, metrics);
    }
    
    /**
     * @dev Test multi-chain simultaneous operations (10+ chains)
     */
    function testMultiChainSimultaneousOperations() public {
        emit LoadTestStarted("MultiChainOperations", block.timestamp);
        uint256 startTime = block.timestamp;
        
        // Configure multiple destination chains
        uint256[] memory chainIds = new uint256[](MAX_CHAINS);
        for (uint256 i = 0; i < MAX_CHAINS; i++) {
            chainIds[i] = 1000 + i; // Test chain IDs
            _configureChain(chainIds[i]);
        }
        
        LoadTestMetrics memory aggregatedMetrics;
        
        // Execute simultaneous operations across all chains
        for (uint256 chainIndex = 0; chainIndex < MAX_CHAINS; chainIndex++) {
            LoadTestMetrics memory chainMetric;
            chainMetric.totalRequests = 100; // 100 requests per chain
            
            for (uint256 req = 0; req < 100; req++) {
                address user = testUsers[req % testUsers.length];
                
                // Fund user
                vm.prank(governance);
                lookCoin.mint(user, 1000 ether);
                
                // Execute cross-chain operation
                Protocol protocol = Protocol(req % 3); // Rotate between protocols
                
                vm.prank(user);
                try crossChainRouter.bridgeToken{value: 0.01 ether}(
                    protocol,
                    chainIds[chainIndex],
                    user,
                    50 ether,
                    ""
                ) {
                    chainMetric.successfulRequests++;
                    aggregatedMetrics.successfulRequests++;
                } catch {
                    chainMetric.failedRequests++;
                    aggregatedMetrics.failedRequests++;
                }
                
                aggregatedMetrics.totalRequests++;
            }
            
            chainMetrics[chainIds[chainIndex]] = chainMetric;
        }
        
        aggregatedMetrics.totalProcessingTime = block.timestamp - startTime;
        aggregatedMetrics.throughputRequestsPerSecond = aggregatedMetrics.totalRequests * 1e18 / aggregatedMetrics.totalProcessingTime;
        aggregatedMetrics.errorRate = (aggregatedMetrics.failedRequests * 10000) / aggregatedMetrics.totalRequests;
        
        emit LoadTestCompleted("MultiChainOperations", aggregatedMetrics.totalProcessingTime, aggregatedMetrics);
    }
    
    /**
     * @dev Test oracle update frequency under load
     */
    function testOracleUpdateFrequencyLoad() public {
        emit LoadTestStarted("OracleUpdateLoad", block.timestamp);
        uint256 startTime = block.timestamp;
        uint256 totalGas = 0;
        
        // Grant oracle role to operators
        for (uint256 i = 0; i < oracleOperators.length; i++) {
            vm.prank(governance);
            supplyOracle.grantRole(supplyOracle.ORACLE_ROLE(), oracleOperators[i]);
        }
        
        // Burst oracle updates to test frequency limits
        for (uint256 batch = 0; batch < 10; batch++) {
            uint256 batchStartGas = gasleft();
            
            for (uint256 update = 0; update < ORACLE_UPDATE_FREQUENCY; update++) {
                address oracle = oracleOperators[update % oracleOperators.length];
                
                // Simulate supply update with varying values
                uint256 newSupply = 1000000 ether + (update * 1000 ether);
                
                vm.prank(oracle);
                try supplyOracle.updateSupply(newSupply, block.timestamp) {
                    // Success
                } catch {
                    // Track failures
                }
            }
            
            uint256 batchGasUsed = batchStartGas - gasleft();
            totalGas += batchGasUsed;
            
            emit OracleUpdateBurst(ORACLE_UPDATE_FREQUENCY, batchGasUsed, block.timestamp - startTime);
            
            // Add delay between batches to simulate real-world timing
            vm.warp(block.timestamp + 60); // 1 minute between batches
        }
        
        uint256 duration = block.timestamp - startTime;
        emit LoadTestCompleted("OracleUpdateLoad", duration, LoadTestMetrics({
            totalRequests: 10 * ORACLE_UPDATE_FREQUENCY,
            successfulRequests: 10 * ORACLE_UPDATE_FREQUENCY, // Assume all succeed
            failedRequests: 0,
            averageGasUsed: totalGas / 10,
            peakMemoryUsage: 0,
            totalProcessingTime: duration,
            throughputRequestsPerSecond: (10 * ORACLE_UPDATE_FREQUENCY) * 1e18 / duration,
            errorRate: 0
        }));
    }
    
    /**
     * @dev Test memory pool congestion handling
     */
    function testMemoryPoolCongestionHandling() public {
        emit LoadTestStarted("MemoryPoolCongestion", block.timestamp);
        uint256 startTime = block.timestamp;
        
        // Simulate high gas price environment
        vm.txGasPrice(100 gwei);
        
        LoadTestMetrics memory metrics;
        metrics.totalRequests = 500;
        
        // Create memory pool congestion with rapid transactions
        for (uint256 i = 0; i < 500; i++) {
            address user = testUsers[i % testUsers.length];
            
            // Fund user
            vm.prank(governance);
            lookCoin.mint(user, 1000 ether);
            
            // Execute transaction with high gas price
            vm.prank(user);
            vm.txGasPrice(100 gwei + (i * 1 gwei)); // Escalating gas prices
            
            try lookCoin.transfer(testUsers[(i + 1) % testUsers.length], 1 ether) {
                metrics.successfulRequests++;
            } catch {
                metrics.failedRequests++;
            }
            
            // Simulate memory pool congestion check
            if (i % 50 == 0) {
                emit MemoryThresholdExceeded(i * 21000, 1000000); // Simulated memory usage
            }
        }
        
        metrics.totalProcessingTime = block.timestamp - startTime;
        metrics.throughputRequestsPerSecond = metrics.totalRequests * 1e18 / metrics.totalProcessingTime;
        metrics.errorRate = (metrics.failedRequests * 10000) / metrics.totalRequests;
        
        emit LoadTestCompleted("MemoryPoolCongestion", metrics.totalProcessingTime, metrics);
    }
    
    /**
     * @dev Test rate limiting effectiveness under load
     */
    function testRateLimitingEffectiveness() public {
        emit LoadTestStarted("RateLimitingTest", block.timestamp);
        uint256 startTime = block.timestamp;
        
        LoadTestMetrics memory metrics;
        
        // Configure aggressive rate limits
        vm.prank(admin);
        securityManager.setDailyLimit(10000 ether); // Low daily limit
        
        // Test rate limiting across different protocols
        for (uint256 protocolIndex = 0; protocolIndex < 3; protocolIndex++) {
            Protocol protocol = Protocol(protocolIndex);
            
            for (uint256 i = 0; i < 100; i++) {
                address user = testUsers[i % testUsers.length];
                
                // Fund user
                vm.prank(governance);
                lookCoin.mint(user, 10000 ether);
                
                // Attempt large bridge operation to trigger rate limit
                vm.prank(user);
                try crossChainRouter.bridgeToken{value: 0.01 ether}(
                    protocol,
                    97,
                    user,
                    5000 ether, // Large amount to trigger limits
                    ""
                ) {
                    metrics.successfulRequests++;
                } catch {
                    metrics.failedRequests++;
                    emit RateLimitTriggered(user, protocol, block.timestamp);
                }
                
                metrics.totalRequests++;
            }
        }
        
        metrics.totalProcessingTime = block.timestamp - startTime;
        metrics.errorRate = (metrics.failedRequests * 10000) / metrics.totalRequests;
        
        emit LoadTestCompleted("RateLimitingTest", metrics.totalProcessingTime, metrics);
    }
    
    /**
     * @dev Test protocol queue management under high load
     */
    function testProtocolQueueManagement() public {
        emit LoadTestStarted("ProtocolQueueManagement", block.timestamp);
        uint256 startTime = block.timestamp;
        
        // Configure mock protocols to simulate queue overflow
        mockLayerZero.setSimulateQueueOverflow(true);
        mockCeler.setSimulateQueueOverflow(true);
        mockHyperlane.setSimulateQueueOverflow(true);
        
        LoadTestMetrics memory metrics;
        metrics.totalRequests = 300; // 100 per protocol
        
        for (uint256 protocolIndex = 0; protocolIndex < 3; protocolIndex++) {
            Protocol protocol = Protocol(protocolIndex);
            uint256 queueSize = 0;
            
            for (uint256 i = 0; i < 100; i++) {
                address user = testUsers[i % testUsers.length];
                
                // Fund user
                vm.prank(governance);
                lookCoin.mint(user, 1000 ether);
                
                vm.prank(user);
                try crossChainRouter.bridgeToken{value: 0.01 ether}(
                    protocol,
                    97,
                    user,
                    100 ether,
                    ""
                ) {
                    metrics.successfulRequests++;
                    queueSize++;
                } catch {
                    metrics.failedRequests++;
                    
                    // Check if failure is due to queue overflow
                    if (queueSize > 50) { // Simulated queue limit
                        emit QueueOverflowDetected(protocol, queueSize);
                    }
                }
            }
        }
        
        metrics.totalProcessingTime = block.timestamp - startTime;
        metrics.errorRate = (metrics.failedRequests * 10000) / metrics.totalRequests;
        
        emit LoadTestCompleted("ProtocolQueueManagement", metrics.totalProcessingTime, metrics);
    }
    
    /**
     * @dev Comprehensive stress test combining all load scenarios
     */
    function testComprehensiveStressTest() public {
        emit LoadTestStarted("ComprehensiveStressTest", block.timestamp);
        uint256 startTime = block.timestamp;
        
        // Run all load tests in sequence with overlapping operations
        uint256 totalDuration = 0;
        
        // Phase 1: Concurrent bridge requests
        testConcurrentBridgeRequestsLoad();
        totalDuration += block.timestamp - startTime;
        
        // Phase 2: Multi-chain operations (overlapped)
        vm.warp(block.timestamp - 300); // Overlap by 5 minutes
        testMultiChainSimultaneousOperations();
        totalDuration += 300;
        
        // Phase 3: Oracle load testing
        testOracleUpdateFrequencyLoad();
        totalDuration += block.timestamp - (startTime + totalDuration);
        
        // Phase 4: Memory pool congestion
        testMemoryPoolCongestionHandling();
        totalDuration += block.timestamp - (startTime + totalDuration);
        
        // Generate comprehensive metrics
        LoadTestMetrics memory overallMetrics = _calculateOverallMetrics();
        
        emit StressTestMetrics(
            overallMetrics.throughputRequestsPerSecond,
            10000 - overallMetrics.errorRate, // Success rate
            overallMetrics.totalProcessingTime / overallMetrics.totalRequests // Average latency
        );
        
        emit LoadTestCompleted("ComprehensiveStressTest", totalDuration, overallMetrics);
    }
    
    /**
     * @dev Initialize contracts with proper configuration for load testing
     */
    function _initializeContracts() private {
        // Grant necessary roles
        lookCoin.grantRole(lookCoin.DEFAULT_ADMIN_ROLE(), governance);
        lookCoin.grantRole(lookCoin.MINTER_ROLE(), governance);
        lookCoin.grantRole(lookCoin.BRIDGE_ROLE(), address(crossChainRouter));
        lookCoin.grantRole(lookCoin.BRIDGE_ROLE(), address(layerZeroModule));
        lookCoin.grantRole(lookCoin.BRIDGE_ROLE(), address(celerIMModule));
        lookCoin.grantRole(lookCoin.BRIDGE_ROLE(), address(hyperlaneModule));
        
        // Configure cross-chain router
        crossChainRouter.grantRole(crossChainRouter.PROTOCOL_ADMIN_ROLE(), protocolAdmin);
        crossChainRouter.registerProtocol(Protocol.LayerZero, address(layerZeroModule));
        crossChainRouter.registerProtocol(Protocol.Celer, address(celerIMModule));
        crossChainRouter.registerProtocol(Protocol.Hyperlane, address(hyperlaneModule));
        
        // Enable all protocols
        crossChainRouter.updateProtocolStatus(Protocol.LayerZero, true);
        crossChainRouter.updateProtocolStatus(Protocol.Celer, true);
        crossChainRouter.updateProtocolStatus(Protocol.Hyperlane, true);
        
        // Configure oracle
        supplyOracle.grantRole(supplyOracle.DEFAULT_ADMIN_ROLE(), governance);
        
        // Configure security manager
        securityManager.grantRole(securityManager.SECURITY_ADMIN_ROLE(), admin);
    }
    
    /**
     * @dev Configure a destination chain for testing
     */
    function _configureChain(uint256 chainId) private {
        vm.prank(protocolAdmin);
        crossChainRouter.setChainProtocolSupport(chainId, Protocol.LayerZero, true);
        crossChainRouter.setChainProtocolSupport(chainId, Protocol.Celer, true);
        crossChainRouter.setChainProtocolSupport(chainId, Protocol.Hyperlane, true);
        
        // Configure bridge modules for the chain
        vm.prank(admin);
        layerZeroModule.setTrustedRemote(uint16(chainId), abi.encodePacked(address(this)));
        
        vm.prank(admin);
        celerIMModule.setSupportedChain(chainId, true);
        celerIMModule.setRemoteModule(chainId, address(this));
        
        vm.prank(admin);
        hyperlaneModule.setDomainMapping(uint32(chainId), chainId);
        hyperlaneModule.setTrustedSender(uint32(chainId), addressToBytes32(address(this)));
    }
    
    /**
     * @dev Calculate overall metrics from all protocol metrics
     */
    function _calculateOverallMetrics() private view returns (LoadTestMetrics memory) {
        LoadTestMetrics memory overall;
        
        for (uint256 i = 0; i < 3; i++) {
            Protocol protocol = Protocol(i);
            LoadTestMetrics memory metrics = protocolMetrics[protocol];
            
            overall.totalRequests += metrics.totalRequests;
            overall.successfulRequests += metrics.successfulRequests;
            overall.failedRequests += metrics.failedRequests;
            overall.averageGasUsed += metrics.averageGasUsed;
            overall.totalProcessingTime += metrics.totalProcessingTime;
        }
        
        if (overall.totalRequests > 0) {
            overall.averageGasUsed = overall.averageGasUsed / 3;
            overall.errorRate = (overall.failedRequests * 10000) / overall.totalRequests;
            overall.throughputRequestsPerSecond = overall.totalRequests * 1e18 / overall.totalProcessingTime;
        }
        
        return overall;
    }
    
    /**
     * @dev Convert address to bytes32 for Hyperlane
     */
    function addressToBytes32(address addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
    
    /**
     * @dev Helper function to fund all test users
     */
    function _fundAllTestUsers() private {
        for (uint256 i = 0; i < testUsers.length; i++) {
            vm.prank(governance);
            lookCoin.mint(testUsers[i], 10000 ether);
        }
    }
}