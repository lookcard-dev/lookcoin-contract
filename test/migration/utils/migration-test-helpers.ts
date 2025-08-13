/**
 * Migration Test Helpers
 * 
 * Comprehensive utility functions for migration testing between LevelDB and JSON backends.
 * Provides standardized testing patterns, data validation, and mock implementations.
 */

import { ethers } from "hardhat";
import { expect } from "chai";
import { 
  IStateManager, 
  ContractType, 
  StateManagerConfig,
  MigrationConfig,
  StateManagerError,
  StateManagerErrorCode
} from "../../../scripts/utils/IStateManager";
import { StateManagerFactory } from "../../../scripts/utils/StateManagerFactory";
import { LevelDBStateManager } from "../../../scripts/utils/LevelDBStateManager";
import { JSONStateManager } from "../../../scripts/utils/JSONStateManager";
import { getChainConfig } from "../../../hardhat.config";
import * as fs from 'fs/promises';
import * as path from 'path';

// Test configuration constants
export const TEST_NETWORKS = {
  BSC_MAINNET: { chainId: 56, name: "bscmainnet", contracts: 8, mode: "multi-protocol" },
  BSC_TESTNET: { chainId: 97, name: "bsctestnet", contracts: 9, mode: "multi-protocol" },
  BASE_SEPOLIA: { chainId: 84532, name: "basesepolia", contracts: 3, mode: "standard" },
  OPTIMISM_SEPOLIA: { chainId: 11155420, name: "optimismsepolia", contracts: 3, mode: "standard" },
  SAPPHIRE_TESTNET: { chainId: 23295, name: "sapphiretestnet", contracts: 3, mode: "standard" }
};

export const KNOWN_CONTRACTS = {
  CORE: ["LookCoin", "SupplyOracle"],
  PROTOCOLS: ["LayerZeroModule", "CelerIMModule", "HyperlaneModule"],
  INFRASTRUCTURE: ["CrossChainRouter", "FeeManager", "SecurityManager", "ProtocolRegistry"]
};

export const EXPECTED_HASHES = {
  LookCoin: "0x035df318e7b4d02767fc5d749d77c0cd1f8a24e45950df940b71de21b6b81d49",
  LayerZeroModule: "0x6c99f65d61cc52b89b08d9816f295ab86302068a04a5f7d1211fe11683b9c4b1",
  CelerIMModule: "0xefc292208ede616ee62527e07708925ea60a9bfe42d7e1d7dd40082cc7d365fe"
};

// Corrupted entries that should be cleaned up
export const CORRUPTED_ENTRIES = [
  { chainId: 31337, contractName: "LookCoin" },
  { chainId: 31337, contractName: "SupplyOracle" }
];

/**
 * Test State Manager Factory with isolated test environments
 */
export class TestStateManagerFactory extends StateManagerFactory {
  private testDbPath: string;
  private testJsonPath: string;
  private cleanup: (() => Promise<void>)[] = [];

  constructor(testSuffix: string = '') {
    super();
    const timestamp = Date.now();
    this.testDbPath = path.join(process.cwd(), `leveldb-test-${timestamp}${testSuffix}`);
    this.testJsonPath = path.join(process.cwd(), `deployments-test-${timestamp}${testSuffix}`);
  }

  async createTestStateManager(backend: 'leveldb' | 'json', config?: StateManagerConfig): Promise<IStateManager> {
    let testConfig: StateManagerConfig;

    if (backend === 'leveldb') {
      testConfig = {
        ...config,
        dbPath: this.testDbPath,
        debugMode: process.env.DEBUG_MIGRATION_TESTS === 'true'
      };
    } else {
      testConfig = {
        ...config,
        jsonPath: this.testJsonPath,
        debugMode: process.env.DEBUG_MIGRATION_TESTS === 'true',
        enableCache: true,
        cacheSize: 100,
        atomicWrites: true,
        prettyPrint: true
      };
    }

    const manager = await this.createStateManager(backend, testConfig);
    
    // Register cleanup
    this.cleanup.push(async () => {
      await manager.close();
      if (backend === 'leveldb') {
        await this.cleanupTestDb();
      } else {
        await this.cleanupTestJson();
      }
    });

    return manager;
  }

  async createTestMigrationManager(
    sourceBackend: 'leveldb' | 'json',
    targetBackend: 'leveldb' | 'json',
    config?: MigrationConfig
  ): Promise<IStateManager> {
    const migrationConfig: MigrationConfig = {
      ...config,
      dualWriteEnabled: true,
      fallbackOnError: true,
      validationEnabled: true,
      debugMode: process.env.DEBUG_MIGRATION_TESTS === 'true',
      batchSize: 10,
      lockTimeout: 5000
    };

    const sourceManager = await this.createTestStateManager(sourceBackend, migrationConfig);
    const targetManager = await this.createTestStateManager(targetBackend, migrationConfig);

    const migrationManager = await this.createMigrationManager(sourceBackend, targetBackend, migrationConfig);
    
    this.cleanup.push(async () => {
      await migrationManager.close();
    });

    return migrationManager;
  }

  async cleanupAll(): Promise<void> {
    for (const cleanupFn of this.cleanup) {
      await cleanupFn().catch(err => {
        console.warn('Cleanup error:', err.message);
      });
    }
    this.cleanup = [];
  }

  private async cleanupTestDb(): Promise<void> {
    try {
      const { rm } = await import('fs/promises');
      await rm(this.testDbPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  private async cleanupTestJson(): Promise<void> {
    try {
      const { rm } = await import('fs/promises');
      await rm(this.testJsonPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Contract Data Generator for Testing
 */
export class TestContractGenerator {
  static createMockContract(
    chainId: number,
    contractName: string,
    overrides: Partial<ContractType> = {}
  ): ContractType {
    const networkName = Object.values(TEST_NETWORKS)
      .find(n => n.chainId === chainId)?.name || `chain${chainId}`;

    return {
      contractName,
      chainId,
      networkName,
      address: overrides.address || ethers.Wallet.createRandom().address,
      factoryByteCodeHash: overrides.factoryByteCodeHash || EXPECTED_HASHES[contractName as keyof typeof EXPECTED_HASHES] || ethers.keccak256(ethers.toUtf8Bytes(`${contractName}-${chainId}`)),
      implementationHash: overrides.implementationHash || EXPECTED_HASHES[contractName as keyof typeof EXPECTED_HASHES],
      proxyAddress: overrides.proxyAddress || ethers.Wallet.createRandom().address,
      deploymentArgs: overrides.deploymentArgs || [ethers.Wallet.createRandom().address, "5000000000000000"],
      timestamp: overrides.timestamp || Date.now(),
      ...overrides
    };
  }

  static createCorruptedContract(chainId: number, contractName: string): any {
    return {
      contractName,
      chainId,
      networkName: `chain${chainId}`,
      address: "invalid-address", // Invalid format
      factoryByteCodeHash: "", // Empty hash
      implementationHash: undefined,
      proxyAddress: null,
      deploymentArgs: [],
      timestamp: "invalid-timestamp" // Invalid type
    };
  }

  static createContractWithBigInt(chainId: number, contractName: string): ContractType {
    const baseContract = this.createMockContract(chainId, contractName);
    return {
      ...baseContract,
      timestamp: Date.now(),
      deploymentArgs: [
        ethers.Wallet.createRandom().address,
        BigInt("5000000000000000"), // BigInt value
        {
          nested: {
            bigIntValue: BigInt("999999999999999999999")
          }
        }
      ]
    };
  }

  static async populateTestData(manager: IStateManager, networkConfig: typeof TEST_NETWORKS[keyof typeof TEST_NETWORKS]): Promise<ContractType[]> {
    const contracts: ContractType[] = [];

    // Add core contracts (always present)
    for (const contractName of KNOWN_CONTRACTS.CORE) {
      const contract = this.createMockContract(networkConfig.chainId, contractName);
      await manager.putContract(networkConfig.chainId, contract);
      contracts.push(contract);
    }

    // Add protocol contracts based on network mode
    if (networkConfig.mode === "multi-protocol") {
      for (const contractName of KNOWN_CONTRACTS.PROTOCOLS) {
        const contract = this.createMockContract(networkConfig.chainId, contractName);
        await manager.putContract(networkConfig.chainId, contract);
        contracts.push(contract);
      }

      // Add infrastructure contracts (BSC networks only)
      if (networkConfig.chainId === 56 || networkConfig.chainId === 97) {
        for (const contractName of KNOWN_CONTRACTS.INFRASTRUCTURE) {
          const contract = this.createMockContract(networkConfig.chainId, contractName);
          await manager.putContract(networkConfig.chainId, contract);
          contracts.push(contract);
        }
      }
    } else {
      // Standard mode - only LayerZero or Celer
      const protocolContract = networkConfig.chainId === 23295 ? "CelerIMModule" : "LayerZeroModule";
      const contract = this.createMockContract(networkConfig.chainId, protocolContract);
      await manager.putContract(networkConfig.chainId, contract);
      contracts.push(contract);
    }

    return contracts;
  }
}

/**
 * Data Validation Utilities
 */
export class DataValidationUtils {
  /**
   * Compare two contracts for deep equality, handling BigInt serialization
   */
  static compareContracts(contract1: ContractType, contract2: ContractType): boolean {
    // Compare basic fields
    if (
      contract1.contractName !== contract2.contractName ||
      contract1.chainId !== contract2.chainId ||
      contract1.networkName !== contract2.networkName ||
      contract1.address !== contract2.address ||
      contract1.factoryByteCodeHash !== contract2.factoryByteCodeHash
    ) {
      return false;
    }

    // Compare optional fields
    if (contract1.implementationHash !== contract2.implementationHash) {
      return false;
    }

    if (contract1.proxyAddress !== contract2.proxyAddress) {
      return false;
    }

    // Compare timestamps (allow small differences due to serialization)
    const timeDiff = Math.abs(contract1.timestamp - contract2.timestamp);
    if (timeDiff > 1000) { // Allow 1 second difference
      return false;
    }

    // Compare deployment args (handle BigInt serialization)
    if (!this.compareDeploymentArgs(contract1.deploymentArgs, contract2.deploymentArgs)) {
      return false;
    }

    return true;
  }

  /**
   * Compare deployment args handling BigInt values
   */
  static compareDeploymentArgs(args1?: any[], args2?: any[]): boolean {
    if (!args1 && !args2) return true;
    if (!args1 || !args2) return false;
    if (args1.length !== args2.length) return false;

    for (let i = 0; i < args1.length; i++) {
      if (!this.deepCompareWithBigInt(args1[i], args2[i])) {
        return false;
      }
    }

    return true;
  }

  /**
   * Deep comparison handling BigInt values and serialization
   */
  static deepCompareWithBigInt(obj1: any, obj2: any): boolean {
    // Handle BigInt comparison
    if (typeof obj1 === 'bigint' || typeof obj2 === 'bigint') {
      return BigInt(obj1) === BigInt(obj2);
    }

    // Handle null/undefined
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return false;

    // Handle arrays
    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;
    if (Array.isArray(obj1)) {
      if (obj1.length !== obj2.length) return false;
      for (let i = 0; i < obj1.length; i++) {
        if (!this.deepCompareWithBigInt(obj1[i], obj2[i])) return false;
      }
      return true;
    }

    // Handle objects
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') {
      return obj1 === obj2;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this.deepCompareWithBigInt(obj1[key], obj2[key])) return false;
    }

    return true;
  }

  /**
   * Validate contract data structure
   */
  static validateContractStructure(contract: any): string[] {
    const errors: string[] = [];

    if (!contract || typeof contract !== 'object') {
      errors.push('Contract must be a valid object');
      return errors;
    }

    // Required fields
    if (typeof contract.contractName !== 'string' || !contract.contractName) {
      errors.push('contractName must be a non-empty string');
    }

    if (typeof contract.chainId !== 'number' || contract.chainId <= 0) {
      errors.push('chainId must be a positive number');
    }

    if (typeof contract.networkName !== 'string' || !contract.networkName) {
      errors.push('networkName must be a non-empty string');
    }

    if (typeof contract.address !== 'string' || !ethers.isAddress(contract.address)) {
      errors.push('address must be a valid Ethereum address');
    }

    if (typeof contract.factoryByteCodeHash !== 'string' || !contract.factoryByteCodeHash.match(/^0x[a-fA-F0-9]{64}$/)) {
      errors.push('factoryByteCodeHash must be a valid 32-byte hex string');
    }

    if (typeof contract.timestamp !== 'number' || contract.timestamp <= 0) {
      errors.push('timestamp must be a positive number');
    }

    // Optional fields validation
    if (contract.implementationHash && !contract.implementationHash.match(/^0x[a-fA-F0-9]{64}$/)) {
      errors.push('implementationHash must be a valid 32-byte hex string');
    }

    if (contract.proxyAddress && !ethers.isAddress(contract.proxyAddress)) {
      errors.push('proxyAddress must be a valid Ethereum address');
    }

    return errors;
  }

  /**
   * Generate comprehensive validation report for migration testing
   */
  static async generateValidationReport(
    sourceManager: IStateManager,
    targetManager: IStateManager,
    networks: (typeof TEST_NETWORKS[keyof typeof TEST_NETWORKS])[]
  ): Promise<{
    totalContracts: number;
    matchingContracts: number;
    missingInTarget: ContractType[];
    missingInSource: ContractType[];
    dataDiscrepancies: Array<{
      chainId: number;
      contractName: string;
      differences: string[];
    }>;
    corruptedEntries: Array<{
      chainId: number;
      contractName: string;
      errors: string[];
    }>;
  }> {
    const report = {
      totalContracts: 0,
      matchingContracts: 0,
      missingInTarget: [] as ContractType[],
      missingInSource: [] as ContractType[],
      dataDiscrepancies: [] as Array<{
        chainId: number;
        contractName: string;
        differences: string[];
      }>,
      corruptedEntries: [] as Array<{
        chainId: number;
        contractName: string;
        errors: string[];
      }>
    };

    for (const network of networks) {
      const sourceContracts = await sourceManager.getAllContracts(network.chainId);
      const targetContracts = await targetManager.getAllContracts(network.chainId);

      report.totalContracts += sourceContracts.length;

      // Build maps for comparison
      const sourceMap = new Map(sourceContracts.map(c => [`${c.chainId}-${c.contractName}`, c]));
      const targetMap = new Map(targetContracts.map(c => [`${c.chainId}-${c.contractName}`, c]));

      // Find missing contracts
      for (const [key, sourceContract] of sourceMap) {
        if (!targetMap.has(key)) {
          report.missingInTarget.push(sourceContract);
        }
      }

      for (const [key, targetContract] of targetMap) {
        if (!sourceMap.has(key)) {
          report.missingInSource.push(targetContract);
        }
      }

      // Compare matching contracts
      for (const [key, sourceContract] of sourceMap) {
        const targetContract = targetMap.get(key);
        if (targetContract) {
          // Validate structure
          const sourceErrors = this.validateContractStructure(sourceContract);
          const targetErrors = this.validateContractStructure(targetContract);

          if (sourceErrors.length > 0 || targetErrors.length > 0) {
            report.corruptedEntries.push({
              chainId: sourceContract.chainId,
              contractName: sourceContract.contractName,
              errors: [...sourceErrors, ...targetErrors]
            });
          } else if (this.compareContracts(sourceContract, targetContract)) {
            report.matchingContracts++;
          } else {
            // Find specific differences
            const differences: string[] = [];
            
            if (sourceContract.address !== targetContract.address) {
              differences.push(`address: ${sourceContract.address} !== ${targetContract.address}`);
            }
            if (sourceContract.factoryByteCodeHash !== targetContract.factoryByteCodeHash) {
              differences.push(`factoryByteCodeHash: ${sourceContract.factoryByteCodeHash} !== ${targetContract.factoryByteCodeHash}`);
            }
            if (sourceContract.implementationHash !== targetContract.implementationHash) {
              differences.push(`implementationHash: ${sourceContract.implementationHash} !== ${targetContract.implementationHash}`);
            }

            report.dataDiscrepancies.push({
              chainId: sourceContract.chainId,
              contractName: sourceContract.contractName,
              differences
            });
          }
        }
      }
    }

    return report;
  }
}

/**
 * Performance Benchmark Utilities
 */
export class BenchmarkUtils {
  static async measureOperation<T>(
    operation: () => Promise<T>,
    iterations: number = 100
  ): Promise<{
    result: T;
    averageTime: number;
    minTime: number;
    maxTime: number;
    totalTime: number;
  }> {
    const times: number[] = [];
    let result: T;

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      result = await operation();
      const endTime = Date.now();
      times.push(endTime - startTime);
    }

    return {
      result: result!,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      totalTime: times.reduce((a, b) => a + b, 0)
    };
  }

  static async benchmarkStateManagerOperations(
    manager: IStateManager,
    chainId: number,
    iterations: number = 100
  ): Promise<{
    read: ReturnType<typeof BenchmarkUtils.measureOperation>;
    write: ReturnType<typeof BenchmarkUtils.measureOperation>;
    query: ReturnType<typeof BenchmarkUtils.measureOperation>;
  }> {
    const testContract = TestContractGenerator.createMockContract(chainId, "TestContract");
    await manager.putContract(chainId, testContract);

    // Benchmark read operations
    const readBenchmark = await this.measureOperation(async () => {
      return await manager.getContract(chainId, testContract.contractName);
    }, iterations);

    // Benchmark write operations
    const writeBenchmark = await this.measureOperation(async () => {
      const contract = TestContractGenerator.createMockContract(chainId, `WriteTest${Date.now()}`);
      await manager.putContract(chainId, contract);
      return contract;
    }, Math.min(iterations, 10)); // Fewer iterations for write operations

    // Benchmark query operations
    const queryBenchmark = await this.measureOperation(async () => {
      return await manager.queryContracts({
        chainId,
        sortBy: 'timestamp',
        sortOrder: 'desc'
      });
    }, Math.min(iterations, 20)); // Fewer iterations for query operations

    return {
      read: readBenchmark,
      write: writeBenchmark,
      query: queryBenchmark
    };
  }
}

/**
 * Mock Error Scenarios for Testing
 */
export class ErrorScenarioUtils {
  static createMockFailingStateManager(baseManager: IStateManager, failureRate: number = 0.5): IStateManager {
    return {
      ...baseManager,
      getContract: async (chainId: number, contractName: string) => {
        if (Math.random() < failureRate) {
          throw new StateManagerError(
            StateManagerErrorCode.BACKEND_UNAVAILABLE,
            'Mock failure in getContract',
            { chainId, contractName }
          );
        }
        return baseManager.getContract(chainId, contractName);
      },
      putContract: async (chainId: number, contract: ContractType) => {
        if (Math.random() < failureRate) {
          throw new StateManagerError(
            StateManagerErrorCode.WRITE_FAILED,
            'Mock failure in putContract',
            { chainId, contract }
          );
        }
        return baseManager.putContract(chainId, contract);
      }
    } as IStateManager;
  }

  static async simulateFileCorruption(filePath: string): Promise<void> {
    try {
      await fs.writeFile(filePath, 'corrupted-data', 'utf-8');
    } catch {
      // Ignore if file doesn't exist
    }
  }

  static async simulatePermissionError(filePath: string): Promise<void> {
    try {
      await fs.chmod(filePath, 0o000); // Remove all permissions
    } catch {
      // Ignore if file doesn't exist or permissions can't be changed
    }
  }
}

/**
 * Test Assertion Utilities
 */
export class TestAssertions {
  static expectContractsToMatch(contract1: ContractType, contract2: ContractType, message?: string): void {
    const differences = DataValidationUtils.compareContracts(contract1, contract2);
    expect(differences, message || `Contracts should match`).to.be.true;
  }

  static expectValidContract(contract: ContractType): void {
    const errors = DataValidationUtils.validateContractStructure(contract);
    expect(errors, `Contract should be valid: ${errors.join(', ')}`).to.be.empty;
  }

  static expectPerformanceWithinRange(
    actualTime: number,
    baselineTime: number,
    maxMultiplier: number,
    operation: string
  ): void {
    const maxAllowedTime = baselineTime * maxMultiplier;
    expect(actualTime, `${operation} should complete within ${maxMultiplier}x baseline (${actualTime}ms vs ${maxAllowedTime}ms max)`).to.be.lessThanOrEqual(maxAllowedTime);
  }

  static expectStateManagerError(
    error: any,
    expectedCode: StateManagerErrorCode,
    expectedMessagePattern?: RegExp
  ): void {
    expect(error, 'Should be a StateManagerError').to.be.instanceOf(StateManagerError);
    expect(error.code, `Error code should be ${expectedCode}`).to.equal(expectedCode);
    if (expectedMessagePattern) {
      expect(error.message, `Error message should match pattern`).to.match(expectedMessagePattern);
    }
  }
}

/**
 * Test lifecycle management
 */
export class TestLifecycle {
  private factories: TestStateManagerFactory[] = [];
  private managers: IStateManager[] = [];

  async createFactory(suffix?: string): Promise<TestStateManagerFactory> {
    const factory = new TestStateManagerFactory(suffix);
    this.factories.push(factory);
    return factory;
  }

  async createManager(factory: TestStateManagerFactory, backend: 'leveldb' | 'json', config?: StateManagerConfig): Promise<IStateManager> {
    const manager = await factory.createTestStateManager(backend, config);
    this.managers.push(manager);
    return manager;
  }

  async cleanup(): Promise<void> {
    // Close all managers
    for (const manager of this.managers) {
      try {
        await manager.close();
      } catch (error) {
        console.warn('Error closing manager during cleanup:', error);
      }
    }

    // Cleanup all factories
    for (const factory of this.factories) {
      try {
        await factory.cleanupAll();
      } catch (error) {
        console.warn('Error cleaning up factory:', error);
      }
    }

    this.managers = [];
    this.factories = [];
  }
}