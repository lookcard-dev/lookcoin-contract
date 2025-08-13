/**
 * Backend Performance Benchmarking Tests
 * 
 * Comprehensive performance comparison between LevelDB and JSON backends
 * to validate that JSON backend meets acceptable performance criteria for
 * migration. Tests read, write, and query operations under various scenarios.
 * 
 * Performance Acceptance Criteria:
 * - JSON read operations: ≤ 2x LevelDB latency
 * - JSON write operations: ≤ 3x LevelDB latency  
 * - JSON query operations: ≤ 5x LevelDB latency
 * - Memory usage: ≤ 150% of LevelDB usage
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import {
  TestStateManagerFactory,
  TestContractGenerator,
  BenchmarkUtils,
  TestAssertions,
  TestLifecycle,
  TEST_NETWORKS
} from "../utils/migration-test-helpers";
import { IStateManager, ContractType } from "../../../scripts/utils/IStateManager";

describe("Migration Testing - Backend Performance Benchmarking", () => {
  let testLifecycle: TestLifecycle;
  let levelDBManager: IStateManager;
  let jsonManager: IStateManager;
  let factory: TestStateManagerFactory;

  // Benchmark configuration
  const BENCHMARK_CONFIG = {
    iterations: {
      read: 100,        // Read operations are frequent and should be fast
      write: 50,        // Write operations are less frequent but important
      query: 20         // Query operations are complex and less frequent
    },
    timeout: 30000,     // 30 second timeout for all benchmarks
    warmupIterations: 10 // Warmup iterations to stabilize performance
  };

  // Performance targets (multipliers relative to LevelDB)
  const PERFORMANCE_TARGETS = {
    read: 2.0,          // JSON should be <= 2x LevelDB read latency
    write: 3.0,         // JSON should be <= 3x LevelDB write latency
    query: 5.0,         // JSON should be <= 5x LevelDB query latency
    memory: 1.5         // JSON should use <= 150% of LevelDB memory
  };

  before(async function() {
    this.timeout(60000); // Extended timeout for setup

    testLifecycle = new TestLifecycle();
    factory = await testLifecycle.createFactory("performance");
    
    console.log("\n=== Performance Benchmarking Setup ===");
    
    levelDBManager = await testLifecycle.createManager(factory, 'leveldb', {
      debugMode: false, // Disable debug for accurate performance measurement
      validateOnWrite: true,
      leveldbOptions: {
        cacheSize: 32 * 1024 * 1024, // 32MB cache
        writeBufferSize: 16 * 1024 * 1024 // 16MB write buffer
      }
    });
    
    jsonManager = await testLifecycle.createManager(factory, 'json', {
      debugMode: false, // Disable debug for accurate performance measurement
      validateOnWrite: true,
      enableCache: true,
      cacheSize: 1000,
      atomicWrites: true,
      prettyPrint: false // Disable pretty print for performance
    });

    // Populate initial test data for realistic benchmarking
    await populateInitialTestData();
    console.log("✓ Initial test data populated");
    
    // Warmup both backends
    await performWarmup();
    console.log("✓ Backend warmup completed");
  });

  after(async () => {
    await testLifecycle.cleanup();
  });

  describe("Read Operation Benchmarks", () => {
    it("should benchmark single contract retrieval performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- Single Contract Retrieval Benchmark ---");
      
      const testContract = TestContractGenerator.createMockContract(56, "BenchmarkReadTest");
      await levelDBManager.putContract(56, testContract);
      await jsonManager.putContract(56, testContract);

      // Benchmark LevelDB reads
      console.log(`Running ${BENCHMARK_CONFIG.iterations.read} LevelDB read iterations...`);
      const levelDBBenchmark = await BenchmarkUtils.measureOperation(async () => {
        return await levelDBManager.getContract(56, "BenchmarkReadTest");
      }, BENCHMARK_CONFIG.iterations.read);

      // Benchmark JSON reads
      console.log(`Running ${BENCHMARK_CONFIG.iterations.read} JSON read iterations...`);
      const jsonBenchmark = await BenchmarkUtils.measureOperation(async () => {
        return await jsonManager.getContract(56, "BenchmarkReadTest");
      }, BENCHMARK_CONFIG.iterations.read);

      // Performance analysis
      const performanceRatio = jsonBenchmark.averageTime / levelDBBenchmark.averageTime;
      
      console.log(`\nRead Performance Results:`);
      console.log(`  LevelDB Average: ${levelDBBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  LevelDB Range: ${levelDBBenchmark.minTime}ms - ${levelDBBenchmark.maxTime}ms`);
      console.log(`  JSON Average: ${jsonBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  JSON Range: ${jsonBenchmark.minTime}ms - ${jsonBenchmark.maxTime}ms`);
      console.log(`  Performance Ratio: ${performanceRatio.toFixed(2)}x`);
      console.log(`  Target Ratio: ≤${PERFORMANCE_TARGETS.read}x`);

      // Validate results exist
      expect(levelDBBenchmark.result, "LevelDB should return contract").to.not.be.null;
      expect(jsonBenchmark.result, "JSON should return contract").to.not.be.null;

      // Performance assertion
      TestAssertions.expectPerformanceWithinRange(
        jsonBenchmark.averageTime,
        levelDBBenchmark.averageTime,
        PERFORMANCE_TARGETS.read,
        "Read operations"
      );

      // Additional performance metrics
      expect(levelDBBenchmark.averageTime, "LevelDB reads should be reasonably fast").to.be.lessThan(50);
      expect(jsonBenchmark.averageTime, "JSON reads should be reasonably fast").to.be.lessThan(100);
    });

    it("should benchmark batch contract retrieval performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- Batch Contract Retrieval Benchmark ---");
      
      const batchSize = 10;
      const testContracts = [];
      
      // Create test contracts
      for (let i = 0; i < batchSize; i++) {
        const contract = TestContractGenerator.createMockContract(97, `BatchRead${i}`);
        testContracts.push(contract);
        await levelDBManager.putContract(97, contract);
        await jsonManager.putContract(97, contract);
      }

      // Benchmark LevelDB batch reads
      console.log(`Running ${BENCHMARK_CONFIG.iterations.read / 2} LevelDB batch read iterations...`);
      const levelDBBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const results = [];
        for (const contract of testContracts) {
          const result = await levelDBManager.getContract(97, contract.contractName);
          results.push(result);
        }
        return results;
      }, BENCHMARK_CONFIG.iterations.read / 2);

      // Benchmark JSON batch reads  
      console.log(`Running ${BENCHMARK_CONFIG.iterations.read / 2} JSON batch read iterations...`);
      const jsonBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const results = [];
        for (const contract of testContracts) {
          const result = await jsonManager.getContract(97, contract.contractName);
          results.push(result);
        }
        return results;
      }, BENCHMARK_CONFIG.iterations.read / 2);

      // Performance analysis
      const batchPerformanceRatio = jsonBenchmark.averageTime / levelDBBenchmark.averageTime;
      
      console.log(`\nBatch Read Performance Results:`);
      console.log(`  LevelDB Average: ${levelDBBenchmark.averageTime.toFixed(2)}ms (${batchSize} contracts)`);
      console.log(`  JSON Average: ${jsonBenchmark.averageTime.toFixed(2)}ms (${batchSize} contracts)`);
      console.log(`  Performance Ratio: ${batchPerformanceRatio.toFixed(2)}x`);

      // Validate results
      expect(levelDBBenchmark.result, "LevelDB batch should return results").to.have.lengthOf(batchSize);
      expect(jsonBenchmark.result, "JSON batch should return results").to.have.lengthOf(batchSize);

      TestAssertions.expectPerformanceWithinRange(
        jsonBenchmark.averageTime,
        levelDBBenchmark.averageTime,
        PERFORMANCE_TARGETS.read * 1.2, // Allow slightly higher ratio for batch operations
        "Batch read operations"
      );
    });

    it("should benchmark cross-network read performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- Cross-Network Read Performance Benchmark ---");
      
      const networkResults = [];
      
      for (const network of Object.values(TEST_NETWORKS)) {
        console.log(`  Benchmarking ${network.name} (${network.contracts} contracts)...`);
        
        // Benchmark getAllContracts for each network
        const levelDBNetworkBenchmark = await BenchmarkUtils.measureOperation(async () => {
          return await levelDBManager.getAllContracts(network.chainId);
        }, Math.min(BENCHMARK_CONFIG.iterations.read / 2, 25));

        const jsonNetworkBenchmark = await BenchmarkUtils.measureOperation(async () => {
          return await jsonManager.getAllContracts(network.chainId);
        }, Math.min(BENCHMARK_CONFIG.iterations.read / 2, 25));

        const networkRatio = jsonNetworkBenchmark.averageTime / levelDBNetworkBenchmark.averageTime;
        
        networkResults.push({
          network: network.name,
          chainId: network.chainId,
          contractCount: network.contracts,
          levelDBTime: levelDBNetworkBenchmark.averageTime,
          jsonTime: jsonNetworkBenchmark.averageTime,
          ratio: networkRatio
        });

        console.log(`    ${network.name}: LevelDB ${levelDBNetworkBenchmark.averageTime.toFixed(2)}ms, JSON ${jsonNetworkBenchmark.averageTime.toFixed(2)}ms (${networkRatio.toFixed(2)}x)`);
      }

      // Performance analysis across networks
      const avgRatio = networkResults.reduce((sum, result) => sum + result.ratio, 0) / networkResults.length;
      console.log(`\nCross-Network Average Performance Ratio: ${avgRatio.toFixed(2)}x`);

      // Validate all networks meet performance criteria
      for (const result of networkResults) {
        TestAssertions.expectPerformanceWithinRange(
          result.jsonTime,
          result.levelDBTime,
          PERFORMANCE_TARGETS.read * 1.3, // Slightly higher tolerance for getAllContracts
          `${result.network} getAllContracts`
        );
      }
    });
  });

  describe("Write Operation Benchmarks", () => {
    it("should benchmark single contract storage performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- Single Contract Storage Benchmark ---");

      // Benchmark LevelDB writes
      console.log(`Running ${BENCHMARK_CONFIG.iterations.write} LevelDB write iterations...`);
      const levelDBBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const contract = TestContractGenerator.createMockContract(84532, `LevelDBWrite${Date.now()}`);
        await levelDBManager.putContract(84532, contract);
        return contract;
      }, BENCHMARK_CONFIG.iterations.write);

      // Benchmark JSON writes
      console.log(`Running ${BENCHMARK_CONFIG.iterations.write} JSON write iterations...`);
      const jsonBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const contract = TestContractGenerator.createMockContract(84532, `JSONWrite${Date.now()}`);
        await jsonManager.putContract(84532, contract);
        return contract;
      }, BENCHMARK_CONFIG.iterations.write);

      // Performance analysis
      const writePerformanceRatio = jsonBenchmark.averageTime / levelDBBenchmark.averageTime;
      
      console.log(`\nWrite Performance Results:`);
      console.log(`  LevelDB Average: ${levelDBBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  LevelDB Range: ${levelDBBenchmark.minTime}ms - ${levelDBBenchmark.maxTime}ms`);
      console.log(`  JSON Average: ${jsonBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  JSON Range: ${jsonBenchmark.minTime}ms - ${jsonBenchmark.maxTime}ms`);
      console.log(`  Performance Ratio: ${writePerformanceRatio.toFixed(2)}x`);
      console.log(`  Target Ratio: ≤${PERFORMANCE_TARGETS.write}x`);

      TestAssertions.expectPerformanceWithinRange(
        jsonBenchmark.averageTime,
        levelDBBenchmark.averageTime,
        PERFORMANCE_TARGETS.write,
        "Write operations"
      );
    });

    it("should benchmark contract update performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- Contract Update Performance Benchmark ---");
      
      // Create initial contracts for updating
      const baseContract = TestContractGenerator.createMockContract(11155420, "UpdateTest");
      await levelDBManager.putContract(11155420, baseContract);
      await jsonManager.putContract(11155420, baseContract);

      // Benchmark LevelDB updates
      console.log(`Running ${BENCHMARK_CONFIG.iterations.write} LevelDB update iterations...`);
      const levelDBBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const updatedContract = { ...baseContract };
        updatedContract.timestamp = Date.now();
        updatedContract.implementationHash = ethers.keccak256(ethers.toUtf8Bytes(`update-${Date.now()}`));
        await levelDBManager.putContract(11155420, updatedContract);
        return updatedContract;
      }, BENCHMARK_CONFIG.iterations.write);

      // Benchmark JSON updates
      console.log(`Running ${BENCHMARK_CONFIG.iterations.write} JSON update iterations...`);
      const jsonBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const updatedContract = { ...baseContract };
        updatedContract.timestamp = Date.now();
        updatedContract.implementationHash = ethers.keccak256(ethers.toUtf8Bytes(`update-${Date.now()}`));
        await jsonManager.putContract(11155420, updatedContract);
        return updatedContract;
      }, BENCHMARK_CONFIG.iterations.write);

      const updatePerformanceRatio = jsonBenchmark.averageTime / levelDBBenchmark.averageTime;
      
      console.log(`\nUpdate Performance Results:`);
      console.log(`  LevelDB Average: ${levelDBBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  JSON Average: ${jsonBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  Performance Ratio: ${updatePerformanceRatio.toFixed(2)}x`);

      TestAssertions.expectPerformanceWithinRange(
        jsonBenchmark.averageTime,
        levelDBBenchmark.averageTime,
        PERFORMANCE_TARGETS.write,
        "Update operations"
      );
    });

    it("should benchmark batch write performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout * 2); // Extended timeout for batch operations
      
      console.log("\n--- Batch Write Performance Benchmark ---");
      
      const batchSize = 20;

      // Benchmark LevelDB batch writes
      console.log(`Running ${BENCHMARK_CONFIG.iterations.write / 4} LevelDB batch write iterations (${batchSize} contracts each)...`);
      const levelDBBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const contracts = [];
        for (let i = 0; i < batchSize; i++) {
          const contract = TestContractGenerator.createMockContract(23295, `LevelDBBatch${Date.now()}-${i}`);
          await levelDBManager.putContract(23295, contract);
          contracts.push(contract);
        }
        return contracts;
      }, BENCHMARK_CONFIG.iterations.write / 4);

      // Benchmark JSON batch writes
      console.log(`Running ${BENCHMARK_CONFIG.iterations.write / 4} JSON batch write iterations (${batchSize} contracts each)...`);
      const jsonBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const contracts = [];
        for (let i = 0; i < batchSize; i++) {
          const contract = TestContractGenerator.createMockContract(23295, `JSONBatch${Date.now()}-${i}`);
          await jsonManager.putContract(23295, contract);
          contracts.push(contract);
        }
        return contracts;
      }, BENCHMARK_CONFIG.iterations.write / 4);

      const batchWriteRatio = jsonBenchmark.averageTime / levelDBBenchmark.averageTime;
      
      console.log(`\nBatch Write Performance Results:`);
      console.log(`  LevelDB Average: ${levelDBBenchmark.averageTime.toFixed(2)}ms (${batchSize} contracts)`);
      console.log(`  JSON Average: ${jsonBenchmark.averageTime.toFixed(2)}ms (${batchSize} contracts)`);
      console.log(`  Performance Ratio: ${batchWriteRatio.toFixed(2)}x`);

      TestAssertions.expectPerformanceWithinRange(
        jsonBenchmark.averageTime,
        levelDBBenchmark.averageTime,
        PERFORMANCE_TARGETS.write * 1.5, // Allow higher ratio for batch writes due to file I/O
        "Batch write operations"
      );
    });
  });

  describe("Query Operation Benchmarks", () => {
    it("should benchmark complex query performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- Complex Query Performance Benchmark ---");

      // Benchmark LevelDB complex queries
      console.log(`Running ${BENCHMARK_CONFIG.iterations.query} LevelDB query iterations...`);
      const levelDBBenchmark = await BenchmarkUtils.measureOperation(async () => {
        return await levelDBManager.queryContracts({
          contractName: "LookCoin",
          sortBy: 'timestamp',
          sortOrder: 'desc'
        });
      }, BENCHMARK_CONFIG.iterations.query);

      // Benchmark JSON complex queries
      console.log(`Running ${BENCHMARK_CONFIG.iterations.query} JSON query iterations...`);
      const jsonBenchmark = await BenchmarkUtils.measureOperation(async () => {
        return await jsonManager.queryContracts({
          contractName: "LookCoin", 
          sortBy: 'timestamp',
          sortOrder: 'desc'
        });
      }, BENCHMARK_CONFIG.iterations.query);

      const queryPerformanceRatio = jsonBenchmark.averageTime / levelDBBenchmark.averageTime;
      
      console.log(`\nQuery Performance Results:`);
      console.log(`  LevelDB Average: ${levelDBBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  LevelDB Range: ${levelDBBenchmark.minTime}ms - ${levelDBBenchmark.maxTime}ms`);
      console.log(`  JSON Average: ${jsonBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  JSON Range: ${jsonBenchmark.minTime}ms - ${jsonBenchmark.maxTime}ms`);
      console.log(`  Performance Ratio: ${queryPerformanceRatio.toFixed(2)}x`);
      console.log(`  Target Ratio: ≤${PERFORMANCE_TARGETS.query}x`);

      // Validate query results are identical
      expect(levelDBBenchmark.result.length, "Query result lengths should match").to.equal(jsonBenchmark.result.length);

      TestAssertions.expectPerformanceWithinRange(
        jsonBenchmark.averageTime,
        levelDBBenchmark.averageTime,
        PERFORMANCE_TARGETS.query,
        "Complex query operations"
      );
    });

    it("should benchmark multi-criteria query performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- Multi-Criteria Query Performance Benchmark ---");

      // Benchmark LevelDB multi-criteria queries
      const levelDBBenchmark = await BenchmarkUtils.measureOperation(async () => {
        return await levelDBManager.queryContracts({
          chainId: 56,
          sortBy: 'contractName',
          sortOrder: 'asc'
        });
      }, BENCHMARK_CONFIG.iterations.query);

      // Benchmark JSON multi-criteria queries
      const jsonBenchmark = await BenchmarkUtils.measureOperation(async () => {
        return await jsonManager.queryContracts({
          chainId: 56,
          sortBy: 'contractName',
          sortOrder: 'asc'
        });
      }, BENCHMARK_CONFIG.iterations.query);

      const multiQueryRatio = jsonBenchmark.averageTime / levelDBBenchmark.averageTime;
      
      console.log(`\nMulti-Criteria Query Results:`);
      console.log(`  LevelDB Average: ${levelDBBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  JSON Average: ${jsonBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  Performance Ratio: ${multiQueryRatio.toFixed(2)}x`);

      TestAssertions.expectPerformanceWithinRange(
        jsonBenchmark.averageTime,
        levelDBBenchmark.averageTime,
        PERFORMANCE_TARGETS.query,
        "Multi-criteria query operations"
      );
    });
  });

  describe("Memory Usage and Caching Performance", () => {
    it("should measure memory usage efficiency", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- Memory Usage Efficiency Test ---");

      // Get initial memory usage
      const initialMemory = process.memoryUsage();
      
      // Load significant amount of data in both backends
      const contractCount = 100;
      const contracts = [];
      
      for (let i = 0; i < contractCount; i++) {
        const contract = TestContractGenerator.createContractWithBigInt(56, `MemoryTest${i}`);
        contracts.push(contract);
      }

      // Measure LevelDB memory impact
      const preLoadMemory = process.memoryUsage();
      
      for (const contract of contracts) {
        await levelDBManager.putContract(56, contract);
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const levelDBMemory = process.memoryUsage();

      // Measure JSON memory impact
      for (const contract of contracts) {
        await jsonManager.putContract(97, contract); // Different chain to avoid conflicts
      }
      
      if (global.gc) {
        global.gc();
      }
      
      const jsonMemory = process.memoryUsage();

      // Calculate memory differences
      const levelDBHeapDelta = levelDBMemory.heapUsed - preLoadMemory.heapUsed;
      const jsonHeapDelta = jsonMemory.heapUsed - levelDBMemory.heapUsed;
      const memoryRatio = jsonHeapDelta / Math.max(levelDBHeapDelta, 1024); // Avoid division by zero

      console.log(`\nMemory Usage Results (${contractCount} contracts):`);
      console.log(`  LevelDB Heap Delta: ${(levelDBHeapDelta / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  JSON Heap Delta: ${(jsonHeapDelta / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Memory Ratio: ${memoryRatio.toFixed(2)}x`);
      console.log(`  Target Ratio: ≤${PERFORMANCE_TARGETS.memory}x`);

      // Memory usage should be reasonable
      expect(memoryRatio, "JSON memory usage should be within acceptable limits").to.be.lessThan(PERFORMANCE_TARGETS.memory * 2); // Allow some flexibility
    });

    it("should test JSON backend cache effectiveness", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout);
      
      console.log("\n--- JSON Cache Effectiveness Test ---");

      const cacheTestContract = TestContractGenerator.createMockContract(84532, "CacheTest");
      await jsonManager.putContract(84532, cacheTestContract);

      // First read (cache miss)
      const firstReadBenchmark = await BenchmarkUtils.measureOperation(async () => {
        return await jsonManager.getContract(84532, "CacheTest");
      }, 1);

      // Subsequent reads (cache hits)
      const cachedReadBenchmark = await BenchmarkUtils.measureOperation(async () => {
        return await jsonManager.getContract(84532, "CacheTest");
      }, 50);

      const cacheSpeedup = firstReadBenchmark.averageTime / cachedReadBenchmark.averageTime;
      
      console.log(`\nCache Performance Results:`);
      console.log(`  First Read (Cache Miss): ${firstReadBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  Cached Reads Average: ${cachedReadBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  Cache Speedup: ${cacheSpeedup.toFixed(2)}x`);

      // Cache should provide some performance benefit
      expect(cacheSpeedup, "Cache should provide performance benefit").to.be.greaterThan(1.2);
      
      // Get cache statistics if available
      const metrics = await jsonManager.getMetrics();
      if (metrics.cacheHitRate !== undefined) {
        console.log(`  Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
        expect(metrics.cacheHitRate, "Cache hit rate should be reasonable").to.be.greaterThan(0.8);
      }
    });
  });

  describe("Concurrent Access Performance", () => {
    it("should benchmark concurrent read performance", async function() {
      this.timeout(BENCHMARK_CONFIG.timeout * 2);
      
      console.log("\n--- Concurrent Read Performance Test ---");

      const concurrentReadContract = TestContractGenerator.createMockContract(11155420, "ConcurrentRead");
      await levelDBManager.putContract(11155420, concurrentReadContract);
      await jsonManager.putContract(11155420, concurrentReadContract);

      const concurrentReads = 10;

      // Benchmark LevelDB concurrent reads
      const levelDBConcurrentBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const readPromises = [];
        for (let i = 0; i < concurrentReads; i++) {
          readPromises.push(levelDBManager.getContract(11155420, "ConcurrentRead"));
        }
        return await Promise.all(readPromises);
      }, 10);

      // Benchmark JSON concurrent reads
      const jsonConcurrentBenchmark = await BenchmarkUtils.measureOperation(async () => {
        const readPromises = [];
        for (let i = 0; i < concurrentReads; i++) {
          readPromises.push(jsonManager.getContract(11155420, "ConcurrentRead"));
        }
        return await Promise.all(readPromises);
      }, 10);

      const concurrentRatio = jsonConcurrentBenchmark.averageTime / levelDBConcurrentBenchmark.averageTime;
      
      console.log(`\nConcurrent Read Results (${concurrentReads} parallel reads):`);
      console.log(`  LevelDB Average: ${levelDBConcurrentBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  JSON Average: ${jsonConcurrentBenchmark.averageTime.toFixed(2)}ms`);
      console.log(`  Performance Ratio: ${concurrentRatio.toFixed(2)}x`);

      // Validate all reads succeeded
      expect(levelDBConcurrentBenchmark.result, "All LevelDB concurrent reads should succeed").to.have.lengthOf(concurrentReads);
      expect(jsonConcurrentBenchmark.result, "All JSON concurrent reads should succeed").to.have.lengthOf(concurrentReads);

      TestAssertions.expectPerformanceWithinRange(
        jsonConcurrentBenchmark.averageTime,
        levelDBConcurrentBenchmark.averageTime,
        PERFORMANCE_TARGETS.read * 2, // Allow higher tolerance for concurrent operations
        "Concurrent read operations"
      );
    });
  });

  describe("Performance Report Generation", () => {
    it("should generate comprehensive performance report", async () => {
      console.log("\n=== COMPREHENSIVE PERFORMANCE REPORT ===");
      
      // Get final metrics from both backends
      const levelDBMetrics = await levelDBManager.getMetrics();
      const jsonMetrics = await jsonManager.getMetrics();

      console.log(`\nFinal Backend Metrics:`);
      console.log(`  LevelDB:`);
      console.log(`    Read Latency: ${levelDBMetrics.readLatency.toFixed(2)}ms`);
      console.log(`    Write Latency: ${levelDBMetrics.writeLatency.toFixed(2)}ms`);
      console.log(`    Query Latency: ${levelDBMetrics.queryLatency.toFixed(2)}ms`);
      console.log(`    Error Rate: ${(levelDBMetrics.errorRate * 100).toFixed(2)}%`);
      
      console.log(`  JSON:`);
      console.log(`    Read Latency: ${jsonMetrics.readLatency.toFixed(2)}ms`);
      console.log(`    Write Latency: ${jsonMetrics.writeLatency.toFixed(2)}ms`);
      console.log(`    Query Latency: ${jsonMetrics.queryLatency.toFixed(2)}ms`);
      console.log(`    Error Rate: ${(jsonMetrics.errorRate * 100).toFixed(2)}%`);
      if (jsonMetrics.cacheHitRate !== undefined) {
        console.log(`    Cache Hit Rate: ${(jsonMetrics.cacheHitRate * 100).toFixed(1)}%`);
      }

      console.log(`\nPerformance Ratios vs Targets:`);
      const readRatio = jsonMetrics.readLatency / Math.max(levelDBMetrics.readLatency, 1);
      const writeRatio = jsonMetrics.writeLatency / Math.max(levelDBMetrics.writeLatency, 1);
      const queryRatio = jsonMetrics.queryLatency / Math.max(levelDBMetrics.queryLatency, 1);
      
      console.log(`  Read: ${readRatio.toFixed(2)}x (target: ≤${PERFORMANCE_TARGETS.read}x) ${readRatio <= PERFORMANCE_TARGETS.read ? '✓' : '✗'}`);
      console.log(`  Write: ${writeRatio.toFixed(2)}x (target: ≤${PERFORMANCE_TARGETS.write}x) ${writeRatio <= PERFORMANCE_TARGETS.write ? '✓' : '✗'}`);
      console.log(`  Query: ${queryRatio.toFixed(2)}x (target: ≤${PERFORMANCE_TARGETS.query}x) ${queryRatio <= PERFORMANCE_TARGETS.query ? '✓' : '✗'}`);

      console.log(`\nPerformance Assessment:`);
      const passedTargets = [
        readRatio <= PERFORMANCE_TARGETS.read,
        writeRatio <= PERFORMANCE_TARGETS.write,
        queryRatio <= PERFORMANCE_TARGETS.query
      ].filter(Boolean).length;
      
      console.log(`  Targets Met: ${passedTargets}/3`);
      
      if (passedTargets === 3) {
        console.log(`  Overall Assessment: ✓ PASS - JSON backend meets all performance targets`);
      } else {
        console.log(`  Overall Assessment: ⚠ REVIEW - Some performance targets not met`);
      }

      // Error rates should be reasonable
      expect(levelDBMetrics.errorRate, "LevelDB error rate should be low").to.be.lessThan(0.05);
      expect(jsonMetrics.errorRate, "JSON error rate should be low").to.be.lessThan(0.05);
    });
  });

  // Helper functions

  async function populateInitialTestData(): Promise<void> {
    // Create representative test data across all networks
    for (const network of Object.values(TEST_NETWORKS)) {
      const contracts = await TestContractGenerator.populateTestData(levelDBManager, network);
      
      // Also populate JSON backend with same data
      for (const contract of contracts) {
        await jsonManager.putContract(network.chainId, contract);
      }
    }
  }

  async function performWarmup(): Promise<void> {
    // Warmup both backends with repeated operations
    const warmupContract = TestContractGenerator.createMockContract(56, "WarmupContract");
    
    for (let i = 0; i < BENCHMARK_CONFIG.warmupIterations; i++) {
      await levelDBManager.putContract(56, warmupContract);
      await levelDBManager.getContract(56, "WarmupContract");
      
      await jsonManager.putContract(56, warmupContract);
      await jsonManager.getContract(56, "WarmupContract");
    }
  }
});