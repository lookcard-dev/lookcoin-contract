#!/usr/bin/env tsx

/**
 * Benchmark Setup Validator
 * 
 * Validates that the performance benchmarking suite is properly configured
 * and can run successfully before executing full benchmarks.
 * 
 * This script performs pre-flight checks to ensure:
 * - All dependencies are available
 * - State managers can be initialized
 * - Test data can be generated
 * - Basic operations work correctly
 * - File system permissions are correct
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { StateManagerFactory } from '../utils/StateManagerFactory';
import { IStateManager } from '../utils/IStateManager';

interface ValidationResult {
  check: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: any;
}

class BenchmarkValidator {
  private results: ValidationResult[] = [];

  async validate(): Promise<boolean> {
    console.log('🔍 Validating Performance Benchmark Setup...\n');

    await this.checkEnvironment();
    await this.checkDependencies();
    await this.checkFileSystemPermissions();
    await this.checkStateManagerInitialization();
    await this.checkBasicOperations();
    await this.checkProductionDataAvailability();
    await this.checkMemoryConfiguration();
    
    return this.generateReport();
  }

  private async checkEnvironment(): Promise<void> {
    console.log('🌍 Checking Environment...');

    // Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    this.addResult('Node.js Version', 
      majorVersion >= 18 ? 'PASS' : 'FAIL',
      `Node.js ${nodeVersion} ${majorVersion >= 18 ? '(supported)' : '(requires ≥18.0.0)'}`
    );

    // Platform information
    this.addResult('Platform', 'PASS', 
      `${process.platform} ${process.arch} (${require('os').cpus().length} cores)`
    );

    // Memory availability
    const totalMemoryGB = require('os').totalmem() / 1024 / 1024 / 1024;
    this.addResult('Available Memory', 
      totalMemoryGB >= 4 ? 'PASS' : 'WARN',
      `${totalMemoryGB.toFixed(1)}GB ${totalMemoryGB >= 4 ? '(sufficient)' : '(may affect performance)'}`
    );

    // Garbage collection availability
    this.addResult('Garbage Collection', 
      typeof global.gc === 'function' ? 'PASS' : 'WARN',
      typeof global.gc === 'function' 
        ? 'Available (run with --expose-gc for precise memory measurement)'
        : 'Not available (run with --expose-gc flag for accurate memory analysis)'
    );
  }

  private async checkDependencies(): Promise<void> {
    console.log('📦 Checking Dependencies...');

    // Check for required modules
    const requiredModules = [
      'hardhat',
      'ethers',
      'level',
      'fs/promises',
      'path',
      'perf_hooks'
    ];

    for (const module of requiredModules) {
      try {
        await import(module);
        this.addResult(`Module: ${module}`, 'PASS', 'Available');
      } catch (error) {
        this.addResult(`Module: ${module}`, 'FAIL', 
          `Not available: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check TypeScript support
    try {
      const tsConfig = await fs.readFile(path.join(process.cwd(), 'tsconfig.json'), 'utf-8');
      this.addResult('TypeScript Config', 'PASS', 'tsconfig.json found');
    } catch {
      this.addResult('TypeScript Config', 'WARN', 'tsconfig.json not found');
    }
  }

  private async checkFileSystemPermissions(): Promise<void> {
    console.log('📁 Checking File System Permissions...');

    const testDir = path.join(process.cwd(), 'benchmark-test-' + Date.now());

    try {
      // Test directory creation
      await fs.mkdir(testDir, { recursive: true });
      this.addResult('Directory Creation', 'PASS', 'Can create test directories');

      // Test file write
      const testFile = path.join(testDir, 'test.json');
      await fs.writeFile(testFile, JSON.stringify({ test: true }, null, 2));
      this.addResult('File Write', 'PASS', 'Can write test files');

      // Test file read
      const content = await fs.readFile(testFile, 'utf-8');
      const parsed = JSON.parse(content);
      this.addResult('File Read', 
        parsed.test === true ? 'PASS' : 'FAIL', 
        'Can read test files'
      );

      // Cleanup
      await fs.rm(testDir, { recursive: true, force: true });
      this.addResult('File Cleanup', 'PASS', 'Can remove test files');

    } catch (error) {
      this.addResult('File System', 'FAIL', 
        `File system operations failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async checkStateManagerInitialization(): Promise<void> {
    console.log('🗄️  Checking State Manager Initialization...');

    const factory = new StateManagerFactory();
    const testTimestamp = Date.now();

    // Test LevelDB manager
    try {
      const levelDBManager = await factory.createStateManager('leveldb', {
        debugMode: false,
        dbPath: path.join(process.cwd(), `validation-leveldb-${testTimestamp}`),
        leveldbOptions: { createIfMissing: true }
      });

      await levelDBManager.initialize();
      const isHealthy = await levelDBManager.isHealthy();
      
      this.addResult('LevelDB Manager', 
        isHealthy ? 'PASS' : 'FAIL',
        isHealthy ? 'Successfully initialized' : 'Initialization failed'
      );

      await levelDBManager.close();

      // Cleanup
      try {
        await fs.rm(path.join(process.cwd(), `validation-leveldb-${testTimestamp}`), 
          { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

    } catch (error) {
      this.addResult('LevelDB Manager', 'FAIL', 
        `Initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Test UnifiedJSON manager
    try {
      const jsonManager = await factory.createStateManager('json', {
        debugMode: false,
        jsonPath: path.join(process.cwd(), `validation-json-${testTimestamp}`),
        enableCache: true
      });

      await jsonManager.initialize();
      const isHealthy = await jsonManager.isHealthy();
      
      this.addResult('UnifiedJSON Manager', 
        isHealthy ? 'PASS' : 'FAIL',
        isHealthy ? 'Successfully initialized' : 'Initialization failed'
      );

      await jsonManager.close();

      // Cleanup
      try {
        await fs.rm(path.join(process.cwd(), `validation-json-${testTimestamp}`), 
          { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

    } catch (error) {
      this.addResult('UnifiedJSON Manager', 'FAIL', 
        `Initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async checkBasicOperations(): Promise<void> {
    console.log('⚙️  Checking Basic Operations...');

    const factory = new StateManagerFactory();
    const testTimestamp = Date.now();

    try {
      // Initialize test managers
      const levelDBManager = await factory.createStateManager('leveldb', {
        debugMode: false,
        dbPath: path.join(process.cwd(), `ops-test-leveldb-${testTimestamp}`),
        leveldbOptions: { createIfMissing: true }
      });

      const jsonManager = await factory.createStateManager('json', {
        debugMode: false,
        jsonPath: path.join(process.cwd(), `ops-test-json-${testTimestamp}`),
        enableCache: true
      });

      // Test contract creation
      const testContract = {
        contractName: 'TestContract',
        chainId: 97,
        networkName: 'bsctestnet',
        address: '0x1234567890123456789012345678901234567890',
        factoryByteCodeHash: '0x' + '0'.repeat(64),
        implementationHash: '0x' + '1'.repeat(64),
        timestamp: Date.now()
      };

      // Test LevelDB operations
      await levelDBManager.putContract(97, testContract);
      const levelDBRetrieved = await levelDBManager.getContract(97, 'TestContract');
      
      this.addResult('LevelDB Operations', 
        levelDBRetrieved !== null ? 'PASS' : 'FAIL',
        'Basic read/write operations work'
      );

      // Test JSON operations
      await jsonManager.putContract(97, testContract);
      const jsonRetrieved = await jsonManager.getContract(97, 'TestContract');
      
      this.addResult('JSON Operations', 
        jsonRetrieved !== null ? 'PASS' : 'FAIL',
        'Basic read/write operations work'
      );

      // Test query operations
      const levelDBQuery = await levelDBManager.queryContracts({ chainId: 97 });
      const jsonQuery = await jsonManager.queryContracts({ chainId: 97 });

      this.addResult('Query Operations', 
        levelDBQuery.length > 0 && jsonQuery.length > 0 ? 'PASS' : 'FAIL',
        'Query operations work for both backends'
      );

      // Cleanup
      await levelDBManager.close();
      await jsonManager.close();

      try {
        await fs.rm(path.join(process.cwd(), `ops-test-leveldb-${testTimestamp}`), 
          { recursive: true, force: true });
        await fs.rm(path.join(process.cwd(), `ops-test-json-${testTimestamp}`), 
          { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

    } catch (error) {
      this.addResult('Basic Operations', 'FAIL', 
        `Operations failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async checkProductionDataAvailability(): Promise<void> {
    console.log('🌐 Checking Production Data Availability...');

    const productionPaths = [
      'deployments/unified/bscmainnet.unified.json',
      'deployments/unified/bsctestnet.unified.json', 
      'deployments/unified/basesepolia.unified.json',
      'deployments/unified/optimismsepolia.unified.json',
      'deployments/unified/sapphiremainnet.unified.json'
    ];

    let availableFiles = 0;
    const availableNetworks: string[] = [];

    for (const filePath of productionPaths) {
      try {
        const fullPath = path.join(process.cwd(), filePath);
        await fs.access(fullPath);
        availableFiles++;
        
        // Extract network name for reporting
        const networkName = path.basename(filePath, '.unified.json');
        availableNetworks.push(networkName);
        
        // Validate file content
        const content = await fs.readFile(fullPath, 'utf-8');
        const data = JSON.parse(content);
        
        if (data.contracts && Object.keys(data.contracts).length > 0) {
          this.addResult(`Production Data: ${networkName}`, 'PASS', 
            `Valid data with ${Object.keys(data.contracts).length} contract categories`
          );
        } else {
          this.addResult(`Production Data: ${networkName}`, 'WARN', 
            'File exists but contains no contracts'
          );
        }
      } catch {
        const networkName = path.basename(filePath, '.unified.json');
        this.addResult(`Production Data: ${networkName}`, 'WARN', 
          'File not available - will use mock data'
        );
      }
    }

    this.addResult('Production Data Summary', 
      availableFiles > 0 ? 'PASS' : 'WARN',
      `${availableFiles}/${productionPaths.length} networks available: [${availableNetworks.join(', ')}]`
    );
  }

  private async checkMemoryConfiguration(): Promise<void> {
    console.log('💾 Checking Memory Configuration...');

    // Check initial memory usage
    const initialMemory = process.memoryUsage();
    this.addResult('Initial Memory', 'PASS', 
      `Heap: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB, RSS: ${Math.round(initialMemory.rss / 1024 / 1024)}MB`
    );

    // Test garbage collection
    if (typeof global.gc === 'function') {
      const beforeGC = process.memoryUsage();
      global.gc();
      const afterGC = process.memoryUsage();
      
      const memoryFreed = beforeGC.heapUsed - afterGC.heapUsed;
      this.addResult('Garbage Collection', 'PASS', 
        `Freed ${Math.round(memoryFreed / 1024)}KB of heap memory`
      );
    } else {
      this.addResult('Garbage Collection', 'WARN', 
        'Not available - run with --expose-gc for memory optimization'
      );
    }

    // Check memory limits (if available)
    try {
      const v8 = require('v8');
      const heapStats = v8.getHeapStatistics();
      const maxHeapMB = Math.round(heapStats.heap_size_limit / 1024 / 1024);
      
      this.addResult('Memory Limits', 
        maxHeapMB >= 1024 ? 'PASS' : 'WARN',
        `Max heap: ${maxHeapMB}MB ${maxHeapMB >= 1024 ? '(sufficient)' : '(may limit large benchmarks)'}`
      );
    } catch {
      this.addResult('Memory Limits', 'WARN', 'Unable to determine memory limits');
    }
  }

  private addResult(check: string, status: 'PASS' | 'FAIL' | 'WARN', message: string, details?: any): void {
    this.results.push({ check, status, message, details });
    
    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️ ';
    console.log(`   ${icon} ${check}: ${message}`);
  }

  private generateReport(): boolean {
    console.log('\n📊 Validation Summary:');
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const warnings = this.results.filter(r => r.status === 'WARN').length;
    const total = this.results.length;

    console.log(`   ✅ Passed: ${passed}/${total}`);
    console.log(`   ❌ Failed: ${failed}/${total}`);
    console.log(`   ⚠️  Warnings: ${warnings}/${total}`);

    // Print failures
    const failures = this.results.filter(r => r.status === 'FAIL');
    if (failures.length > 0) {
      console.log('\n❌ Critical Issues:');
      failures.forEach(f => console.log(`   - ${f.check}: ${f.message}`));
    }

    // Print warnings
    const warningItems = this.results.filter(r => r.status === 'WARN');
    if (warningItems.length > 0) {
      console.log('\n⚠️  Warnings:');
      warningItems.forEach(w => console.log(`   - ${w.check}: ${w.message}`));
    }

    console.log('\n' + '='.repeat(80));
    
    if (failed === 0) {
      console.log('🎉 Benchmark setup validation PASSED!');
      console.log('✅ Ready to run performance benchmarks');
      
      if (warnings > 0) {
        console.log('ℹ️  Some warnings detected - benchmarks will run but results may vary');
      }
      
      console.log('\nNext steps:');
      console.log('  npm run benchmark          # Full benchmark suite');
      console.log('  npm run benchmark:quick    # Quick benchmark');
      console.log('  npm run benchmark:gc       # With garbage collection');
      
    } else {
      console.log('❌ Benchmark setup validation FAILED!');
      console.log('🛠️  Please fix the critical issues before running benchmarks');
    }
    
    console.log('='.repeat(80));

    return failed === 0;
  }
}

// Main execution
async function main(): Promise<void> {
  const validator = new BenchmarkValidator();
  const isValid = await validator.validate();
  
  process.exit(isValid ? 0 : 1);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  });
}

export { BenchmarkValidator };