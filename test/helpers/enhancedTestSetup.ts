import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { Web3ProviderManager, ChainValidationUtils } from "./web3Provider";
import { CrossChainSimulator } from "./crossChainSimulator";
import { NetworkProviderManager } from "./networkProvider";

/**
 * Enhanced test setup utilities for comprehensive Web3 integration testing
 */

export interface TestEnvironment {
  web3Provider: Web3ProviderManager;
  networkProvider: NetworkProviderManager;
  crossChainSimulator?: CrossChainSimulator;
  signers: SignerWithAddress[];
  testConfig: TestConfiguration;
}

export interface TestConfiguration {
  chainId: number;
  networkName: string;
  gasLimits: {
    deploy: number;
    transfer: number;
    bridge: number;
    complex: number;
  };
  timeouts: {
    transaction: number;
    block: number;
    crossChain: number;
  };
  retryPolicy: {
    maxRetries: number;
    baseDelay: number;
  };
}

/**
 * Enhanced Test Setup Manager
 */
export class EnhancedTestSetup {
  private static instance: EnhancedTestSetup;
  private testEnvironments: Map<string, TestEnvironment> = new Map();
  private globalConfig: TestConfiguration;

  constructor() {
    this.globalConfig = {
      chainId: 31337, // Hardhat default
      networkName: "Hardhat",
      gasLimits: {
        deploy: 5000000,
        transfer: 100000,
        bridge: 500000,
        complex: 1000000,
      },
      timeouts: {
        transaction: 30000,
        block: 5000,
        crossChain: 60000,
      },
      retryPolicy: {
        maxRetries: 3,
        baseDelay: 1000,
      },
    };
  }

  static getInstance(): EnhancedTestSetup {
    if (!EnhancedTestSetup.instance) {
      EnhancedTestSetup.instance = new EnhancedTestSetup();
    }
    return EnhancedTestSetup.instance;
  }

  /**
   * Initialize comprehensive test environment
   */
  async initializeTestEnvironment(testSuiteName: string): Promise<TestEnvironment> {
    console.debug(`Initializing test environment for: ${testSuiteName}`);

    try {
      // Validate network connection first
      const web3Provider = new Web3ProviderManager();
      const networkValid = await web3Provider.validateNetworkConnection();
      
      if (!networkValid) {
        throw new Error("Network validation failed during test setup");
      }

      // Validate chain ID
      const chainIdValid = await ChainValidationUtils.validateChainId(
        ethers.provider,
        this.globalConfig.chainId
      );
      
      if (!chainIdValid) {
        console.warn("Chain ID validation failed - tests may behave unexpectedly");
      }

      // Initialize network provider with enhanced features
      const networkProvider = new NetworkProviderManager();
      await networkProvider.initializeNetwork(this.globalConfig.chainId);

      // Get signers with enhanced validation
      const signers = await this.getValidatedSigners();

      // Create test environment
      const testEnvironment: TestEnvironment = {
        web3Provider,
        networkProvider,
        signers,
        testConfig: { ...this.globalConfig },
      };

      // Store for cleanup
      this.testEnvironments.set(testSuiteName, testEnvironment);

      console.debug(`Test environment initialized successfully for: ${testSuiteName}`);
      return testEnvironment;
    } catch (error) {
      console.error(`Failed to initialize test environment for ${testSuiteName}:`, error);
      throw error;
    }
  }

  /**
   * Get validated signers with balance checks
   */
  private async getValidatedSigners(): Promise<SignerWithAddress[]> {
    const signers = await ethers.getSigners();
    
    // Validate that signers have sufficient balance for testing
    for (let i = 0; i < Math.min(10, signers.length); i++) {
      const signer = signers[i];
      const balance = await ethers.provider.getBalance(signer.address);
      
      if (balance < ethers.parseEther("1")) {
        console.warn(`Signer ${i} (${signer.address}) has low balance: ${ethers.formatEther(balance)} ETH`);
      }
    }

    console.debug(`Validated ${signers.length} signers`);
    return signers;
  }

  /**
   * Setup cross-chain testing environment
   */
  async setupCrossChainEnvironment(
    testSuiteName: string,
    lookCoin: any,
    layerZeroModule: any,
    celerIMModule: any,
    hyperlaneModule: any,
    mockLayerZero: any,
    mockCeler: any,
    mockHyperlane: any
  ): Promise<TestEnvironment> {
    const testEnv = await this.initializeTestEnvironment(testSuiteName);

    try {
      // Initialize cross-chain simulator
      const crossChainSimulator = new CrossChainSimulator(
        [
          { chainId: 56, domain: 56, eid: 30102, name: "BSC" },
          { chainId: 10, domain: 10, eid: 30111, name: "Optimism" },
          { chainId: 8453, domain: 8453, eid: 30184, name: "Base" },
        ],
        lookCoin,
        layerZeroModule,
        celerIMModule,
        hyperlaneModule,
        mockLayerZero,
        mockCeler,
        mockHyperlane
      );

      testEnv.crossChainSimulator = crossChainSimulator;

      // Initialize cross-chain connections
      await crossChainSimulator.initializeCrossChainConnections(testEnv.signers[1]); // Use admin signer

      console.debug(`Cross-chain environment setup completed for: ${testSuiteName}`);
      return testEnv;
    } catch (error) {
      console.error(`Failed to setup cross-chain environment for ${testSuiteName}:`, error);
      throw error;
    }
  }

  /**
   * Execute transaction with comprehensive error handling
   */
  async executeTransactionSafely(
    testEnv: TestEnvironment,
    signer: SignerWithAddress,
    txRequest: any,
    operationType: keyof TestConfiguration["gasLimits"] = "complex"
  ): Promise<any> {
    // Set appropriate gas limit based on operation type
    if (!txRequest.gasLimit) {
      txRequest.gasLimit = testEnv.testConfig.gasLimits[operationType];
    }

    try {
      const receipt = await testEnv.web3Provider.executeTransactionWithRetry(
        signer,
        txRequest
      );

      // Validate transaction success
      expect(receipt.status).to.equal(1, "Transaction should succeed");
      
      return receipt;
    } catch (error) {
      console.error(`Transaction failed for operation type '${operationType}':`, error);
      throw error;
    }
  }

  /**
   * Wait for cross-chain operation completion
   */
  async waitForCrossChainCompletion(
    testEnv: TestEnvironment,
    operationPromise: Promise<any>,
    timeoutMs?: number
  ): Promise<any> {
    const timeout = timeoutMs || testEnv.testConfig.timeouts.crossChain;
    
    return Promise.race([
      operationPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Cross-chain operation timeout after ${timeout}ms`)), timeout)
      )
    ]);
  }

  /**
   * Validate contract deployment
   */
  async validateContractDeployment(
    contractAddress: string,
    expectedBytecode?: string
  ): Promise<boolean> {
    try {
      const code = await ethers.provider.getCode(contractAddress);
      
      if (code === "0x") {
        console.error(`No contract deployed at address: ${contractAddress}`);
        return false;
      }

      if (expectedBytecode && code !== expectedBytecode) {
        console.warn(`Contract bytecode mismatch at address: ${contractAddress}`);
      }

      console.debug(`Contract validation successful: ${contractAddress}`);
      return true;
    } catch (error) {
      console.error(`Contract validation failed for ${contractAddress}:`, error);
      return false;
    }
  }

  /**
   * Simulate network conditions for robust testing
   */
  async simulateNetworkConditions(
    testEnv: TestEnvironment,
    condition: "normal" | "congested" | "unstable" | "failing"
  ): Promise<void> {
    console.debug(`Simulating network condition: ${condition}`);

    switch (condition) {
      case "normal":
        await testEnv.web3Provider.simulateNetworkConditions("normal");
        await testEnv.networkProvider.simulateNetworkCongestion(31337, "low");
        break;
        
      case "congested":
        await testEnv.web3Provider.simulateNetworkConditions("congested");
        await testEnv.networkProvider.simulateNetworkCongestion(31337, "high");
        break;
        
      case "unstable":
        await testEnv.networkProvider.simulateNetworkCongestion(31337, "medium");
        // Simulate intermittent issues
        break;
        
      case "failing":
        await testEnv.web3Provider.simulateNetworkConditions("failing");
        await testEnv.networkProvider.simulateNetworkCongestion(31337, "extreme");
        break;
    }
  }

  /**
   * Cleanup test environment
   */
  async cleanupTestEnvironment(testSuiteName: string): Promise<void> {
    const testEnv = this.testEnvironments.get(testSuiteName);
    if (!testEnv) return;

    try {
      // Clear metrics and tracking data
      testEnv.web3Provider.clearMetrics();
      testEnv.networkProvider.clearTracking();
      
      if (testEnv.crossChainSimulator) {
        testEnv.crossChainSimulator.clearMessageQueue();
      }

      // Reset network conditions to normal
      await this.simulateNetworkConditions(testEnv, "normal");

      this.testEnvironments.delete(testSuiteName);
      console.debug(`Test environment cleanup completed for: ${testSuiteName}`);
    } catch (error) {
      console.warn(`Test environment cleanup failed for ${testSuiteName}:`, error);
    }
  }

  /**
   * Generate test report
   */
  generateTestReport(): {
    environments: number;
    totalNetworkStats: any;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let totalNetworkStats = {
      totalTransactions: 0,
      successfulTransactions: 0,
      totalGasUsed: 0n,
      totalCost: 0n,
    };

    for (const [name, env] of this.testEnvironments) {
      const stats = env.web3Provider.getNetworkStatistics();
      totalNetworkStats.totalTransactions += stats.totalTransactions;
      totalNetworkStats.successfulTransactions += stats.successfulTransactions;
      totalNetworkStats.totalGasUsed += stats.totalGasUsed;
      totalNetworkStats.totalCost += stats.totalCost;

      // Generate recommendations based on metrics
      const successRate = stats.totalTransactions > 0 
        ? (stats.successfulTransactions / stats.totalTransactions) * 100 
        : 100;

      if (successRate < 90) {
        recommendations.push(
          `Test suite '${name}' has low success rate (${successRate.toFixed(1)}%) - review error handling`
        );
      }

      const avgGasPrice = Number(ethers.formatUnits(stats.averageGasPrice, "gwei"));
      if (avgGasPrice > 50) {
        recommendations.push(
          `Test suite '${name}' using high gas prices (${avgGasPrice.toFixed(2)} gwei) - optimize transactions`
        );
      }
    }

    return {
      environments: this.testEnvironments.size,
      totalNetworkStats,
      recommendations,
    };
  }

  /**
   * Get test environment
   */
  getTestEnvironment(testSuiteName: string): TestEnvironment | undefined {
    return this.testEnvironments.get(testSuiteName);
  }
}

/**
 * Convenience functions for common test patterns
 */
export namespace TestPatterns {
  /**
   * Execute bridge operation with comprehensive validation
   */
  export async function executeBridgeOperation(
    testEnv: TestEnvironment,
    bridgeContract: any,
    method: string,
    args: any[],
    signer: SignerWithAddress,
    value?: bigint
  ): Promise<any> {
    const setupManager = EnhancedTestSetup.getInstance();

    const txRequest = {
      to: await bridgeContract.getAddress(),
      data: bridgeContract.interface.encodeFunctionData(method, args),
      value: value || 0n,
    };

    return setupManager.executeTransactionSafely(
      testEnv,
      signer,
      txRequest,
      "bridge"
    );
  }

  /**
   * Validate cross-chain state consistency
   */
  export async function validateCrossChainConsistency(
    testEnv: TestEnvironment
  ): Promise<boolean> {
    if (!testEnv.crossChainSimulator) {
      console.warn("Cross-chain simulator not available for consistency check");
      return false;
    }

    return testEnv.crossChainSimulator.validateSupplyConsistency();
  }

  /**
   * Execute with timeout and retry
   */
  export async function executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (i < maxRetries) {
          console.debug(`Operation failed, retrying in ${delay}ms (attempt ${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 1.5; // Exponential backoff
        }
      }
    }
    
    throw new Error(`Operation failed after ${maxRetries} retries: ${lastError}`);
  }
}

// Singleton instance
export const enhancedTestSetup = EnhancedTestSetup.getInstance();