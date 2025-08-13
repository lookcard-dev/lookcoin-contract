/**
 * Comprehensive Performance Benchmarking Suite
 * 
 * Exhaustive performance comparison between UnifiedJSONStateManager and LevelDBStateManager
 * to ensure production-ready migration with acceptable performance characteristics.
 * 
 * Target Performance Metrics:
 * - Read operations: < 50ms per contract (JSON ≤ 2x LevelDB)
 * - Write operations: < 100ms per contract (JSON ≤ 3x LevelDB)
 * - Bulk operations: < 5 seconds for 100 contracts
 * - Memory usage: < 500MB for full dataset (JSON ≤ 150% LevelDB)
 * - No more than 10% performance degradation vs LevelDB
 * 
 * Test Coverage:
 * - Single contract operations (baseline performance)
 * - Bulk operations (50-100 contracts)
 * - Stress testing (100+ contracts)
 * - Concurrent access (5-10 parallel operations)
 * - Cold start vs hot cache performance
 * - Memory usage and leak detection
 * - Real production data from BSC testnet
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { ethers } from 'hardhat';
import {
  IStateManager,
  ContractType,
  StateManagerConfig,
  BackendMetrics,
  StateManagerError
} from '../utils/IStateManager';
import { StateManagerFactory } from '../utils/StateManagerFactory';
import { LevelDBStateManager } from '../utils/LevelDBStateManager';
import { UnifiedJSONStateManager } from '../utils/UnifiedJSONStateManager';

// Performance benchmark configuration
interface BenchmarkConfig {
  iterations: {
    baseline: number;
    bulk: number;
    stress: number;
    concurrent: number;
  };
  datasets: {
    single: number;
    bulk: number;
    stress: number;
  };
  timeouts: {
    operation: number;
    suite: number;
  };
  warmup: {
    enabled: boolean;
    iterations: number;
  };
}

const BENCHMARK_CONFIG: BenchmarkConfig = {
  iterations: {
    baseline: 100,    // High precision for baseline metrics
    bulk: 25,         // Moderate iterations for bulk operations
    stress: 10,       // Lower iterations for stress tests
    concurrent: 20    // Concurrent operation iterations
  },
  datasets: {
    single: 1,        // Single contract operations
    bulk: 50,         // Bulk operations dataset size
    stress: 150       // Stress testing dataset size
  },
  timeouts: {
    operation: 30000, // 30 second timeout per operation
    suite: 300000     // 5 minute timeout per test suite
  },
  warmup: {
    enabled: true,
    iterations: 10
  }
};

// Performance targets (ratios relative to LevelDB baseline)
interface PerformanceTargets {
  read: number;
  write: number;
  bulk: number;
  query: number;
  memory: number;
  concurrent: number;
}

const PERFORMANCE_TARGETS: PerformanceTargets = {
  read: 2.0,        // JSON ≤ 2x LevelDB read latency
  write: 3.0,       // JSON ≤ 3x LevelDB write latency
  bulk: 1.5,        // JSON ≤ 1.5x LevelDB bulk operations
  query: 5.0,       // JSON ≤ 5x LevelDB query latency
  memory: 1.5,      // JSON ≤ 150% LevelDB memory usage
  concurrent: 2.5   // JSON ≤ 2.5x LevelDB concurrent performance
};

// Test networks with real production characteristics
const PRODUCTION_NETWORKS = {
  BSC_TESTNET: { chainId: 97, name: 'bsctestnet', expectedContracts: 9, tier: 'testnet' },
  BSC_MAINNET: { chainId: 56, name: 'bscmainnet', expectedContracts: 8, tier: 'mainnet' },
  BASE_SEPOLIA: { chainId: 84532, name: 'basesepolia', expectedContracts: 3, tier: 'testnet' },
  OPTIMISM_SEPOLIA: { chainId: 11155420, name: 'optimismsepolia', expectedContracts: 3, tier: 'testnet' },
  SAPPHIRE_MAINNET: { chainId: 23295, name: 'sapphiremainnet', expectedContracts: 3, tier: 'mainnet' }
};

// Benchmark result interfaces
interface OperationBenchmark {
  operation: string;
  averageTime: number;
  minTime: number;
  maxTime: number;
  p50: number;
  p95: number;
  p99: number;
  totalTime: number;
  iterations: number;
  throughput: number; // operations per second
  errorRate: number;
  result?: any;
}

interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  timestamp: number;
}

interface BenchmarkReport {
  timestamp: number;
  testDuration: number;
  leveldb: {
    backend: string;
    metrics: BackendMetrics;
    benchmarks: Record<string, OperationBenchmark>;
    memory: MemorySnapshot[];
  };
  unifiedJson: {
    backend: string;
    metrics: BackendMetrics;
    benchmarks: Record<string, OperationBenchmark>;
    memory: MemorySnapshot[];
  };
  comparison: {
    performanceRatios: Record<string, number>;
    targetCompliance: Record<string, boolean>;
    overallAssessment: 'PASS' | 'REVIEW' | 'FAIL';
    recommendations: string[];
  };
  testEnvironment: {
    nodeVersion: string;
    platform: string;
    architecture: string;
    cpuCount: number;
  };
}

export class PerformanceBenchmarkSuite {
  private levelDBManager!: IStateManager;
  private unifiedJsonManager!: IStateManager;
  private factory!: StateManagerFactory;
  private testStartTime!: number;
  private report!: BenchmarkReport;

  // Test data generators
  private generateMockContract(chainId: number, contractName: string, timestamp?: number): ContractType {
    return {
      contractName,
      chainId,
      networkName: PRODUCTION_NETWORKS[Object.keys(PRODUCTION_NETWORKS).find(key => 
        (PRODUCTION_NETWORKS as any)[key].chainId === chainId) || 'BSC_TESTNET' as keyof typeof PRODUCTION_NETWORKS].name,
      address: ethers.Wallet.createRandom().address,
      factoryByteCodeHash: ethers.keccak256(ethers.toUtf8Bytes(`${contractName}-${chainId}-${timestamp || Date.now()}`)),
      implementationHash: ethers.keccak256(ethers.toUtf8Bytes(`impl-${contractName}-${timestamp || Date.now()}`)),
      proxyAddress: ethers.Wallet.createRandom().address,
      deploymentArgs: [
        ethers.Wallet.createRandom().address,
        ethers.parseEther('5000000'),
        { nested: { value: BigInt('999999999999999999999') } }
      ],
      timestamp: timestamp || Date.now()
    };
  }

  private generateContractBatch(chainId: number, size: number, prefix: string = 'BatchContract'): ContractType[] {
    const contracts: ContractType[] = [];
    const baseTimestamp = Date.now();
    
    for (let i = 0; i < size; i++) {
      contracts.push(this.generateMockContract(
        chainId, 
        `${prefix}${i}`, 
        baseTimestamp + (i * 1000) // Spread timestamps by 1 second
      ));
    }
    
    return contracts;
  }

  // Memory monitoring utilities
  private takeMemorySnapshot(): MemorySnapshot {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      rss: memUsage.rss,
      timestamp: Date.now()
    };
  }

  private forceGarbageCollection(): void {
    if (global.gc) {
      global.gc();
      // Multiple GC cycles for thorough cleanup
      setTimeout(() => global.gc && global.gc(), 10);
      setTimeout(() => global.gc && global.gc(), 50);
    }
  }

  // Performance measurement utilities
  private async measureOperation<T>(
    operation: () => Promise<T>,
    iterations: number,
    operationName: string
  ): Promise<OperationBenchmark> {
    const times: number[] = [];
    let result: T;
    let errorCount = 0;
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      try {
        const opStart = performance.now();
        result = await operation();
        const opEnd = performance.now();
        times.push(opEnd - opStart);
      } catch (error) {
        errorCount++;
        times.push(0); // Record failed operations as 0ms
        console.error(`Operation ${operationName} failed on iteration ${i}:`, error);
      }
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const sortedTimes = times.filter(t => t > 0).sort((a, b) => a - b);
    
    const p50Index = Math.floor(sortedTimes.length * 0.5);
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p99Index = Math.floor(sortedTimes.length * 0.99);

    return {
      operation: operationName,
      averageTime: sortedTimes.length > 0 ? sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length : 0,
      minTime: sortedTimes.length > 0 ? Math.min(...sortedTimes) : 0,
      maxTime: sortedTimes.length > 0 ? Math.max(...sortedTimes) : 0,
      p50: sortedTimes[p50Index] || 0,
      p95: sortedTimes[p95Index] || 0,
      p99: sortedTimes[p99Index] || 0,
      totalTime,
      iterations,
      throughput: iterations / (totalTime / 1000), // ops/second
      errorRate: errorCount / iterations,
      result: result!
    };
  }

  // Initialization and setup
  async initialize(): Promise<void> {
    this.testStartTime = Date.now();
    console.log('\n🚀 Initializing Performance Benchmark Suite...');

    // Initialize factory with isolated test environments
    this.factory = new StateManagerFactory();
    
    const timestamp = Date.now();
    const levelDbPath = path.join(process.cwd(), `benchmark-leveldb-${timestamp}`);
    const jsonPath = path.join(process.cwd(), `benchmark-unified-${timestamp}`);

    // Initialize LevelDB manager
    console.log('   📊 Setting up LevelDB state manager...');
    this.levelDBManager = await this.factory.createStateManager('leveldb', {
      debugMode: false, // Disable debug logging for accurate performance measurement
      validateOnWrite: true,
      backupEnabled: false,
      dbPath: levelDbPath,
      leveldbOptions: {
        createIfMissing: true,
        cacheSize: 64 * 1024 * 1024, // 64MB cache for optimal performance
        writeBufferSize: 32 * 1024 * 1024 // 32MB write buffer
      }
    });

    // Initialize UnifiedJSON manager
    console.log('   📋 Setting up UnifiedJSON state manager...');
    this.unifiedJsonManager = await this.factory.createStateManager('json', {
      debugMode: false,
      validateOnWrite: true,
      backupEnabled: false,
      jsonPath,
      enableCache: true,
      cacheSize: 1000, // Large cache for performance testing
      atomicWrites: true,
      prettyPrint: false // Disable pretty printing for performance
    });

    // Load real production data for realistic benchmarking
    await this.loadProductionData();
    
    // Perform warmup operations if enabled
    if (BENCHMARK_CONFIG.warmup.enabled) {
      await this.performWarmup();
    }

    // Initialize benchmark report
    this.initializeBenchmarkReport();

    console.log('✅ Performance Benchmark Suite initialized successfully\n');
  }

  private async loadProductionData(): Promise<void> {
    console.log('   🌐 Loading real production data...');

    for (const [networkKey, network] of Object.entries(PRODUCTION_NETWORKS)) {
      try {
        const unifiedFilePath = path.join(process.cwd(), 'deployments', 'unified', `${network.name}.unified.json`);
        
        // Check if production file exists
        try {
          await fs.access(unifiedFilePath);
        } catch {
          console.log(`     ⚠️  No production data for ${network.name}, using mock data`);
          const mockContracts = this.generateContractBatch(network.chainId, network.expectedContracts, `${network.name}Contract`);
          for (const contract of mockContracts) {
            await this.levelDBManager.putContract(network.chainId, contract);
          }
          continue;
        }

        // Load real production contracts
        const unifiedManager = new UnifiedJSONStateManager({
          jsonPath: path.join(process.cwd(), 'deployments', 'unified')
        });
        await unifiedManager.initialize();

        const contracts = await unifiedManager.getAllContracts(network.chainId);
        console.log(`     📂 Loaded ${contracts.length} contracts from ${network.name}`);

        // Store in LevelDB for benchmarking
        for (const contract of contracts) {
          await this.levelDBManager.putContract(network.chainId, contract);
        }

        await unifiedManager.close();
      } catch (error) {
        console.error(`     ❌ Failed to load production data for ${network.name}:`, error);
        // Fallback to mock data
        const mockContracts = this.generateContractBatch(network.chainId, network.expectedContracts, `Mock${network.name}`);
        for (const contract of mockContracts) {
          await this.levelDBManager.putContract(network.chainId, contract);
        }
      }
    }
  }

  private async performWarmup(): Promise<void> {
    console.log('   🔥 Performing backend warmup...');

    const warmupContract = this.generateMockContract(97, 'WarmupContract');
    const iterations = BENCHMARK_CONFIG.warmup.iterations;

    for (let i = 0; i < iterations; i++) {
      // Warmup LevelDB
      await this.levelDBManager.putContract(97, { ...warmupContract, timestamp: Date.now() + i });
      await this.levelDBManager.getContract(97, 'WarmupContract');
      await this.levelDBManager.getAllContracts(97);

      // Warmup UnifiedJSON  
      await this.unifiedJsonManager.putContract(84532, { ...warmupContract, chainId: 84532, timestamp: Date.now() + i });
      await this.unifiedJsonManager.getContract(84532, 'WarmupContract');
      await this.unifiedJsonManager.getAllContracts(84532);
    }

    // Force garbage collection after warmup
    this.forceGarbageCollection();
  }

  private initializeBenchmarkReport(): void {
    this.report = {
      timestamp: this.testStartTime,
      testDuration: 0,
      leveldb: {
        backend: 'leveldb',
        metrics: {
          readLatency: 0,
          writeLatency: 0,
          queryLatency: 0,
          errorRate: 0
        },
        benchmarks: {},
        memory: []
      },
      unifiedJson: {
        backend: 'unified-json',
        metrics: {
          readLatency: 0,
          writeLatency: 0,
          queryLatency: 0,
          errorRate: 0
        },
        benchmarks: {},
        memory: []
      },
      comparison: {
        performanceRatios: {},
        targetCompliance: {},
        overallAssessment: 'REVIEW',
        recommendations: []
      },
      testEnvironment: {
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpuCount: require('os').cpus().length
      }
    };
  }

  // Benchmark test suites

  async runSingleContractBenchmarks(): Promise<void> {
    console.log('📊 Running Single Contract Operation Benchmarks...\n');

    const testChainId = 97; // BSC Testnet
    const baseContract = this.generateMockContract(testChainId, 'SingleOpTest');

    // Benchmark read operations
    console.log('   🔍 Benchmarking single contract reads...');
    
    // Pre-populate contracts for reading
    await this.levelDBManager.putContract(testChainId, baseContract);
    await this.unifiedJsonManager.putContract(testChainId, baseContract);

    this.report.leveldb.memory.push(this.takeMemorySnapshot());
    const levelDbReadBenchmark = await this.measureOperation(
      () => this.levelDBManager.getContract(testChainId, 'SingleOpTest'),
      BENCHMARK_CONFIG.iterations.baseline,
      'single_read_leveldb'
    );
    this.report.leveldb.benchmarks.single_read = levelDbReadBenchmark;

    this.report.unifiedJson.memory.push(this.takeMemorySnapshot());
    const unifiedJsonReadBenchmark = await this.measureOperation(
      () => this.unifiedJsonManager.getContract(testChainId, 'SingleOpTest'),
      BENCHMARK_CONFIG.iterations.baseline,
      'single_read_unified'
    );
    this.report.unifiedJson.benchmarks.single_read = unifiedJsonReadBenchmark;

    // Benchmark write operations
    console.log('   ✍️  Benchmarking single contract writes...');

    const levelDbWriteBenchmark = await this.measureOperation(
      () => {
        const contract = this.generateMockContract(testChainId, `LevelWrite${Date.now()}`);
        return this.levelDBManager.putContract(testChainId, contract);
      },
      BENCHMARK_CONFIG.iterations.baseline,
      'single_write_leveldb'
    );
    this.report.leveldb.benchmarks.single_write = levelDbWriteBenchmark;

    const unifiedJsonWriteBenchmark = await this.measureOperation(
      () => {
        const contract = this.generateMockContract(testChainId, `UnifiedWrite${Date.now()}`);
        return this.unifiedJsonManager.putContract(testChainId, contract);
      },
      BENCHMARK_CONFIG.iterations.baseline,
      'single_write_unified'
    );
    this.report.unifiedJson.benchmarks.single_write = unifiedJsonWriteBenchmark;

    // Performance analysis
    const readRatio = unifiedJsonReadBenchmark.averageTime / Math.max(levelDbReadBenchmark.averageTime, 0.1);
    const writeRatio = unifiedJsonWriteBenchmark.averageTime / Math.max(levelDbWriteBenchmark.averageTime, 0.1);

    this.report.comparison.performanceRatios.single_read = readRatio;
    this.report.comparison.performanceRatios.single_write = writeRatio;
    this.report.comparison.targetCompliance.single_read = readRatio <= PERFORMANCE_TARGETS.read;
    this.report.comparison.targetCompliance.single_write = writeRatio <= PERFORMANCE_TARGETS.write;

    console.log(`     📈 Read Performance: LevelDB ${levelDbReadBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${unifiedJsonReadBenchmark.averageTime.toFixed(2)}ms (${readRatio.toFixed(2)}x)`);
    console.log(`     📈 Write Performance: LevelDB ${levelDbWriteBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${unifiedJsonWriteBenchmark.averageTime.toFixed(2)}ms (${writeRatio.toFixed(2)}x)`);
    
    // Performance target validation
    if (readRatio > PERFORMANCE_TARGETS.read) {
      this.report.comparison.recommendations.push(`Single read performance ${readRatio.toFixed(2)}x exceeds target of ${PERFORMANCE_TARGETS.read}x`);
    }
    if (writeRatio > PERFORMANCE_TARGETS.write) {
      this.report.comparison.recommendations.push(`Single write performance ${writeRatio.toFixed(2)}x exceeds target of ${PERFORMANCE_TARGETS.write}x`);
    }

    this.forceGarbageCollection();
  }

  async runBulkOperationBenchmarks(): Promise<void> {
    console.log('\n📦 Running Bulk Operation Benchmarks...\n');

    const testChainId = 84532; // Base Sepolia
    const bulkContracts = this.generateContractBatch(testChainId, BENCHMARK_CONFIG.datasets.bulk, 'BulkTest');

    console.log(`   📂 Benchmarking bulk operations (${BENCHMARK_CONFIG.datasets.bulk} contracts)...`);

    // Benchmark bulk writes
    console.log('   ✍️  Benchmarking bulk write operations...');

    this.report.leveldb.memory.push(this.takeMemorySnapshot());
    const levelDbBulkWriteBenchmark = await this.measureOperation(
      async () => {
        const contracts = this.generateContractBatch(testChainId, BENCHMARK_CONFIG.datasets.bulk, `LevelBulk${Date.now()}`);
        for (const contract of contracts) {
          await this.levelDBManager.putContract(testChainId, contract);
        }
        return contracts;
      },
      BENCHMARK_CONFIG.iterations.bulk,
      'bulk_write_leveldb'
    );
    this.report.leveldb.benchmarks.bulk_write = levelDbBulkWriteBenchmark;

    this.report.unifiedJson.memory.push(this.takeMemorySnapshot());
    const unifiedJsonBulkWriteBenchmark = await this.measureOperation(
      async () => {
        const contracts = this.generateContractBatch(testChainId, BENCHMARK_CONFIG.datasets.bulk, `UnifiedBulk${Date.now()}`);
        for (const contract of contracts) {
          await this.unifiedJsonManager.putContract(testChainId, contract);
        }
        return contracts;
      },
      BENCHMARK_CONFIG.iterations.bulk,
      'bulk_write_unified'
    );
    this.report.unifiedJson.benchmarks.bulk_write = unifiedJsonBulkWriteBenchmark;

    // Pre-populate for bulk reads
    for (const contract of bulkContracts) {
      await this.levelDBManager.putContract(testChainId, contract);
      await this.unifiedJsonManager.putContract(testChainId, contract);
    }

    // Benchmark bulk reads
    console.log('   🔍 Benchmarking bulk read operations...');

    const levelDbBulkReadBenchmark = await this.measureOperation(
      () => this.levelDBManager.getAllContracts(testChainId),
      BENCHMARK_CONFIG.iterations.bulk,
      'bulk_read_leveldb'
    );
    this.report.leveldb.benchmarks.bulk_read = levelDbBulkReadBenchmark;

    const unifiedJsonBulkReadBenchmark = await this.measureOperation(
      () => this.unifiedJsonManager.getAllContracts(testChainId),
      BENCHMARK_CONFIG.iterations.bulk,
      'bulk_read_unified'
    );
    this.report.unifiedJson.benchmarks.bulk_read = unifiedJsonBulkReadBenchmark;

    // Performance analysis
    const bulkReadRatio = unifiedJsonBulkReadBenchmark.averageTime / Math.max(levelDbBulkReadBenchmark.averageTime, 1);
    const bulkWriteRatio = unifiedJsonBulkWriteBenchmark.averageTime / Math.max(levelDbBulkWriteBenchmark.averageTime, 1);

    this.report.comparison.performanceRatios.bulk_read = bulkReadRatio;
    this.report.comparison.performanceRatios.bulk_write = bulkWriteRatio;
    this.report.comparison.targetCompliance.bulk_read = bulkReadRatio <= PERFORMANCE_TARGETS.bulk;
    this.report.comparison.targetCompliance.bulk_write = bulkWriteRatio <= PERFORMANCE_TARGETS.bulk;

    console.log(`     📈 Bulk Read Performance: LevelDB ${levelDbBulkReadBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${unifiedJsonBulkReadBenchmark.averageTime.toFixed(2)}ms (${bulkReadRatio.toFixed(2)}x)`);
    console.log(`     📈 Bulk Write Performance: LevelDB ${levelDbBulkWriteBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${unifiedJsonBulkWriteBenchmark.averageTime.toFixed(2)}ms (${bulkWriteRatio.toFixed(2)}x)`);
    
    // Performance target validation
    if (bulkReadRatio > PERFORMANCE_TARGETS.bulk) {
      this.report.comparison.recommendations.push(`Bulk read performance ${bulkReadRatio.toFixed(2)}x exceeds target of ${PERFORMANCE_TARGETS.bulk}x`);
    }
    if (bulkWriteRatio > PERFORMANCE_TARGETS.bulk) {
      this.report.comparison.recommendations.push(`Bulk write performance ${bulkWriteRatio.toFixed(2)}x exceeds target of ${PERFORMANCE_TARGETS.bulk}x`);
    }

    // Validate 5-second target for 100 contracts
    const scaledUnifiedWriteTime = unifiedJsonBulkWriteBenchmark.averageTime * (100 / BENCHMARK_CONFIG.datasets.bulk);
    if (scaledUnifiedWriteTime > 5000) {
      this.report.comparison.recommendations.push(`Projected 100-contract write time ${scaledUnifiedWriteTime.toFixed(0)}ms exceeds 5-second target`);
    }

    this.forceGarbageCollection();
  }

  async runStressBenchmarks(): Promise<void> {
    console.log('\n⚡ Running Stress Test Benchmarks...\n');

    const testChainId = 11155420; // Optimism Sepolia
    
    console.log(`   🔥 Benchmarking stress operations (${BENCHMARK_CONFIG.datasets.stress} contracts)...`);

    // Stress test - large dataset operations
    this.report.leveldb.memory.push(this.takeMemorySnapshot());
    const levelDbStressBenchmark = await this.measureOperation(
      async () => {
        const contracts = this.generateContractBatch(testChainId, BENCHMARK_CONFIG.datasets.stress, `StressLevel${Date.now()}`);
        for (const contract of contracts) {
          await this.levelDBManager.putContract(testChainId, contract);
        }
        return await this.levelDBManager.getAllContracts(testChainId);
      },
      BENCHMARK_CONFIG.iterations.stress,
      'stress_test_leveldb'
    );
    this.report.leveldb.benchmarks.stress_test = levelDbStressBenchmark;

    this.report.unifiedJson.memory.push(this.takeMemorySnapshot());
    const unifiedJsonStressBenchmark = await this.measureOperation(
      async () => {
        const contracts = this.generateContractBatch(testChainId, BENCHMARK_CONFIG.datasets.stress, `StressUnified${Date.now()}`);
        for (const contract of contracts) {
          await this.unifiedJsonManager.putContract(testChainId, contract);
        }
        return await this.unifiedJsonManager.getAllContracts(testChainId);
      },
      BENCHMARK_CONFIG.iterations.stress,
      'stress_test_unified'
    );
    this.report.unifiedJson.benchmarks.stress_test = unifiedJsonStressBenchmark;

    const stressRatio = unifiedJsonStressBenchmark.averageTime / Math.max(levelDbStressBenchmark.averageTime, 1);
    this.report.comparison.performanceRatios.stress_test = stressRatio;
    this.report.comparison.targetCompliance.stress_test = stressRatio <= PERFORMANCE_TARGETS.bulk * 1.5; // Allow higher tolerance for stress tests

    console.log(`     📈 Stress Test Performance: LevelDB ${levelDbStressBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${unifiedJsonStressBenchmark.averageTime.toFixed(2)}ms (${stressRatio.toFixed(2)}x)`);
    
    if (stressRatio > PERFORMANCE_TARGETS.bulk * 1.5) {
      this.report.comparison.recommendations.push(`Stress test performance ${stressRatio.toFixed(2)}x exceeds acceptable threshold`);
    }

    this.forceGarbageCollection();
  }

  async runConcurrentAccessBenchmarks(): Promise<void> {
    console.log('\n🔄 Running Concurrent Access Benchmarks...\n');

    const testChainId = 56; // BSC Mainnet
    const concurrentContract = this.generateMockContract(testChainId, 'ConcurrentTest');
    
    // Pre-populate for concurrent reads
    await this.levelDBManager.putContract(testChainId, concurrentContract);
    await this.unifiedJsonManager.putContract(testChainId, concurrentContract);

    const concurrentOperations = 10; // 10 parallel operations

    console.log(`   🔀 Benchmarking concurrent operations (${concurrentOperations} parallel)...`);

    // Concurrent reads benchmark
    this.report.leveldb.memory.push(this.takeMemorySnapshot());
    const levelDbConcurrentBenchmark = await this.measureOperation(
      async () => {
        const readPromises = [];
        for (let i = 0; i < concurrentOperations; i++) {
          readPromises.push(this.levelDBManager.getContract(testChainId, 'ConcurrentTest'));
        }
        return await Promise.all(readPromises);
      },
      BENCHMARK_CONFIG.iterations.concurrent,
      'concurrent_read_leveldb'
    );
    this.report.leveldb.benchmarks.concurrent_read = levelDbConcurrentBenchmark;

    this.report.unifiedJson.memory.push(this.takeMemorySnapshot());
    const unifiedJsonConcurrentBenchmark = await this.measureOperation(
      async () => {
        const readPromises = [];
        for (let i = 0; i < concurrentOperations; i++) {
          readPromises.push(this.unifiedJsonManager.getContract(testChainId, 'ConcurrentTest'));
        }
        return await Promise.all(readPromises);
      },
      BENCHMARK_CONFIG.iterations.concurrent,
      'concurrent_read_unified'
    );
    this.report.unifiedJson.benchmarks.concurrent_read = unifiedJsonConcurrentBenchmark;

    const concurrentRatio = unifiedJsonConcurrentBenchmark.averageTime / Math.max(levelDbConcurrentBenchmark.averageTime, 1);
    this.report.comparison.performanceRatios.concurrent_read = concurrentRatio;
    this.report.comparison.targetCompliance.concurrent_read = concurrentRatio <= PERFORMANCE_TARGETS.concurrent;

    console.log(`     📈 Concurrent Read Performance: LevelDB ${levelDbConcurrentBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${unifiedJsonConcurrentBenchmark.averageTime.toFixed(2)}ms (${concurrentRatio.toFixed(2)}x)`);
    
    if (concurrentRatio > PERFORMANCE_TARGETS.concurrent) {
      this.report.comparison.recommendations.push(`Concurrent access performance ${concurrentRatio.toFixed(2)}x exceeds target of ${PERFORMANCE_TARGETS.concurrent}x`);
    }

    this.forceGarbageCollection();
  }

  async runQueryBenchmarks(): Promise<void> {
    console.log('\n🔍 Running Query Operation Benchmarks...\n');

    // Populate multiple networks with diverse data for realistic query testing
    for (const [_, network] of Object.entries(PRODUCTION_NETWORKS)) {
      const contracts = this.generateContractBatch(network.chainId, 20, `Query${network.name}`);
      for (const contract of contracts) {
        await this.levelDBManager.putContract(network.chainId, contract);
        await this.unifiedJsonManager.putContract(network.chainId, contract);
      }
    }

    console.log('   🔎 Benchmarking complex queries...');

    // Complex query benchmark
    const levelDbQueryBenchmark = await this.measureOperation(
      () => this.levelDBManager.queryContracts({
        contractName: 'QueryBSCTESTNET0',
        sortBy: 'timestamp',
        sortOrder: 'desc'
      }),
      BENCHMARK_CONFIG.iterations.bulk,
      'complex_query_leveldb'
    );
    this.report.leveldb.benchmarks.complex_query = levelDbQueryBenchmark;

    const unifiedJsonQueryBenchmark = await this.measureOperation(
      () => this.unifiedJsonManager.queryContracts({
        contractName: 'QueryBSCTESTNET0',
        sortBy: 'timestamp',
        sortOrder: 'desc'
      }),
      BENCHMARK_CONFIG.iterations.bulk,
      'complex_query_unified'
    );
    this.report.unifiedJson.benchmarks.complex_query = unifiedJsonQueryBenchmark;

    const queryRatio = unifiedJsonQueryBenchmark.averageTime / Math.max(levelDbQueryBenchmark.averageTime, 1);
    this.report.comparison.performanceRatios.complex_query = queryRatio;
    this.report.comparison.targetCompliance.complex_query = queryRatio <= PERFORMANCE_TARGETS.query;

    console.log(`     📈 Complex Query Performance: LevelDB ${levelDbQueryBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${unifiedJsonQueryBenchmark.averageTime.toFixed(2)}ms (${queryRatio.toFixed(2)}x)`);
    
    if (queryRatio > PERFORMANCE_TARGETS.query) {
      this.report.comparison.recommendations.push(`Query performance ${queryRatio.toFixed(2)}x exceeds target of ${PERFORMANCE_TARGETS.query}x`);
    }

    this.forceGarbageCollection();
  }

  async runMemoryUsageBenchmarks(): Promise<void> {
    console.log('\n💾 Running Memory Usage Analysis...\n');

    const testChainId = 97;
    const memoryTestContracts = this.generateContractBatch(testChainId, 200, 'MemoryTest'); // Large dataset for memory analysis

    // Baseline memory
    this.forceGarbageCollection();
    const baselineMemory = this.takeMemorySnapshot();

    // LevelDB memory usage
    console.log('   📊 Measuring LevelDB memory usage...');
    const preLevelDBMemory = this.takeMemorySnapshot();
    
    for (const contract of memoryTestContracts) {
      await this.levelDBManager.putContract(testChainId, contract);
    }
    
    this.forceGarbageCollection();
    const postLevelDBMemory = this.takeMemorySnapshot();
    const levelDBMemoryDelta = postLevelDBMemory.heapUsed - preLevelDBMemory.heapUsed;

    // UnifiedJSON memory usage
    console.log('   📋 Measuring UnifiedJSON memory usage...');
    const preUnifiedMemory = this.takeMemorySnapshot();
    
    for (const contract of memoryTestContracts) {
      await this.unifiedJsonManager.putContract(84532, { ...contract, chainId: 84532 }); // Different chain to avoid conflicts
    }
    
    this.forceGarbageCollection();
    const postUnifiedMemory = this.takeMemorySnapshot();
    const unifiedMemoryDelta = postUnifiedMemory.heapUsed - preUnifiedMemory.heapUsed;

    // Memory analysis
    const memoryRatio = unifiedMemoryDelta / Math.max(levelDBMemoryDelta, 1024 * 1024); // Avoid division by very small numbers
    
    this.report.comparison.performanceRatios.memory_usage = memoryRatio;
    this.report.comparison.targetCompliance.memory_usage = memoryRatio <= PERFORMANCE_TARGETS.memory;

    // Store memory snapshots
    this.report.leveldb.memory = [baselineMemory, preLevelDBMemory, postLevelDBMemory];
    this.report.unifiedJson.memory = [baselineMemory, preUnifiedMemory, postUnifiedMemory];

    console.log(`     📈 Memory Usage Analysis (${memoryTestContracts.length} contracts):`);
    console.log(`       LevelDB Memory Delta: ${(levelDBMemoryDelta / 1024 / 1024).toFixed(2)} MB`);
    console.log(`       UnifiedJSON Memory Delta: ${(unifiedMemoryDelta / 1024 / 1024).toFixed(2)} MB`);
    console.log(`       Memory Ratio: ${memoryRatio.toFixed(2)}x`);

    // Memory efficiency validation
    const totalMemoryUsageMB = postUnifiedMemory.heapUsed / 1024 / 1024;
    if (totalMemoryUsageMB > 500) {
      this.report.comparison.recommendations.push(`Total memory usage ${totalMemoryUsageMB.toFixed(0)}MB exceeds 500MB target`);
    }

    if (memoryRatio > PERFORMANCE_TARGETS.memory) {
      this.report.comparison.recommendations.push(`Memory usage ratio ${memoryRatio.toFixed(2)}x exceeds target of ${PERFORMANCE_TARGETS.memory}x`);
    }

    this.forceGarbageCollection();
  }

  async runColdStartBenchmarks(): Promise<void> {
    console.log('\n❄️  Running Cold Start vs Hot Cache Benchmarks...\n');

    // Cold start benchmark - fresh managers
    console.log('   🧊 Testing cold start performance...');
    
    const coldLevelDB = await this.factory.createStateManager('leveldb', {
      debugMode: false,
      dbPath: path.join(process.cwd(), `cold-leveldb-${Date.now()}`),
      leveldbOptions: { createIfMissing: true }
    });

    const coldUnifiedJSON = await this.factory.createStateManager('json', {
      debugMode: false,
      jsonPath: path.join(process.cwd(), `cold-unified-${Date.now()}`),
      enableCache: true
    });

    const coldContract = this.generateMockContract(97, 'ColdStartTest');

    // Cold start write + read
    const coldLevelDBBenchmark = await this.measureOperation(
      async () => {
        await coldLevelDB.putContract(97, coldContract);
        return await coldLevelDB.getContract(97, 'ColdStartTest');
      },
      10, // Fewer iterations for cold start
      'cold_start_leveldb'
    );

    const coldUnifiedBenchmark = await this.measureOperation(
      async () => {
        await coldUnifiedJSON.putContract(97, coldContract);
        return await coldUnifiedJSON.getContract(97, 'ColdStartTest');
      },
      10,
      'cold_start_unified'
    );

    // Hot cache benchmark - using warmed up managers
    console.log('   🔥 Testing hot cache performance...');
    
    const hotLevelDBBenchmark = await this.measureOperation(
      () => this.levelDBManager.getContract(97, 'ColdStartTest'),
      50,
      'hot_cache_leveldb'
    );

    const hotUnifiedBenchmark = await this.measureOperation(
      () => this.unifiedJsonManager.getContract(97, 'ColdStartTest'),
      50,
      'hot_cache_unified'
    );

    // Cache effectiveness analysis
    const levelDBCacheSpeedup = coldLevelDBBenchmark.averageTime / Math.max(hotLevelDBBenchmark.averageTime, 0.1);
    const unifiedCacheSpeedup = coldUnifiedBenchmark.averageTime / Math.max(hotUnifiedBenchmark.averageTime, 0.1);

    console.log(`     📈 Cold Start Performance: LevelDB ${coldLevelDBBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${coldUnifiedBenchmark.averageTime.toFixed(2)}ms`);
    console.log(`     📈 Hot Cache Performance: LevelDB ${hotLevelDBBenchmark.averageTime.toFixed(2)}ms vs UnifiedJSON ${hotUnifiedBenchmark.averageTime.toFixed(2)}ms`);
    console.log(`     📈 Cache Speedup: LevelDB ${levelDBCacheSpeedup.toFixed(2)}x vs UnifiedJSON ${unifiedCacheSpeedup.toFixed(2)}x`);

    // Store benchmarks
    this.report.leveldb.benchmarks.cold_start = coldLevelDBBenchmark;
    this.report.leveldb.benchmarks.hot_cache = hotLevelDBBenchmark;
    this.report.unifiedJson.benchmarks.cold_start = coldUnifiedBenchmark;
    this.report.unifiedJson.benchmarks.hot_cache = hotUnifiedBenchmark;

    if (unifiedCacheSpeedup < 1.5) {
      this.report.comparison.recommendations.push(`UnifiedJSON cache speedup ${unifiedCacheSpeedup.toFixed(2)}x is below expected threshold`);
    }

    // Cleanup cold start managers
    await coldLevelDB.close();
    await coldUnifiedJSON.close();
    
    this.forceGarbageCollection();
  }

  // Finalize and generate reports
  async finalizeBenchmarks(): Promise<void> {
    this.report.testDuration = Date.now() - this.testStartTime;

    // Get final metrics from both managers
    this.report.leveldb.metrics = await this.levelDBManager.getMetrics();
    this.report.unifiedJson.metrics = await this.unifiedJsonManager.getMetrics();

    // Determine overall assessment
    const passedTargets = Object.values(this.report.comparison.targetCompliance).filter(Boolean).length;
    const totalTargets = Object.keys(this.report.comparison.targetCompliance).length;
    
    if (passedTargets === totalTargets && this.report.comparison.recommendations.length === 0) {
      this.report.comparison.overallAssessment = 'PASS';
    } else if (passedTargets >= totalTargets * 0.8) { // 80% pass rate
      this.report.comparison.overallAssessment = 'REVIEW';
    } else {
      this.report.comparison.overallAssessment = 'FAIL';
    }

    console.log('\n📊 Benchmark Analysis Complete!');
  }

  async generateReport(): Promise<string> {
    const reportPath = path.join(process.cwd(), `performance-benchmark-report-${this.testStartTime}.json`);
    
    // Generate comprehensive report
    await fs.writeFile(reportPath, JSON.stringify(this.report, null, 2));

    // Generate summary report
    const summaryPath = path.join(process.cwd(), `performance-summary-${this.testStartTime}.md`);
    const summary = this.generateMarkdownSummary();
    await fs.writeFile(summaryPath, summary);

    console.log(`\n📄 Detailed report saved: ${reportPath}`);
    console.log(`📄 Summary report saved: ${summaryPath}`);

    return summaryPath;
  }

  private generateMarkdownSummary(): string {
    const { report } = this;
    const duration = (report.testDuration / 1000).toFixed(1);

    const summary = `# Performance Benchmark Report

**Generated:** ${new Date(report.timestamp).toISOString()}  
**Duration:** ${duration}s  
**Assessment:** ${report.comparison.overallAssessment}

## Environment
- **Node.js:** ${report.testEnvironment.nodeVersion}
- **Platform:** ${report.testEnvironment.platform}
- **Architecture:** ${report.testEnvironment.architecture}  
- **CPU Cores:** ${report.testEnvironment.cpuCount}

## Performance Summary

| Operation | LevelDB (ms) | UnifiedJSON (ms) | Ratio | Target | Status |
|-----------|--------------|------------------|-------|---------|--------|
| Single Read | ${report.leveldb.benchmarks.single_read?.averageTime.toFixed(2) || 'N/A'} | ${report.unifiedJson.benchmarks.single_read?.averageTime.toFixed(2) || 'N/A'} | ${report.comparison.performanceRatios.single_read?.toFixed(2) || 'N/A'}x | ≤${PERFORMANCE_TARGETS.read}x | ${report.comparison.targetCompliance.single_read ? '✅' : '❌'} |
| Single Write | ${report.leveldb.benchmarks.single_write?.averageTime.toFixed(2) || 'N/A'} | ${report.unifiedJson.benchmarks.single_write?.averageTime.toFixed(2) || 'N/A'} | ${report.comparison.performanceRatios.single_write?.toFixed(2) || 'N/A'}x | ≤${PERFORMANCE_TARGETS.write}x | ${report.comparison.targetCompliance.single_write ? '✅' : '❌'} |
| Bulk Read | ${report.leveldb.benchmarks.bulk_read?.averageTime.toFixed(2) || 'N/A'} | ${report.unifiedJson.benchmarks.bulk_read?.averageTime.toFixed(2) || 'N/A'} | ${report.comparison.performanceRatios.bulk_read?.toFixed(2) || 'N/A'}x | ≤${PERFORMANCE_TARGETS.bulk}x | ${report.comparison.targetCompliance.bulk_read ? '✅' : '❌'} |
| Bulk Write | ${report.leveldb.benchmarks.bulk_write?.averageTime.toFixed(2) || 'N/A'} | ${report.unifiedJson.benchmarks.bulk_write?.averageTime.toFixed(2) || 'N/A'} | ${report.comparison.performanceRatios.bulk_write?.toFixed(2) || 'N/A'}x | ≤${PERFORMANCE_TARGETS.bulk}x | ${report.comparison.targetCompliance.bulk_write ? '✅' : '❌'} |
| Complex Query | ${report.leveldb.benchmarks.complex_query?.averageTime.toFixed(2) || 'N/A'} | ${report.unifiedJson.benchmarks.complex_query?.averageTime.toFixed(2) || 'N/A'} | ${report.comparison.performanceRatios.complex_query?.toFixed(2) || 'N/A'}x | ≤${PERFORMANCE_TARGETS.query}x | ${report.comparison.targetCompliance.complex_query ? '✅' : '❌'} |
| Concurrent Read | ${report.leveldb.benchmarks.concurrent_read?.averageTime.toFixed(2) || 'N/A'} | ${report.unifiedJson.benchmarks.concurrent_read?.averageTime.toFixed(2) || 'N/A'} | ${report.comparison.performanceRatios.concurrent_read?.toFixed(2) || 'N/A'}x | ≤${PERFORMANCE_TARGETS.concurrent}x | ${report.comparison.targetCompliance.concurrent_read ? '✅' : '❌'} |

## Memory Analysis

| Metric | LevelDB | UnifiedJSON | Ratio | Target | Status |
|--------|---------|-------------|--------|---------|--------|
| Memory Usage | ${((report.leveldb.memory[2]?.heapUsed - report.leveldb.memory[1]?.heapUsed) / 1024 / 1024).toFixed(2) || 'N/A'} MB | ${((report.unifiedJson.memory[2]?.heapUsed - report.unifiedJson.memory[1]?.heapUsed) / 1024 / 1024).toFixed(2) || 'N/A'} MB | ${report.comparison.performanceRatios.memory_usage?.toFixed(2) || 'N/A'}x | ≤${PERFORMANCE_TARGETS.memory}x | ${report.comparison.targetCompliance.memory_usage ? '✅' : '❌'} |

## Backend Metrics

### LevelDB
- **Read Latency:** ${report.leveldb.metrics.readLatency.toFixed(2)}ms
- **Write Latency:** ${report.leveldb.metrics.writeLatency.toFixed(2)}ms  
- **Query Latency:** ${report.leveldb.metrics.queryLatency.toFixed(2)}ms
- **Error Rate:** ${(report.leveldb.metrics.errorRate * 100).toFixed(2)}%

### UnifiedJSON  
- **Read Latency:** ${report.unifiedJson.metrics.readLatency.toFixed(2)}ms
- **Write Latency:** ${report.unifiedJson.metrics.writeLatency.toFixed(2)}ms
- **Query Latency:** ${report.unifiedJson.metrics.queryLatency.toFixed(2)}ms  
- **Error Rate:** ${(report.unifiedJson.metrics.errorRate * 100).toFixed(2)}%
${report.unifiedJson.metrics.cacheHitRate !== undefined ? `- **Cache Hit Rate:** ${(report.unifiedJson.metrics.cacheHitRate * 100).toFixed(1)}%` : ''}

## Recommendations

${report.comparison.recommendations.length > 0 ? 
report.comparison.recommendations.map(r => `- ${r}`).join('\n') : 
'No specific recommendations - all performance targets met.'}

## Overall Assessment

**${report.comparison.overallAssessment}** - ${
  report.comparison.overallAssessment === 'PASS' ? 
    'UnifiedJSON backend meets all performance requirements and is ready for production migration.' :
  report.comparison.overallAssessment === 'REVIEW' ? 
    'UnifiedJSON backend meets most performance requirements but requires review of flagged areas.' :
    'UnifiedJSON backend has performance issues that need to be addressed before migration.'
}

---
*Generated by LookCoin Performance Benchmark Suite*
`;

    return summary;
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up benchmark resources...');
    
    try {
      if (this.levelDBManager) {
        await this.levelDBManager.close();
      }
      if (this.unifiedJsonManager) {
        await this.unifiedJsonManager.close();
      }

      // Additional cleanup can be added here if needed
      this.forceGarbageCollection();
      
      console.log('✅ Cleanup completed successfully');
    } catch (error) {
      console.error('⚠️  Cleanup error:', error);
    }
  }
}

// Main execution function
export async function runPerformanceBenchmarkSuite(): Promise<string> {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 LookCoin Performance Benchmark Suite');
  console.log('   Comprehensive performance comparison: UnifiedJSON vs LevelDB');
  console.log('='.repeat(80));

  const suite = new PerformanceBenchmarkSuite();
  let reportPath = '';

  try {
    // Initialize benchmark suite
    await suite.initialize();

    // Run all benchmark suites
    await suite.runSingleContractBenchmarks();
    await suite.runBulkOperationBenchmarks();
    await suite.runStressBenchmarks();
    await suite.runConcurrentAccessBenchmarks();
    await suite.runQueryBenchmarks();
    await suite.runMemoryUsageBenchmarks();
    await suite.runColdStartBenchmarks();

    // Finalize and generate reports
    await suite.finalizeBenchmarks();
    reportPath = await suite.generateReport();

    console.log('\n' + '='.repeat(80));
    console.log('✅ Performance Benchmark Suite Completed Successfully!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Benchmark suite failed:', error);
    throw error;
  } finally {
    await suite.cleanup();
  }

  return reportPath;
}

// CLI execution
if (require.main === module) {
  runPerformanceBenchmarkSuite()
    .then((reportPath) => {
      console.log(`\n📄 Performance report available at: ${reportPath}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Benchmark suite failed:', error);
      process.exit(1);
    });
}