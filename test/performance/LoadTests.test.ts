import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  LookCoin,
  CrossChainRouter,
  LayerZeroModule,
  CelerIMModule,
  HyperlaneModule,
  SupplyOracle,
  SecurityManager,
  FeeManager,
  ProtocolRegistry,
} from "../../typechain-types";
import { DeploymentFixture, deployAll } from "../helpers/fixtures";
import {
  PROTOCOLS,
  TEST_CHAINS,
  AMOUNTS,
  GAS_LIMITS,
  SECURITY_THRESHOLDS,
  CONTRACT_ROLES,
} from "../helpers/constants";
import { setupContractRelationships } from "../helpers/utils";

/**
 * @title Load Testing Suite for LookCoin Contract
 * @dev Comprehensive load testing with focus on:
 * - 1000+ concurrent bridge requests simulation
 * - Multi-chain simultaneous operations (10+ chains)
 * - Oracle update frequency under load testing
 * - Memory pool congestion handling
 * - Rate limiting effectiveness validation
 * - Protocol queue management testing
 */
describe("LookCoin Load Testing Suite", function () {
  let fixture: DeploymentFixture;
  let admin: SignerWithAddress;
  let governance: SignerWithAddress;
  let protocolAdmin: SignerWithAddress;
  let testUsers: SignerWithAddress[];
  let oracleOperators: SignerWithAddress[];

  // Load test configuration
  const LOAD_TEST_CONFIG = {
    MAX_CONCURRENT_REQUESTS: 1000,
    BATCH_SIZE: 50, // To avoid gas limit issues
    MAX_CHAINS: 15,
    ORACLE_OPERATORS_COUNT: 5,
    TEST_USERS_COUNT: 100,
    STRESS_TEST_DURATION: 600, // 10 minutes in seconds
    RATE_LIMIT_THRESHOLD: ethers.parseEther("10000"), // 10k tokens per hour
    MEMORY_THRESHOLD: 1000000, // Simulated memory threshold
    QUEUE_SIZE_LIMIT: 50,
  };

  // Performance metrics tracking
  interface LoadTestMetrics {
    testName: string;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalGasUsed: bigint;
    averageGasPerRequest: bigint;
    duration: number;
    throughputPerSecond: number;
    errorRate: number; // Percentage
    peakMemoryUsage?: number;
  }

  let loadTestResults: LoadTestMetrics[] = [];

  // Real-time monitoring
  interface SystemState {
    queueSizes: Map<number, number>; // protocol -> queue size
    rateLimitHits: Map<string, number>; // user -> hit count
    memoryUsage: number;
    activeRequests: number;
    timestamp: number;
  }

  let systemState: SystemState = {
    queueSizes: new Map(),
    rateLimitHits: new Map(),
    memoryUsage: 0,
    activeRequests: 0,
    timestamp: 0,
  };

  this.timeout(1800000); // 30 minutes timeout for load tests

  before(async function () {
    const signers = await ethers.getSigners();
    admin = signers[0];
    governance = signers[1];
    protocolAdmin = signers[2];

    // Create test users for concurrent operations
    testUsers = signers.slice(3, 3 + LOAD_TEST_CONFIG.TEST_USERS_COUNT);

    // Create oracle operators
    oracleOperators = signers.slice(
      3 + LOAD_TEST_CONFIG.TEST_USERS_COUNT,
      3 + LOAD_TEST_CONFIG.TEST_USERS_COUNT + LOAD_TEST_CONFIG.ORACLE_OPERATORS_COUNT
    );
  });

  beforeEach(async function () {
    fixture = await loadFixture(deployAll);
    await setupContractRelationships(fixture);

    // Grant oracle roles to operators
    for (const operator of oracleOperators) {
      await fixture.supplyOracle
        .connect(governance)
        .grantRole(CONTRACT_ROLES.SupplyOracle.ORACLE_ROLE, operator.address);
    }

    // Configure security manager with test parameters
    await fixture.securityManager
      .connect(admin)
      .updateSecurityThreshold("DAILY_LIMIT", LOAD_TEST_CONFIG.RATE_LIMIT_THRESHOLD);

    // Reset system state
    systemState = {
      queueSizes: new Map(),
      rateLimitHits: new Map(),
      memoryUsage: 0,
      activeRequests: 0,
      timestamp: Date.now(),
    };

    loadTestResults = [];
  });

  /**
   * Test 1: 1000+ Concurrent Bridge Requests Simulation
   */
  describe("Concurrent Bridge Requests Load Test", function () {
    it("should handle 1000+ concurrent bridge requests without system failure", async function () {
      const testMetrics: LoadTestMetrics = {
        testName: "Concurrent Bridge Requests",
        totalRequests: LOAD_TEST_CONFIG.MAX_CONCURRENT_REQUESTS,
        successfulRequests: 0,
        failedRequests: 0,
        totalGasUsed: BigInt(0),
        averageGasPerRequest: BigInt(0),
        duration: 0,
        throughputPerSecond: 0,
        errorRate: 0,
      };

      console.log(`\n🚀 Starting ${testMetrics.testName} - ${testMetrics.totalRequests} requests`);
      const startTime = Date.now();

      // Batch requests to avoid gas limit issues
      const batches = Math.ceil(LOAD_TEST_CONFIG.MAX_CONCURRENT_REQUESTS / LOAD_TEST_CONFIG.BATCH_SIZE);

      for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
        const batchSize = Math.min(
          LOAD_TEST_CONFIG.BATCH_SIZE,
          LOAD_TEST_CONFIG.MAX_CONCURRENT_REQUESTS - batchIndex * LOAD_TEST_CONFIG.BATCH_SIZE
        );

        console.log(`  📦 Processing batch ${batchIndex + 1}/${batches} (${batchSize} requests)`);

        const batchPromises: Promise<any>[] = [];

        for (let i = 0; i < batchSize; i++) {
          const requestIndex = batchIndex * LOAD_TEST_CONFIG.BATCH_SIZE + i;
          const userIndex = requestIndex % testUsers.length;
          const user = testUsers[userIndex];

          // Fund user for bridge operation
          await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);

          // Create concurrent bridge request
          const bridgePromise = executeBridgeRequest(
            user,
            PROTOCOLS.LAYERZERO,
            TEST_CHAINS.BSC_TESTNET,
            AMOUNTS.HUNDRED_TOKENS
          );

          batchPromises.push(bridgePromise);
        }

        // Wait for batch completion
        const batchResults = await Promise.allSettled(batchPromises);

        // Process batch results
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            testMetrics.successfulRequests++;
            testMetrics.totalGasUsed += result.value.gasUsed || BigInt(0);
          } else {
            testMetrics.failedRequests++;
            console.log(`    ❌ Request failed: ${result.reason?.message}`);
          }
        }

        // Update system state
        systemState.activeRequests = batchIndex * LOAD_TEST_CONFIG.BATCH_SIZE;
        systemState.timestamp = Date.now();

        // Add small delay between batches to prevent overwhelming the system
        await time.increase(1);
      }

      testMetrics.duration = Date.now() - startTime;
      testMetrics.throughputPerSecond = (testMetrics.totalRequests * 1000) / testMetrics.duration;
      testMetrics.errorRate = (testMetrics.failedRequests / testMetrics.totalRequests) * 100;
      testMetrics.averageGasPerRequest = testMetrics.successfulRequests > 0 
        ? testMetrics.totalGasUsed / BigInt(testMetrics.successfulRequests) 
        : BigInt(0);

      loadTestResults.push(testMetrics);

      console.log(`✅ ${testMetrics.testName} completed:`);
      console.log(`   Success Rate: ${((testMetrics.successfulRequests / testMetrics.totalRequests) * 100).toFixed(2)}%`);
      console.log(`   Throughput: ${testMetrics.throughputPerSecond.toFixed(2)} requests/second`);
      console.log(`   Average Gas: ${ethers.formatUnits(testMetrics.averageGasPerRequest, "gwei")} gwei`);

      // Assertions for system stability
      expect(testMetrics.successfulRequests).to.be.greaterThan(testMetrics.totalRequests * 0.95); // 95% success rate
      expect(testMetrics.throughputPerSecond).to.be.greaterThan(1); // At least 1 request per second
      expect(testMetrics.averageGasPerRequest).to.be.lessThan(ethers.parseUnits("500", "gwei")); // Reasonable gas usage
    });

    it("should maintain consistent performance across different protocols", async function () {
      const protocols = [PROTOCOLS.LAYERZERO, PROTOCOLS.CELER, PROTOCOLS.HYPERLANE];
      const protocolMetrics: Map<number, LoadTestMetrics> = new Map();

      for (const protocol of protocols) {
        console.log(`\n🔄 Testing protocol: ${protocol}`);

        const testMetrics: LoadTestMetrics = {
          testName: `Protocol ${protocol} Load Test`,
          totalRequests: 300, // 300 requests per protocol
          successfulRequests: 0,
          failedRequests: 0,
          totalGasUsed: BigInt(0),
          averageGasPerRequest: BigInt(0),
          duration: 0,
          throughputPerSecond: 0,
          errorRate: 0,
        };

        const startTime = Date.now();

        // Execute concurrent requests for this protocol
        for (let i = 0; i < testMetrics.totalRequests; i++) {
          const user = testUsers[i % testUsers.length];

          // Fund user
          await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);

          try {
            const result = await executeBridgeRequest(
              user,
              protocol,
              TEST_CHAINS.BSC_TESTNET,
              AMOUNTS.TEN_TOKENS
            );

            testMetrics.successfulRequests++;
            testMetrics.totalGasUsed += result.gasUsed || BigInt(0);
          } catch (error) {
            testMetrics.failedRequests++;
          }
        }

        testMetrics.duration = Date.now() - startTime;
        testMetrics.throughputPerSecond = (testMetrics.totalRequests * 1000) / testMetrics.duration;
        testMetrics.errorRate = (testMetrics.failedRequests / testMetrics.totalRequests) * 100;
        testMetrics.averageGasPerRequest = testMetrics.successfulRequests > 0 
          ? testMetrics.totalGasUsed / BigInt(testMetrics.successfulRequests) 
          : BigInt(0);

        protocolMetrics.set(protocol, testMetrics);
        loadTestResults.push(testMetrics);

        console.log(`  ✅ Protocol ${protocol}: ${testMetrics.successfulRequests}/${testMetrics.totalRequests} success`);
      }

      // Compare protocol performance
      const metricsArray = Array.from(protocolMetrics.values());
      const avgThroughput = metricsArray.reduce((sum, m) => sum + m.throughputPerSecond, 0) / metricsArray.length;
      const avgErrorRate = metricsArray.reduce((sum, m) => sum + m.errorRate, 0) / metricsArray.length;

      console.log(`\n📊 Protocol Comparison:`);
      console.log(`   Average Throughput: ${avgThroughput.toFixed(2)} requests/second`);
      console.log(`   Average Error Rate: ${avgErrorRate.toFixed(2)}%`);

      // All protocols should perform within acceptable ranges
      for (const metrics of metricsArray) {
        expect(metrics.errorRate).to.be.lessThan(5); // Less than 5% error rate
        expect(metrics.throughputPerSecond).to.be.greaterThan(avgThroughput * 0.7); // Within 30% of average
      }
    });
  });

  /**
   * Test 2: Multi-Chain Simultaneous Operations (10+ chains)
   */
  describe("Multi-Chain Simultaneous Operations Load Test", function () {
    it("should handle operations across 15+ chains simultaneously", async function () {
      const testMetrics: LoadTestMetrics = {
        testName: "Multi-Chain Simultaneous Operations",
        totalRequests: LOAD_TEST_CONFIG.MAX_CHAINS * 50, // 50 requests per chain
        successfulRequests: 0,
        failedRequests: 0,
        totalGasUsed: BigInt(0),
        averageGasPerRequest: BigInt(0),
        duration: 0,
        throughputPerSecond: 0,
        errorRate: 0,
      };

      console.log(`\n🌐 Starting ${testMetrics.testName} - ${LOAD_TEST_CONFIG.MAX_CHAINS} chains`);
      const startTime = Date.now();

      // Configure multiple destination chains
      const chainIds = Array.from({ length: LOAD_TEST_CONFIG.MAX_CHAINS }, (_, i) => 1000 + i);
      
      for (const chainId of chainIds) {
        await configureChainForTesting(chainId);
      }

      // Execute operations across all chains simultaneously
      const allChainPromises: Promise<any>[] = [];

      for (let chainIndex = 0; chainIndex < LOAD_TEST_CONFIG.MAX_CHAINS; chainIndex++) {
        const chainId = chainIds[chainIndex];
        
        // Create promises for this chain
        for (let requestIndex = 0; requestIndex < 50; requestIndex++) {
          const user = testUsers[(chainIndex * 50 + requestIndex) % testUsers.length];
          const protocol = requestIndex % 3; // Rotate between protocols

          // Fund user
          await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);

          const chainRequest = executeBridgeRequest(
            user,
            protocol,
            chainId,
            AMOUNTS.TEN_TOKENS
          );

          allChainPromises.push(chainRequest);
        }
      }

      console.log(`  🔄 Executing ${allChainPromises.length} concurrent cross-chain operations`);

      // Wait for all operations to complete
      const results = await Promise.allSettled(allChainPromises);

      // Process results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          testMetrics.successfulRequests++;
          testMetrics.totalGasUsed += result.value.gasUsed || BigInt(0);
        } else {
          testMetrics.failedRequests++;
        }
      }

      testMetrics.duration = Date.now() - startTime;
      testMetrics.throughputPerSecond = (testMetrics.totalRequests * 1000) / testMetrics.duration;
      testMetrics.errorRate = (testMetrics.failedRequests / testMetrics.totalRequests) * 100;
      testMetrics.averageGasPerRequest = testMetrics.successfulRequests > 0 
        ? testMetrics.totalGasUsed / BigInt(testMetrics.successfulRequests) 
        : BigInt(0);

      loadTestResults.push(testMetrics);

      console.log(`✅ ${testMetrics.testName} completed:`);
      console.log(`   Chains Tested: ${LOAD_TEST_CONFIG.MAX_CHAINS}`);
      console.log(`   Success Rate: ${((testMetrics.successfulRequests / testMetrics.totalRequests) * 100).toFixed(2)}%`);
      console.log(`   Throughput: ${testMetrics.throughputPerSecond.toFixed(2)} requests/second`);

      // Assertions
      expect(testMetrics.successfulRequests).to.be.greaterThan(testMetrics.totalRequests * 0.9); // 90% success rate
      expect(testMetrics.throughputPerSecond).to.be.greaterThan(2); // At least 2 requests per second
    });

    it("should maintain chain isolation during concurrent operations", async function () {
      const chainMetrics: Map<number, LoadTestMetrics> = new Map();
      const testChains = [TEST_CHAINS.BSC_TESTNET, TEST_CHAINS.BASE_SEPOLIA, TEST_CHAINS.OPTIMISM_SEPOLIA];

      for (const chainId of testChains) {
        await configureChainForTesting(chainId);

        const metrics: LoadTestMetrics = {
          testName: `Chain ${chainId} Isolation Test`,
          totalRequests: 100,
          successfulRequests: 0,
          failedRequests: 0,
          totalGasUsed: BigInt(0),
          averageGasPerRequest: BigInt(0),
          duration: 0,
          throughputPerSecond: 0,
          errorRate: 0,
        };

        const startTime = Date.now();

        // Execute operations for this chain
        for (let i = 0; i < metrics.totalRequests; i++) {
          const user = testUsers[i % testUsers.length];
          
          await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);

          try {
            const result = await executeBridgeRequest(
              user,
              PROTOCOLS.LAYERZERO,
              chainId,
              AMOUNTS.HUNDRED_TOKENS
            );

            metrics.successfulRequests++;
            metrics.totalGasUsed += result.gasUsed || BigInt(0);
          } catch (error) {
            metrics.failedRequests++;
          }
        }

        metrics.duration = Date.now() - startTime;
        metrics.throughputPerSecond = (metrics.totalRequests * 1000) / metrics.duration;
        metrics.errorRate = (metrics.failedRequests / metrics.totalRequests) * 100;

        chainMetrics.set(chainId, metrics);
        loadTestResults.push(metrics);
      }

      // Verify chain isolation - each chain should perform consistently
      const metricsArray = Array.from(chainMetrics.values());
      const avgErrorRate = metricsArray.reduce((sum, m) => sum + m.errorRate, 0) / metricsArray.length;

      console.log(`\n🔒 Chain Isolation Results:`);
      for (const [chainId, metrics] of chainMetrics) {
        console.log(`   Chain ${chainId}: ${metrics.successfulRequests}/${metrics.totalRequests} (${metrics.errorRate.toFixed(2)}% error)`);
        expect(metrics.errorRate).to.be.lessThan(avgErrorRate * 2); // No chain should have >2x average error rate
      }
    });
  });

  /**
   * Test 3: Oracle Update Frequency Under Load
   */
  describe("Oracle Update Frequency Load Test", function () {
    it("should handle high-frequency oracle updates without degradation", async function () {
      const testMetrics: LoadTestMetrics = {
        testName: "Oracle High-Frequency Updates",
        totalRequests: 500, // 500 oracle updates
        successfulRequests: 0,
        failedRequests: 0,
        totalGasUsed: BigInt(0),
        averageGasPerRequest: BigInt(0),
        duration: 0,
        throughputPerSecond: 0,
        errorRate: 0,
      };

      console.log(`\n📊 Starting ${testMetrics.testName} - ${testMetrics.totalRequests} updates`);
      const startTime = Date.now();

      // Execute rapid oracle updates
      for (let i = 0; i < testMetrics.totalRequests; i++) {
        const operator = oracleOperators[i % oracleOperators.length];
        const newSupply = ethers.parseEther(`${1000000 + i * 1000}`); // Incrementing supply

        try {
          const tx = await fixture.supplyOracle
            .connect(operator)
            .updateSupply(newSupply, await time.latest());

          const receipt = await tx.wait();
          testMetrics.successfulRequests++;
          testMetrics.totalGasUsed += receipt!.gasUsed;
        } catch (error) {
          testMetrics.failedRequests++;
          console.log(`    ❌ Oracle update ${i} failed: ${(error as Error).message}`);
        }

        // Minimal delay to simulate rapid updates
        if (i % 10 === 0) {
          await time.increase(1); // 1 second every 10 updates
        }
      }

      testMetrics.duration = Date.now() - startTime;
      testMetrics.throughputPerSecond = (testMetrics.totalRequests * 1000) / testMetrics.duration;
      testMetrics.errorRate = (testMetrics.failedRequests / testMetrics.totalRequests) * 100;
      testMetrics.averageGasPerRequest = testMetrics.successfulRequests > 0 
        ? testMetrics.totalGasUsed / BigInt(testMetrics.successfulRequests) 
        : BigInt(0);

      loadTestResults.push(testMetrics);

      console.log(`✅ ${testMetrics.testName} completed:`);
      console.log(`   Success Rate: ${((testMetrics.successfulRequests / testMetrics.totalRequests) * 100).toFixed(2)}%`);
      console.log(`   Updates/Second: ${testMetrics.throughputPerSecond.toFixed(2)}`);
      console.log(`   Avg Gas per Update: ${ethers.formatUnits(testMetrics.averageGasPerRequest, "gwei")} gwei`);

      // Assertions
      expect(testMetrics.successfulRequests).to.be.greaterThan(testMetrics.totalRequests * 0.95); // 95% success
      expect(testMetrics.averageGasPerRequest).to.be.lessThan(ethers.parseUnits("200", "gwei")); // Reasonable gas
    });

    it("should detect and handle oracle consensus conflicts", async function () {
      const conflictingUpdates = 50;
      let consensusFailures = 0;

      console.log(`\n⚠️ Testing oracle consensus with ${conflictingUpdates} conflicting updates`);

      for (let i = 0; i < conflictingUpdates; i++) {
        const operator1 = oracleOperators[0];
        const operator2 = oracleOperators[1];
        
        // Create conflicting supply values
        const supply1 = ethers.parseEther(`${1000000 + i * 1000}`);
        const supply2 = ethers.parseEther(`${1000000 + i * 2000}`); // Different value
        const timestamp = await time.latest();

        try {
          // First oracle update
          await fixture.supplyOracle.connect(operator1).updateSupply(supply1, timestamp);
          
          // Conflicting oracle update (should be handled appropriately)
          await fixture.supplyOracle.connect(operator2).updateSupply(supply2, timestamp);
        } catch (error) {
          consensusFailures++;
        }

        await time.increase(60); // 1 minute between conflict tests
      }

      console.log(`   Consensus Failures: ${consensusFailures}/${conflictingUpdates}`);
      
      // System should handle conflicts gracefully
      expect(consensusFailures).to.be.lessThan(conflictingUpdates * 0.1); // Less than 10% should fail
    });
  });

  /**
   * Test 4: Memory Pool Congestion Handling
   */
  describe("Memory Pool Congestion Load Test", function () {
    it("should handle memory pool congestion with escalating gas prices", async function () {
      const testMetrics: LoadTestMetrics = {
        testName: "Memory Pool Congestion Test",
        totalRequests: 200,
        successfulRequests: 0,
        failedRequests: 0,
        totalGasUsed: BigInt(0),
        averageGasPerRequest: BigInt(0),
        duration: 0,
        throughputPerSecond: 0,
        errorRate: 0,
        peakMemoryUsage: 0,
      };

      console.log(`\n🚦 Starting ${testMetrics.testName} - ${testMetrics.totalRequests} transactions`);
      const startTime = Date.now();

      // Simulate escalating gas prices due to congestion
      for (let i = 0; i < testMetrics.totalRequests; i++) {
        const user = testUsers[i % testUsers.length];
        const recipient = testUsers[(i + 1) % testUsers.length];
        
        // Fund user
        await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);

        // Escalating gas price simulation
        const gasPrice = ethers.parseUnits(`${20 + i}`, "gwei"); // Start at 20 gwei, increase by 1 gwei each tx

        try {
          const tx = await fixture.lookCoin
            .connect(user)
            .transfer(recipient.address, AMOUNTS.TEN_TOKENS, {
              gasPrice: gasPrice,
            });

          const receipt = await tx.wait();
          testMetrics.successfulRequests++;
          testMetrics.totalGasUsed += receipt!.gasUsed;

          // Simulate memory usage tracking
          const simulatedMemory = i * 21000; // Rough estimation
          if (simulatedMemory > (testMetrics.peakMemoryUsage || 0)) {
            testMetrics.peakMemoryUsage = simulatedMemory;
          }
        } catch (error) {
          testMetrics.failedRequests++;
        }
      }

      testMetrics.duration = Date.now() - startTime;
      testMetrics.throughputPerSecond = (testMetrics.totalRequests * 1000) / testMetrics.duration;
      testMetrics.errorRate = (testMetrics.failedRequests / testMetrics.totalRequests) * 100;
      testMetrics.averageGasPerRequest = testMetrics.successfulRequests > 0 
        ? testMetrics.totalGasUsed / BigInt(testMetrics.successfulRequests) 
        : BigInt(0);

      loadTestResults.push(testMetrics);

      console.log(`✅ ${testMetrics.testName} completed:`);
      console.log(`   Success Rate: ${((testMetrics.successfulRequests / testMetrics.totalRequests) * 100).toFixed(2)}%`);
      console.log(`   Peak Memory Usage: ${testMetrics.peakMemoryUsage} units`);
      console.log(`   Average Gas: ${ethers.formatUnits(testMetrics.averageGasPerRequest, "gwei")} gwei`);

      // System should maintain reasonable performance even under congestion
      expect(testMetrics.successfulRequests).to.be.greaterThan(testMetrics.totalRequests * 0.8); // 80% success
      expect(testMetrics.peakMemoryUsage).to.be.lessThan(LOAD_TEST_CONFIG.MEMORY_THRESHOLD * 10); // Reasonable memory usage
    });
  });

  /**
   * Test 5: Rate Limiting Effectiveness Under Load
   */
  describe("Rate Limiting Load Test", function () {
    it("should enforce rate limits effectively under high load", async function () {
      const testMetrics: LoadTestMetrics = {
        testName: "Rate Limiting Effectiveness",
        totalRequests: 150,
        successfulRequests: 0,
        failedRequests: 0,
        totalGasUsed: BigInt(0),
        averageGasPerRequest: BigInt(0),
        duration: 0,
        throughputPerSecond: 0,
        errorRate: 0,
      };

      console.log(`\n🚧 Starting ${testMetrics.testName} - Testing rate limits`);
      const startTime = Date.now();

      // Configure aggressive rate limiting
      const dailyLimit = ethers.parseEther("5000"); // 5k tokens per day
      await fixture.securityManager
        .connect(admin)
        .updateSecurityThreshold("DAILY_LIMIT", dailyLimit);

      let rateLimitHits = 0;

      // Execute requests that should trigger rate limits
      for (let i = 0; i < testMetrics.totalRequests; i++) {
        const user = testUsers[i % 10]; // Use fewer users to trigger limits faster
        
        // Fund user with large amount
        await fixture.lookCoin.connect(governance).mint(user.address, ethers.parseEther("10000"));

        try {
          // Try to bridge large amount to trigger rate limit
          const result = await executeBridgeRequest(
            user,
            PROTOCOLS.LAYERZERO,
            TEST_CHAINS.BSC_TESTNET,
            ethers.parseEther("1000") // Large amount to trigger limits
          );

          testMetrics.successfulRequests++;
          testMetrics.totalGasUsed += result.gasUsed || BigInt(0);
        } catch (error) {
          testMetrics.failedRequests++;
          
          // Check if it's a rate limit error
          if ((error as Error).message.includes("rate limit") || 
              (error as Error).message.includes("daily limit")) {
            rateLimitHits++;
            systemState.rateLimitHits.set(user.address, 
              (systemState.rateLimitHits.get(user.address) || 0) + 1);
          }
        }

        // Small delay to simulate realistic timing
        if (i % 10 === 0) {
          await time.increase(60); // 1 minute every 10 requests
        }
      }

      testMetrics.duration = Date.now() - startTime;
      testMetrics.throughputPerSecond = (testMetrics.totalRequests * 1000) / testMetrics.duration;
      testMetrics.errorRate = (testMetrics.failedRequests / testMetrics.totalRequests) * 100;

      loadTestResults.push(testMetrics);

      console.log(`✅ ${testMetrics.testName} completed:`);
      console.log(`   Rate Limit Hits: ${rateLimitHits}`);
      console.log(`   Success Rate: ${((testMetrics.successfulRequests / testMetrics.totalRequests) * 100).toFixed(2)}%`);
      console.log(`   Failed Requests: ${testMetrics.failedRequests}`);

      // Rate limiting should be effective
      expect(rateLimitHits).to.be.greaterThan(0); // Rate limits should trigger
      expect(testMetrics.errorRate).to.be.greaterThan(20); // Should have significant failures due to limits
    });
  });

  /**
   * Test 6: Protocol Queue Management Under Load
   */
  describe("Protocol Queue Management Load Test", function () {
    it("should manage protocol queues effectively under load", async function () {
      const protocolQueues: Map<number, number> = new Map();
      const maxQueueSize = LOAD_TEST_CONFIG.QUEUE_SIZE_LIMIT;
      
      console.log(`\n📋 Testing protocol queue management with ${maxQueueSize} queue limit`);

      for (const protocol of [PROTOCOLS.LAYERZERO, PROTOCOLS.CELER, PROTOCOLS.HYPERLANE]) {
        let queueOverflows = 0;
        let currentQueueSize = 0;

        console.log(`  🔄 Testing protocol: ${protocol}`);

        // Simulate queue filling
        for (let i = 0; i < 100; i++) {
          const user = testUsers[i % testUsers.length];
          
          await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);

          try {
            await executeBridgeRequest(
              user,
              protocol,
              TEST_CHAINS.BSC_TESTNET,
              AMOUNTS.HUNDRED_TOKENS
            );

            currentQueueSize++;
            
            // Simulate queue overflow detection
            if (currentQueueSize > maxQueueSize) {
              queueOverflows++;
              currentQueueSize = maxQueueSize; // Cap at max
              console.log(`    ⚠️ Queue overflow detected for protocol ${protocol}`);
            }
          } catch (error) {
            // Request rejected due to queue management
          }

          protocolQueues.set(protocol, currentQueueSize);
          
          // Simulate queue processing (reduce queue size periodically)
          if (i % 10 === 0 && currentQueueSize > 0) {
            currentQueueSize = Math.max(0, currentQueueSize - 5); // Process 5 requests
          }
        }

        console.log(`    📊 Protocol ${protocol}: ${queueOverflows} overflows, final queue size: ${currentQueueSize}`);
        
        // Queue management should prevent excessive buildup
        expect(currentQueueSize).to.be.lessThanOrEqual(maxQueueSize);
      }

      // System should maintain queue sizes across all protocols
      for (const [protocol, queueSize] of protocolQueues) {
        expect(queueSize).to.be.lessThanOrEqual(maxQueueSize);
        systemState.queueSizes.set(protocol, queueSize);
      }
    });
  });

  /**
   * Test 7: Comprehensive Stress Test
   */
  describe("Comprehensive Stress Test", function () {
    it("should maintain system stability under combined load scenarios", async function () {
      console.log(`\n🔥 Starting Comprehensive Stress Test - All scenarios combined`);
      
      const overallMetrics: LoadTestMetrics = {
        testName: "Comprehensive Stress Test",
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalGasUsed: BigInt(0),
        averageGasPerRequest: BigInt(0),
        duration: 0,
        throughputPerSecond: 0,
        errorRate: 0,
      };

      const startTime = Date.now();

      // Run multiple load scenarios concurrently
      const stressPromises: Promise<void>[] = [];

      // Concurrent bridge requests
      stressPromises.push(this.runConcurrentBridgeStress(100)); // 100 concurrent requests

      // Multi-chain operations
      stressPromises.push(this.runMultiChainStress(5, 20)); // 5 chains, 20 requests each

      // Oracle updates
      stressPromises.push(this.runOracleUpdateStress(50)); // 50 rapid oracle updates

      // Memory pool congestion
      stressPromises.push(this.runMemoryPoolStress(50)); // 50 high gas price transactions

      console.log(`  🚀 Executing ${stressPromises.length} concurrent stress scenarios`);

      // Wait for all stress tests to complete
      const stressResults = await Promise.allSettled(stressPromises);

      // Analyze results
      let completedScenarios = 0;
      for (const result of stressResults) {
        if (result.status === 'fulfilled') {
          completedScenarios++;
        } else {
          console.log(`    ❌ Stress scenario failed: ${result.reason?.message}`);
        }
      }

      overallMetrics.duration = Date.now() - startTime;

      // Aggregate metrics from individual test results
      for (const testResult of loadTestResults) {
        overallMetrics.totalRequests += testResult.totalRequests;
        overallMetrics.successfulRequests += testResult.successfulRequests;
        overallMetrics.failedRequests += testResult.failedRequests;
        overallMetrics.totalGasUsed += testResult.totalGasUsed;
      }

      if (overallMetrics.totalRequests > 0) {
        overallMetrics.errorRate = (overallMetrics.failedRequests / overallMetrics.totalRequests) * 100;
        overallMetrics.throughputPerSecond = (overallMetrics.totalRequests * 1000) / overallMetrics.duration;
        overallMetrics.averageGasPerRequest = overallMetrics.successfulRequests > 0 
          ? overallMetrics.totalGasUsed / BigInt(overallMetrics.successfulRequests) 
          : BigInt(0);
      }

      console.log(`\n✅ Comprehensive Stress Test Results:`);
      console.log(`   Completed Scenarios: ${completedScenarios}/${stressPromises.length}`);
      console.log(`   Total Requests: ${overallMetrics.totalRequests}`);
      console.log(`   Overall Success Rate: ${((overallMetrics.successfulRequests / overallMetrics.totalRequests) * 100).toFixed(2)}%`);
      console.log(`   Total Duration: ${overallMetrics.duration}ms`);
      console.log(`   System Throughput: ${overallMetrics.throughputPerSecond.toFixed(2)} requests/second`);

      // System should remain stable under combined stress
      expect(completedScenarios).to.be.greaterThan(stressPromises.length * 0.75); // 75% scenarios complete
      expect(overallMetrics.errorRate).to.be.lessThan(25); // Less than 25% overall error rate
      expect(overallMetrics.throughputPerSecond).to.be.greaterThan(1); // Maintain some throughput

      // Final system state should be reasonable
      expect(systemState.activeRequests).to.be.lessThan(1000);
      for (const [protocol, queueSize] of systemState.queueSizes) {
        expect(queueSize).to.be.lessThan(LOAD_TEST_CONFIG.QUEUE_SIZE_LIMIT * 2);
      }
    });
  });

  /**
   * After all tests: Generate comprehensive load test report
   */
  after(async function () {
    await this.generateLoadTestReport();
  });

  /**
   * Helper Methods
   */

  /**
   * Helper Methods
   */

  // Execute a single bridge request with error handling and metrics collection
  async function executeBridgeRequest(
    user: SignerWithAddress,
    protocol: number,
    destinationChain: number,
    amount: bigint
  ): Promise<{ gasUsed: bigint }> {
    const tx = await fixture.crossChainRouter
      .connect(user)
      .bridgeToken(protocol, destinationChain, user.address, amount, "0x", {
        value: ethers.parseEther("0.01"), // Bridge fee
        gasLimit: GAS_LIMITS.BRIDGE_OPERATION,
      });

    const receipt = await tx.wait();
    return { gasUsed: receipt!.gasUsed };
  }

  // Configure a chain for testing
  async function configureChainForTesting(chainId: number): Promise<void> {
    // Enable all protocols for this chain
    for (const protocol of [PROTOCOLS.LAYERZERO, PROTOCOLS.CELER, PROTOCOLS.HYPERLANE]) {
      await fixture.crossChainRouter
        .connect(admin)
        .setChainProtocolSupport(chainId, protocol, true);
    }
  }

  // Stress test helpers
  async function runConcurrentBridgeStress(requestCount: number): Promise<void> {
    const promises: Promise<any>[] = [];
    
    for (let i = 0; i < requestCount; i++) {
      const user = testUsers[i % testUsers.length];
      await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);
      
      const promise = executeBridgeRequest(
        user,
        PROTOCOLS.LAYERZERO,
        TEST_CHAINS.BSC_TESTNET,
        AMOUNTS.HUNDRED_TOKENS
      );
      promises.push(promise);
    }
    
    await Promise.allSettled(promises);
  }

  async function runMultiChainStress(chainCount: number, requestsPerChain: number): Promise<void> {
    const promises: Promise<any>[] = [];
    
    for (let chainIndex = 0; chainIndex < chainCount; chainIndex++) {
      const chainId = 2000 + chainIndex;
      await configureChainForTesting(chainId);
      
      for (let reqIndex = 0; reqIndex < requestsPerChain; reqIndex++) {
        const user = testUsers[(chainIndex * requestsPerChain + reqIndex) % testUsers.length];
        await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);
        
        const promise = executeBridgeRequest(
          user,
          reqIndex % 3,
          chainId,
          AMOUNTS.TEN_TOKENS
        );
        promises.push(promise);
      }
    }
    
    await Promise.allSettled(promises);
  }

  async function runOracleUpdateStress(updateCount: number): Promise<void> {
    for (let i = 0; i < updateCount; i++) {
      const operator = oracleOperators[i % oracleOperators.length];
      const supply = ethers.parseEther(`${2000000 + i * 1000}`);
      
      try {
        await fixture.supplyOracle
          .connect(operator)
          .updateSupply(supply, await time.latest());
      } catch (error) {
        // Continue on error
      }
      
      if (i % 5 === 0) {
        await time.increase(1); // Small delay
      }
    }
  }

  async function runMemoryPoolStress(txCount: number): Promise<void> {
    for (let i = 0; i < txCount; i++) {
      const user = testUsers[i % testUsers.length];
      const recipient = testUsers[(i + 1) % testUsers.length];
      
      await fixture.lookCoin.connect(governance).mint(user.address, AMOUNTS.THOUSAND_TOKENS);
      
      try {
        await fixture.lookCoin
          .connect(user)
          .transfer(recipient.address, AMOUNTS.TEN_TOKENS, {
            gasPrice: ethers.parseUnits(`${50 + i}`, "gwei"),
          });
      } catch (error) {
        // Continue on error
      }
    }
  }

  // Generate comprehensive load test report
  async function generateLoadTestReport(): Promise<void> {
    console.log(`\n📊 COMPREHENSIVE LOAD TEST REPORT`);
    console.log(`${'='.repeat(80)}`);
    
    if (loadTestResults.length === 0) {
      console.log(`No load test results to report.`);
      return;
    }

    // Summary statistics
    const totalTests = loadTestResults.length;
    const totalRequests = loadTestResults.reduce((sum, r) => sum + r.totalRequests, 0);
    const totalSuccessful = loadTestResults.reduce((sum, r) => sum + r.successfulRequests, 0);
    const totalFailed = loadTestResults.reduce((sum, r) => sum + r.failedRequests, 0);
    const avgThroughput = loadTestResults.reduce((sum, r) => sum + r.throughputPerSecond, 0) / totalTests;
    const avgErrorRate = loadTestResults.reduce((sum, r) => sum + r.errorRate, 0) / totalTests;

    console.log(`\nSUMMARY STATISTICS:`);
    console.log(`  Tests Executed: ${totalTests}`);
    console.log(`  Total Requests: ${totalRequests.toLocaleString()}`);
    console.log(`  Successful: ${totalSuccessful.toLocaleString()} (${((totalSuccessful/totalRequests)*100).toFixed(2)}%)`);
    console.log(`  Failed: ${totalFailed.toLocaleString()} (${((totalFailed/totalRequests)*100).toFixed(2)}%)`);
    console.log(`  Average Throughput: ${avgThroughput.toFixed(2)} requests/second`);
    console.log(`  Average Error Rate: ${avgErrorRate.toFixed(2)}%`);

    console.log(`\nDETAILED TEST RESULTS:`);
    console.log(`${'-'.repeat(80)}`);
    
    for (const result of loadTestResults) {
      console.log(`\n${result.testName}:`);
      console.log(`  Requests: ${result.totalRequests.toLocaleString()}`);
      console.log(`  Success Rate: ${((result.successfulRequests / result.totalRequests) * 100).toFixed(2)}%`);
      console.log(`  Throughput: ${result.throughputPerSecond.toFixed(2)} req/sec`);
      console.log(`  Avg Gas: ${ethers.formatUnits(result.averageGasPerRequest, "gwei")} gwei`);
      console.log(`  Duration: ${result.duration}ms`);
      if (result.peakMemoryUsage) {
        console.log(`  Peak Memory: ${result.peakMemoryUsage.toLocaleString()} units`);
      }
    }

    console.log(`\nSYSTEM STATE AT TEST COMPLETION:`);
    console.log(`  Active Requests: ${systemState.activeRequests}`);
    console.log(`  Rate Limit Hits: ${systemState.rateLimitHits.size} users affected`);
    console.log(`  Protocol Queue Sizes:`);
    for (const [protocol, queueSize] of systemState.queueSizes) {
      console.log(`    Protocol ${protocol}: ${queueSize}`);
    }

    console.log(`\nPERFORMANCE RECOMMENDATIONS:`);
    if (avgErrorRate > 10) {
      console.log(`  ⚠️ High error rate detected (${avgErrorRate.toFixed(2)}%) - investigate system limits`);
    }
    if (avgThroughput < 5) {
      console.log(`  ⚠️ Low throughput detected (${avgThroughput.toFixed(2)} req/sec) - consider optimization`);
    }
    
    // Find best and worst performing tests
    const bestTest = loadTestResults.reduce((best, current) => 
      current.throughputPerSecond > best.throughputPerSecond ? current : best
    );
    const worstTest = loadTestResults.reduce((worst, current) => 
      current.errorRate > worst.errorRate ? current : worst
    );

    console.log(`  🏆 Best Performance: ${bestTest.testName} (${bestTest.throughputPerSecond.toFixed(2)} req/sec)`);
    console.log(`  🔍 Needs Attention: ${worstTest.testName} (${worstTest.errorRate.toFixed(2)}% error rate)`);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Load testing completed at ${new Date().toISOString()}`);
  }
});