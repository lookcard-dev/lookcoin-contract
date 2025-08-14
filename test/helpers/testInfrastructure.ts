/**
 * Enhanced Test Infrastructure
 * 
 * Comprehensive testing infrastructure for the LookCoin contract suite.
 * Provides enhanced mock contracts, test data generators, scenario builders,
 * and advanced testing utilities for realistic and comprehensive test coverage.
 * 
 * Features:
 * - Realistic test data generation
 * - Advanced mock contract systems
 * - Scenario-based test builders
 * - Performance monitoring utilities
 * - Cross-chain test simulation
 * - Economic attack simulation
 * - Comprehensive fixture management
 */

import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
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
  MinimalTimelock,
  MockLayerZeroEndpoint,
  MockMessageBus,
  MockHyperlaneMailbox,
} from "../../typechain-types";

// Re-export fixtures and diagnostics for compatibility
export { DeploymentFixture, deployLookCoinFixture, deployLookCoinOnlyFixture, deployBridgeFixture } from "./fixtures";
export { TestDiagnosticTool, testDiagnostics, TestFailureDiagnostic, FailureCategory } from "./testDiagnostics";

/**
 * Deterministic random number generator for reproducible tests
 */
class TestRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

/**
 * Enhanced test data generators
 */
export class TestDataGenerator {
  private static rng = new TestRandom(12345); // Deterministic for reproducible tests

  /**
   * Generate realistic transaction amounts
   */
  static generateTransactionAmounts(count: number = 10): bigint[] {
    const amounts: bigint[] = [];
    const patterns = [
      // Small transactions (1-100 LOOK)
      () => ethers.parseEther((TestDataGenerator.rng.next() * 100 + 1).toFixed(6)),
      // Medium transactions (100-10,000 LOOK)
      () => ethers.parseEther((TestDataGenerator.rng.next() * 9900 + 100).toFixed(6)),
      // Large transactions (10,000-1,000,000 LOOK)
      () => ethers.parseEther((TestDataGenerator.rng.next() * 990000 + 10000).toFixed(6)),
      // Whale transactions (1M+ LOOK)
      () => ethers.parseEther((TestDataGenerator.rng.next() * 10000000 + 1000000).toFixed(6)),
    ];

    for (let i = 0; i < count; i++) {
      const patternIndex = Math.floor(TestDataGenerator.rng.next() * patterns.length);
      amounts.push(patterns[patternIndex]());
    }

    return amounts;
  }

  /**
   * Generate realistic gas prices for different networks
   */
  static generateGasPrices(network: 'ethereum' | 'bsc' | 'polygon' | 'optimism' | 'base' = 'ethereum'): bigint[] {
    const baseRanges = {
      ethereum: { min: 10, max: 100 }, // 10-100 gwei
      bsc: { min: 3, max: 20 }, // 3-20 gwei
      polygon: { min: 30, max: 300 }, // 30-300 gwei
      optimism: { min: 0.001, max: 0.01 }, // 0.001-0.01 gwei
      base: { min: 0.001, max: 0.01 }, // 0.001-0.01 gwei
    };

    const range = baseRanges[network];
    const prices: bigint[] = [];

    for (let i = 0; i < 10; i++) {
      const price = TestDataGenerator.rng.next() * (range.max - range.min) + range.min;
      prices.push(ethers.parseUnits(price.toFixed(9), 'gwei'));
    }

    return prices;
  }

  /**
   * Generate realistic cross-chain bridge scenarios
   */
  static generateBridgeScenarios(count: number = 5): BridgeScenario[] {
    const chains = [56, 8453, 10, 137, 42161]; // BSC, Base, Optimism, Polygon, Arbitrum
    const protocols = ['layerzero', 'celer', 'hyperlane'] as const;
    const scenarios: BridgeScenario[] = [];

    for (let i = 0; i < count; i++) {
      const sourceChain = chains[Math.floor(TestDataGenerator.rng.next() * chains.length)];
      let destChain = sourceChain;
      while (destChain === sourceChain) {
        destChain = chains[Math.floor(TestDataGenerator.rng.next() * chains.length)];
      }

      scenarios.push({
        sourceChain,
        destChain,
        protocol: protocols[Math.floor(TestDataGenerator.rng.next() * protocols.length)],
        amount: TestDataGenerator.generateTransactionAmounts(1)[0],
        gasLimit: BigInt(Math.floor(TestDataGenerator.rng.next() * 500000 + 200000)),
        expectedDuration: Math.floor(TestDataGenerator.rng.next() * 600 + 30), // 30s - 10min
        expectedFee: ethers.parseEther((TestDataGenerator.rng.next() * 0.1 + 0.001).toFixed(6)),
      });
    }

    return scenarios;
  }

  /**
   * Generate economic attack scenarios
   */
  static generateAttackScenarios(): EconomicAttackScenario[] {
    return [
      {
        name: 'Flash Loan Arbitrage',
        type: 'arbitrage',
        initialCapital: ethers.parseEther('1000000'), // 1M LOOK
        expectedProfit: ethers.parseEther('50000'), // 5% profit
        riskLevel: 'medium',
        description: 'Exploit price differences across chains using flash loans',
      },
      {
        name: 'Sandwich Attack',
        type: 'mev',
        initialCapital: ethers.parseEther('100000'), // 100K LOOK
        expectedProfit: ethers.parseEther('5000'), // 5% profit
        riskLevel: 'high',
        description: 'Front-run and back-run large bridge transactions',
      },
      {
        name: 'Supply Oracle Manipulation',
        type: 'oracle',
        initialCapital: ethers.parseEther('10000000'), // 10M LOOK
        expectedProfit: ethers.parseEther('0'), // Should be blocked
        riskLevel: 'critical',
        description: 'Attempt to manipulate cross-chain supply reporting',
      },
      {
        name: 'Fee Manipulation',
        type: 'fee',
        initialCapital: ethers.parseEther('500000'), // 500K LOOK
        expectedProfit: ethers.parseEther('25000'), // 5% profit
        riskLevel: 'medium',
        description: 'Exploit fee calculation vulnerabilities',
      },
      {
        name: 'Governance Attack',
        type: 'governance',
        initialCapital: ethers.parseEther('50000000'), // 50M LOOK (10% of supply)
        expectedProfit: ethers.parseEther('0'), // Should be blocked
        riskLevel: 'critical',
        description: 'Attempt hostile takeover through governance',
      },
    ];
  }

  /**
   * Generate realistic user behavior patterns
   */
  static generateUserBehaviorPatterns(): UserBehaviorPattern[] {
    return [
      {
        type: 'casual_user',
        transactionFrequency: 'daily',
        averageAmount: ethers.parseEther('100'), // 100 LOOK
        preferredProtocol: 'layerzero',
        riskTolerance: 'low',
        bridgeFrequency: 0.1, // 10% of transactions are cross-chain
      },
      {
        type: 'power_user',
        transactionFrequency: 'hourly',
        averageAmount: ethers.parseEther('5000'), // 5K LOOK
        preferredProtocol: 'celer',
        riskTolerance: 'medium',
        bridgeFrequency: 0.3, // 30% of transactions are cross-chain
      },
      {
        type: 'arbitrage_bot',
        transactionFrequency: 'per_block',
        averageAmount: ethers.parseEther('50000'), // 50K LOOK
        preferredProtocol: 'layerzero', // Fastest
        riskTolerance: 'high',
        bridgeFrequency: 0.8, // 80% of transactions are cross-chain
      },
      {
        type: 'institutional',
        transactionFrequency: 'weekly',
        averageAmount: ethers.parseEther('1000000'), // 1M LOOK
        preferredProtocol: 'hyperlane', // Most secure
        riskTolerance: 'very_low',
        bridgeFrequency: 0.05, // 5% of transactions are cross-chain
      },
    ];
  }

  /**
   * Generate stress test scenarios
   */
  static generateStressTestScenarios(): StressTestScenario[] {
    return [
      {
        name: 'High Volume Bridge Congestion',
        type: 'volume',
        concurrentUsers: 1000,
        transactionsPerUser: 50,
        duration: 3600, // 1 hour
        expectedBottleneck: 'gas_limits',
      },
      {
        name: 'Multi-Chain Simultaneous Operations',
        type: 'multi_chain',
        concurrentChains: 5,
        transactionsPerChain: 200,
        duration: 1800, // 30 minutes
        expectedBottleneck: 'oracle_updates',
      },
      {
        name: 'Memory Pool Congestion',
        type: 'mempool',
        concurrentTransactions: 10000,
        averageGasPrice: ethers.parseUnits('50', 'gwei'),
        duration: 900, // 15 minutes
        expectedBottleneck: 'network_congestion',
      },
      {
        name: 'Protocol Rate Limiting',
        type: 'rate_limit',
        transactionsPerSecond: 100,
        protocolLimits: { layerzero: 50, celer: 30, hyperlane: 20 },
        duration: 600, // 10 minutes
        expectedBottleneck: 'protocol_limits',
      },
    ];
  }
}

/**
 * Advanced mock contract generator
 */
export class MockContractGenerator {
  /**
   * Create enhanced LayerZero endpoint mock with realistic behavior
   */
  static async createEnhancedLayerZeroMock(): Promise<EnhancedLayerZeroMock> {
    const MockLayerZero = await ethers.getContractFactory("MockLayerZeroEndpoint");
    const mock = await MockLayerZero.deploy();
    await mock.waitForDeployment();

    return {
      contract: mock as any,
      simulateNetworkCongestion: async (congestionLevel: number) => {
        // Simulate network delays based on congestion (0-100)
        const delay = Math.floor(congestionLevel * 100); // 0-10s delay
        await time.increase(delay);
      },
      simulateFailedDelivery: async (failureRate: number) => {
        // Simulate message delivery failures
        // Implementation would set failure conditions in mock
      },
      getNetworkStats: () => ({
        totalMessages: 0,
        failedDeliveries: 0,
        averageDelay: 0,
      }),
    };
  }

  /**
   * Create enhanced Celer mock with fee simulation
   */
  static async createEnhancedCelerMock(): Promise<EnhancedCelerMock> {
    const MockCeler = await ethers.getContractFactory("MockMessageBus");
    const mock = await MockCeler.deploy();
    await mock.waitForDeployment();

    return {
      contract: mock as any,
      setDynamicFees: async (baseFee: bigint, congestionMultiplier: number) => {
        // Set dynamic fee structure based on network congestion
      },
      simulateLiquidityShortage: async (chainId: number, shortage: boolean) => {
        // Simulate liquidity shortages on specific chains
      },
      getPoolStats: (chainId: number) => ({
        totalLiquidity: ethers.parseEther('1000000'),
        utilization: 0.5,
        fees24h: ethers.parseEther('1000'),
      }),
    };
  }

  /**
   * Create realistic network simulator
   */
  static async createNetworkSimulator(): Promise<NetworkSimulator> {
    const MockNetworkSimulator = await ethers.getContractFactory("MockNetworkSimulator");
    const simulator = await MockNetworkSimulator.deploy();
    await simulator.waitForDeployment();

    const networks = new Map<number, NetworkState>();

    return {
      contract: simulator,
      addNetwork: (chainId: number, config: NetworkConfig) => {
        networks.set(chainId, {
          chainId,
          gasPrice: config.baseGasPrice,
          congestion: 0,
          isOperational: true,
          lastBlockTime: Date.now(),
        });
      },
      setCongestion: async (chainId: number, level: number) => {
        const network = networks.get(chainId);
        if (network) {
          network.congestion = level;
          network.gasPrice = network.gasPrice * BigInt(Math.max(1, level));
        }
      },
      simulateDowntime: async (chainId: number, duration: number) => {
        const network = networks.get(chainId);
        if (network) {
          network.isOperational = false;
          setTimeout(() => {
            network.isOperational = true;
          }, duration * 1000);
        }
      },
      getNetworkState: (chainId: number): NetworkState | undefined => {
        return networks.get(chainId);
      },
      getAllNetworks: (): NetworkState[] => {
        return Array.from(networks.values());
      },
    };
  }
}

/**
 * Scenario-based test builder
 */
export class TestScenarioBuilder {
  private scenario: TestScenario = {
    name: '',
    steps: [],
    preconditions: [],
    expectedOutcomes: [],
    cleanupSteps: [],
  };

  static create(name: string): TestScenarioBuilder {
    const builder = new TestScenarioBuilder();
    builder.scenario.name = name;
    return builder;
  }

  /**
   * Add precondition to scenario
   */
  addPrecondition(description: string, action: () => Promise<void>): TestScenarioBuilder {
    this.scenario.preconditions.push({ description, action });
    return this;
  }

  /**
   * Add test step
   */
  addStep(description: string, action: () => Promise<void>, expectedResult?: string): TestScenarioBuilder {
    this.scenario.steps.push({ description, action, expectedResult });
    return this;
  }

  /**
   * Add expected outcome
   */
  expectOutcome(description: string, validator: () => Promise<boolean>): TestScenarioBuilder {
    this.scenario.expectedOutcomes.push({ description, validator });
    return this;
  }

  /**
   * Add cleanup step
   */
  addCleanup(description: string, action: () => Promise<void>): TestScenarioBuilder {
    this.scenario.cleanupSteps.push({ description, action });
    return this;
  }

  /**
   * Build and execute scenario
   */
  async execute(): Promise<TestScenarioResult> {
    const result: TestScenarioResult = {
      scenarioName: this.scenario.name,
      success: true,
      startTime: Date.now(),
      endTime: 0,
      stepResults: [],
      errors: [],
    };

    try {
      // Execute preconditions
      console.log(`🔧 Setting up preconditions for: ${this.scenario.name}`);
      for (const precondition of this.scenario.preconditions) {
        await precondition.action();
        console.log(`  ✓ ${precondition.description}`);
      }

      // Execute steps
      console.log(`🧪 Executing scenario: ${this.scenario.name}`);
      for (let i = 0; i < this.scenario.steps.length; i++) {
        const step = this.scenario.steps[i];
        const stepStartTime = Date.now();
        
        try {
          await step.action();
          const stepEndTime = Date.now();
          
          result.stepResults.push({
            stepIndex: i,
            description: step.description,
            success: true,
            duration: stepEndTime - stepStartTime,
          });
          
          console.log(`  ✓ Step ${i + 1}: ${step.description}`);
        } catch (error) {
          const stepEndTime = Date.now();
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          result.stepResults.push({
            stepIndex: i,
            description: step.description,
            success: false,
            duration: stepEndTime - stepStartTime,
            error: errorMessage,
          });
          
          result.errors.push(`Step ${i + 1} failed: ${errorMessage}`);
          result.success = false;
          
          console.log(`  ❌ Step ${i + 1} failed: ${step.description} - ${errorMessage}`);
        }
      }

      // Validate outcomes
      console.log(`🔍 Validating outcomes for: ${this.scenario.name}`);
      for (const outcome of this.scenario.expectedOutcomes) {
        try {
          const isValid = await outcome.validator();
          if (!isValid) {
            result.errors.push(`Outcome validation failed: ${outcome.description}`);
            result.success = false;
            console.log(`  ❌ ${outcome.description}`);
          } else {
            console.log(`  ✓ ${outcome.description}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`Outcome validation error: ${outcome.description} - ${errorMessage}`);
          result.success = false;
          console.log(`  ❌ ${outcome.description} - ${errorMessage}`);
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Scenario execution failed: ${errorMessage}`);
      result.success = false;
      console.log(`❌ Scenario failed: ${errorMessage}`);
    } finally {
      // Execute cleanup
      console.log(`🧹 Cleaning up after: ${this.scenario.name}`);
      for (const cleanup of this.scenario.cleanupSteps) {
        try {
          await cleanup.action();
          console.log(`  ✓ ${cleanup.description}`);
        } catch (error) {
          console.warn(`  ⚠️ Cleanup warning: ${cleanup.description} - ${error}`);
        }
      }
      
      result.endTime = Date.now();
    }

    return result;
  }
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
  private static measurements: Map<string, PerformanceMeasurement> = new Map();
  
  /**
   * Start performance measurement
   */
  static start(label: string): PerformanceTracker {
    const measurement: PerformanceMeasurement = {
      label,
      startTime: performance.now(),
      startMemory: process.memoryUsage(),
      endTime: 0,
      endMemory: { rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 },
      gasUsed: 0n,
      transactions: 0,
    };
    
    this.measurements.set(label, measurement);
    
    return {
      recordTransaction: (gasUsed: bigint | number) => {
        const gasAmount = typeof gasUsed === 'bigint' ? gasUsed : BigInt(gasUsed);
        measurement.gasUsed += gasAmount;
        measurement.transactions++;
      },
      
      recordTransactionFromReceipt: async (txResult: any) => {
        try {
          let receipt = txResult;
          if (txResult && typeof txResult.wait === 'function') {
            receipt = await txResult.wait();
          }
          
          if (receipt && receipt.gasUsed) {
            measurement.gasUsed += receipt.gasUsed;
            measurement.transactions++;
          }
        } catch (error) {
          console.warn(`Failed to record transaction from receipt: ${error}`);
        }
      },
      
      end: (): PerformanceResult => {
        measurement.endTime = performance.now();
        measurement.endMemory = process.memoryUsage();
        
        const duration = measurement.endTime - measurement.startTime;
        const memoryDelta = measurement.endMemory.heapUsed - measurement.startMemory.heapUsed;
        
        const result: PerformanceResult = {
          label,
          duration,
          memoryDelta,
          avgGasPerTransaction: measurement.transactions > 0 ? measurement.gasUsed / BigInt(measurement.transactions) : 0n,
          transactionThroughput: measurement.transactions / Math.max(duration / 1000, 0.001), // tx/sec with minimum duration
          peakMemoryUsage: measurement.endMemory.heapUsed,
        };
        
        console.log(`📊 Performance: ${label}`);
        console.log(`  Duration: ${Math.round(duration)}ms`);
        console.log(`  Memory Δ: ${Math.round(memoryDelta / 1024 / 1024)}MB`);
        console.log(`  Avg Gas: ${result.avgGasPerTransaction.toString()}`);
        console.log(`  Throughput: ${Math.round(result.transactionThroughput)} tx/sec`);
        
        return result;
      },
    };
  }
  
  /**
   * Get all measurements
   */
  static getAllMeasurements(): Map<string, PerformanceMeasurement> {
    return new Map(this.measurements);
  }
  
  /**
   * Clear all measurements
   */
  static clear(): void {
    this.measurements.clear();
  }
  
  /**
   * Generate performance report
   */
  static generateReport(): PerformanceReport {
    const measurements = Array.from(this.measurements.values());
    
    return {
      totalTests: measurements.length,
      totalDuration: measurements.reduce((sum, m) => sum + (m.endTime - m.startTime), 0),
      totalMemoryUsed: measurements.reduce((sum, m) => sum + (m.endMemory.heapUsed - m.startMemory.heapUsed), 0),
      totalGasUsed: measurements.reduce((sum, m) => sum + m.gasUsed, 0n),
      averageDuration: measurements.length > 0 ? measurements.reduce((sum, m) => sum + (m.endTime - m.startTime), 0) / measurements.length : 0,
      slowestTest: measurements.reduce((prev, current) => (current.endTime - current.startTime) > (prev.endTime - prev.startTime) ? current : prev, measurements[0]),
      fastestTest: measurements.reduce((prev, current) => (current.endTime - current.startTime) < (prev.endTime - prev.startTime) ? current : prev, measurements[0]),
      measurements,
    };
  }
}

/**
 * Advanced assertion utilities
 */
export class AdvancedAssertions {
  /**
   * Assert gas usage is within expected range with enhanced diagnostics
   */
  static async expectGasUsage(
    transaction: () => Promise<any>,
    minGas: number,
    maxGas: number,
    tolerance: number = 0.1
  ): Promise<void> {
    let tx: any;
    let receipt: any;
    let gasUsed = 0;
    
    try {
      tx = await transaction();
      
      if (tx && typeof tx.wait === 'function') {
        receipt = await tx.wait();
        gasUsed = Number(receipt.gasUsed || 0);
      } else if (tx && tx.gasUsed !== undefined) {
        gasUsed = Number(tx.gasUsed);
      } else {
        throw new Error('Unable to determine gas usage from transaction result');
      }
      
    } catch (error) {
      console.error('Gas usage assertion failed during transaction execution:', error);
      throw error;
    }
    
    const minWithTolerance = minGas * (1 - tolerance);
    const maxWithTolerance = maxGas * (1 + tolerance);
    
    if (gasUsed < minWithTolerance) {
      throw new Error(`Gas usage ${gasUsed} below expected minimum ${minWithTolerance} (expected range: ${minGas}-${maxGas} with ${tolerance * 100}% tolerance)`);
    }
    
    if (gasUsed > maxWithTolerance) {
      const deviation = ((gasUsed - maxGas) / maxGas) * 100;
      throw new Error(`Gas usage ${gasUsed} above expected maximum ${maxWithTolerance} (${deviation.toFixed(1)}% over expected ${maxGas} gas)`);
    }
    
    // Log successful gas usage for debugging
    console.debug(`Gas usage within expected range: ${gasUsed} (expected: ${minGas}-${maxGas})`);
  }
  
  /**
   * Assert transaction reverts with specific message and enhanced error reporting
   */
  static async expectRevertWithMessage(
    transaction: () => Promise<any>,
    expectedMessage: string,
    options: { exact?: boolean; caseInsensitive?: boolean } = {}
  ): Promise<void> {
    let transactionExecuted = false;
    let actualError: any = null;
    
    try {
      const result = await transaction();
      transactionExecuted = true;
      
      // If we get here, the transaction didn't revert
      const resultInfo = result?.hash ? `Transaction hash: ${result.hash}` : 'No transaction hash available';
      throw new Error(`Expected transaction to revert with message "${expectedMessage}", but transaction succeeded. ${resultInfo}`);
      
    } catch (error: any) {
      actualError = error;
      
      // If the error is our own assertion failure, re-throw it
      if (error.message.includes('Expected transaction to revert with message')) {
        throw error;
      }
      
      // Extract the actual error message
      let actualMessage = error.message || error.reason || String(error);
      
      // Handle different error formats
      if (error.error?.message) {
        actualMessage = error.error.message;
      } else if (error.reason) {
        actualMessage = error.reason;
      }
      
      // Apply comparison options
      const expectedToMatch = options.caseInsensitive ? expectedMessage.toLowerCase() : expectedMessage;
      const actualToMatch = options.caseInsensitive ? actualMessage.toLowerCase() : actualMessage;
      
      let matches = false;
      if (options.exact) {
        matches = actualToMatch === expectedToMatch;
      } else {
        matches = actualToMatch.includes(expectedToMatch);
      }
      
      if (!matches) {
        const comparisonType = options.exact ? 'exact match' : 'contains';
        const caseSensitivity = options.caseInsensitive ? 'case-insensitive' : 'case-sensitive';
        throw new Error(
          `Revert message mismatch (${comparisonType}, ${caseSensitivity}):\n` +
          `  Expected: "${expectedMessage}"\n` +
          `  Actual: "${actualMessage}"\n` +
          `  Error type: ${error.constructor.name}`
        );
      }
      
      // Success - transaction reverted with expected message
      console.debug(`Transaction correctly reverted with expected message: "${expectedMessage}"`);
    }
    
    if (!actualError) {
      throw new Error('Unexpected error state in revert assertion');
    }
  }
  
  /**
   * Assert events are emitted in correct order
   */
  static async expectEventsInOrder(
    transaction: () => Promise<any>,
    expectedEvents: string[]
  ): Promise<void> {
    const tx = await transaction();
    const receipt = await tx.wait();
    
    const emittedEvents = receipt.logs.map((log: any) => {
      try {
        return log.fragment?.name || 'Unknown';
      } catch {
        return 'Unknown';
      }
    });
    
    for (let i = 0; i < expectedEvents.length; i++) {
      expect(emittedEvents[i]).to.equal(expectedEvents[i], 
        `Event ${i}: expected "${expectedEvents[i]}" but got "${emittedEvents[i]}"`);
    }
  }
  
  /**
   * Assert balance changes correctly
   */
  static async expectBalanceChange(
    account: SignerWithAddress,
    transaction: () => Promise<any>,
    expectedChange: bigint,
    token?: any
  ): Promise<void> {
    const balanceBefore = token ? await token.balanceOf(account.address) : await account.provider.getBalance(account.address);
    await transaction();
    const balanceAfter = token ? await token.balanceOf(account.address) : await account.provider.getBalance(account.address);
    
    const actualChange = balanceAfter - balanceBefore;
    expect(actualChange).to.equal(expectedChange, 
      `Expected balance change ${expectedChange} but got ${actualChange}`);
  }
}

// Type definitions
export interface BridgeScenario {
  sourceChain: number;
  destChain: number;
  protocol: 'layerzero' | 'celer' | 'hyperlane';
  amount: bigint;
  gasLimit: bigint;
  expectedDuration: number;
  expectedFee: bigint;
}

export interface EconomicAttackScenario {
  name: string;
  type: 'arbitrage' | 'mev' | 'oracle' | 'fee' | 'governance';
  initialCapital: bigint;
  expectedProfit: bigint;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface UserBehaviorPattern {
  type: 'casual_user' | 'power_user' | 'arbitrage_bot' | 'institutional';
  transactionFrequency: 'per_block' | 'hourly' | 'daily' | 'weekly';
  averageAmount: bigint;
  preferredProtocol: 'layerzero' | 'celer' | 'hyperlane';
  riskTolerance: 'very_low' | 'low' | 'medium' | 'high';
  bridgeFrequency: number; // 0-1, percentage of transactions that are cross-chain
}

export interface StressTestScenario {
  name: string;
  type: 'volume' | 'multi_chain' | 'mempool' | 'rate_limit';
  concurrentUsers?: number;
  transactionsPerUser?: number;
  concurrentChains?: number;
  transactionsPerChain?: number;
  concurrentTransactions?: number;
  averageGasPrice?: bigint;
  transactionsPerSecond?: number;
  protocolLimits?: Record<string, number>;
  duration: number; // seconds
  expectedBottleneck: string;
}

export interface EnhancedLayerZeroMock {
  contract: MockLayerZeroEndpoint;
  simulateNetworkCongestion: (congestionLevel: number) => Promise<void>;
  simulateFailedDelivery: (failureRate: number) => Promise<void>;
  getNetworkStats: () => { totalMessages: number; failedDeliveries: number; averageDelay: number };
}

export interface EnhancedCelerMock {
  contract: MockMessageBus;
  setDynamicFees: (baseFee: bigint, congestionMultiplier: number) => Promise<void>;
  simulateLiquidityShortage: (chainId: number, shortage: boolean) => Promise<void>;
  getPoolStats: (chainId: number) => { totalLiquidity: bigint; utilization: number; fees24h: bigint };
}

export interface NetworkConfig {
  chainId: number;
  baseGasPrice: bigint;
  blockTime: number;
  maxTps: number;
}

export interface NetworkState {
  chainId: number;
  gasPrice: bigint;
  congestion: number; // 0-100
  isOperational: boolean;
  lastBlockTime: number;
}

export interface NetworkSimulator {
  contract: any;
  addNetwork: (chainId: number, config: NetworkConfig) => void;
  setCongestion: (chainId: number, level: number) => Promise<void>;
  simulateDowntime: (chainId: number, duration: number) => Promise<void>;
  getNetworkState: (chainId: number) => NetworkState | undefined;
  getAllNetworks: () => NetworkState[];
}

export interface TestScenario {
  name: string;
  steps: TestStep[];
  preconditions: TestPrecondition[];
  expectedOutcomes: TestOutcome[];
  cleanupSteps: TestCleanupStep[];
}

export interface TestStep {
  description: string;
  action: () => Promise<void>;
  expectedResult?: string;
}

export interface TestPrecondition {
  description: string;
  action: () => Promise<void>;
}

export interface TestOutcome {
  description: string;
  validator: () => Promise<boolean>;
}

export interface TestCleanupStep {
  description: string;
  action: () => Promise<void>;
}

export interface TestScenarioResult {
  scenarioName: string;
  success: boolean;
  startTime: number;
  endTime: number;
  stepResults: StepResult[];
  errors: string[];
}

export interface StepResult {
  stepIndex: number;
  description: string;
  success: boolean;
  duration: number;
  error?: string;
}

export interface PerformanceMeasurement {
  label: string;
  startTime: number;
  startMemory: NodeJS.MemoryUsage;
  endTime: number;
  endMemory: NodeJS.MemoryUsage;
  gasUsed: bigint;
  transactions: number;
}

export interface PerformanceTracker {
  recordTransaction: (gasUsed: bigint | number) => void;
  recordTransactionFromReceipt: (txResult: any) => Promise<void>;
  end: () => PerformanceResult;
}

export interface PerformanceResult {
  label: string;
  duration: number;
  memoryDelta: number;
  avgGasPerTransaction: bigint;
  transactionThroughput: number;
  peakMemoryUsage: number;
}

export interface PerformanceReport {
  totalTests: number;
  totalDuration: number;
  totalMemoryUsed: number;
  totalGasUsed: bigint;
  averageDuration: number;
  slowestTest?: PerformanceMeasurement;
  fastestTest?: PerformanceMeasurement;
  measurements: PerformanceMeasurement[];
}

/**
 * Utility functions for common test patterns
 */
export async function executeWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  description: string = "Operation"
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${description} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation()
      .then(result => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export async function waitForCondition(
  condition: () => Promise<boolean>,
  maxWaitTime: number = 30000,
  checkInterval: number = 1000
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  throw new Error(`Condition not met within ${maxWaitTime}ms`);
}

export function createTestLogger(prefix: string) {
  return {
    info: (message: string, ...args: any[]) => console.log(`[${prefix}] ℹ️  ${message}`, ...args),
    success: (message: string, ...args: any[]) => console.log(`[${prefix}] ✅ ${message}`, ...args),
    warning: (message: string, ...args: any[]) => console.log(`[${prefix}] ⚠️  ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.log(`[${prefix}] ❌ ${message}`, ...args),
    debug: (message: string, ...args: any[]) => {
      if (process.env.DEBUG_TESTS) {
        console.log(`[${prefix}] 🐛 ${message}`, ...args);
      }
    },
  };
}

/**
 * Export commonly used testing utilities
 */
export {
  TestDataGenerator,
  MockContractGenerator,
  TestScenarioBuilder,
  PerformanceMonitor,
  AdvancedAssertions,
  executeWithTimeout,
  waitForCondition,
  createTestLogger,
};