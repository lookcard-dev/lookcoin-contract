#!/usr/bin/env tsx

/**
 * Performance Benchmark Runner
 * 
 * Enhanced benchmark execution script that integrates with the existing
 * LookCoin testing infrastructure and provides comprehensive performance
 * analysis for production migration readiness.
 * 
 * Usage:
 *   npm run benchmark                     # Full benchmark suite
 *   npm run benchmark -- --quick         # Quick benchmark (reduced iterations)
 *   npm run benchmark -- --memory-only   # Memory usage analysis only
 *   npm run benchmark -- --concurrent    # Concurrent access tests only
 *   npm run benchmark -- --production    # Use real production data
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { runPerformanceBenchmarkSuite } from './performance-suite';

interface BenchmarkOptions {
  quick?: boolean;
  memoryOnly?: boolean;
  concurrent?: boolean;
  production?: boolean;
  verbose?: boolean;
  outputDir?: string;
}

class BenchmarkRunner {
  private options: BenchmarkOptions;
  private startTime: number;

  constructor(options: BenchmarkOptions = {}) {
    this.options = {
      verbose: true,
      outputDir: path.join(process.cwd(), 'benchmark-results'),
      ...options
    };
    this.startTime = Date.now();
  }

  async run(): Promise<void> {
    try {
      await this.setup();
      await this.executeBenchmarks();
      await this.generateAggregateReports();
      await this.cleanup();
    } catch (error) {
      console.error('❌ Benchmark execution failed:', error);
      throw error;
    }
  }

  private async setup(): Promise<void> {
    console.log('\n🔧 Setting up benchmark environment...');
    
    // Ensure output directory exists
    await fs.mkdir(this.options.outputDir!, { recursive: true });
    
    // Log system information
    if (this.options.verbose) {
      console.log(`   📊 Node.js: ${process.version}`);
      console.log(`   💻 Platform: ${process.platform} ${process.arch}`);
      console.log(`   🧠 Memory: ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB available`);
      console.log(`   ⚙️  CPU Cores: ${require('os').cpus().length}`);
    }

    // Configure garbage collection if available
    if (global.gc) {
      console.log('   🗑️  Garbage collection enabled for accurate memory measurements');
    } else {
      console.log('   ⚠️  Garbage collection not available - run with --expose-gc for precise memory analysis');
    }

    // Validate production data availability if requested
    if (this.options.production) {
      await this.validateProductionData();
    }
  }

  private async validateProductionData(): Promise<void> {
    console.log('   🌐 Validating production data availability...');
    
    const productionFiles = [
      'deployments/unified/bscmainnet.unified.json',
      'deployments/unified/bsctestnet.unified.json',
      'deployments/unified/basesepolia.unified.json',
      'deployments/unified/optimismsepolia.unified.json'
    ];

    let availableFiles = 0;
    for (const file of productionFiles) {
      try {
        await fs.access(path.join(process.cwd(), file));
        availableFiles++;
      } catch {
        // File not available
      }
    }

    console.log(`   📁 Production data files available: ${availableFiles}/${productionFiles.length}`);
    
    if (availableFiles === 0) {
      console.log('   ⚠️  No production data found - using mock data for benchmarks');
    }
  }

  private async executeBenchmarks(): Promise<string> {
    console.log('\n🚀 Executing performance benchmarks...');
    
    // Set environment variables for benchmark configuration
    if (this.options.quick) {
      process.env.BENCHMARK_QUICK_MODE = 'true';
    }
    if (this.options.production) {
      process.env.BENCHMARK_USE_PRODUCTION_DATA = 'true';
    }
    if (this.options.verbose) {
      process.env.BENCHMARK_VERBOSE = 'true';
    }

    const benchmarkStart = performance.now();
    const reportPath = await runPerformanceBenchmarkSuite();
    const benchmarkDuration = performance.now() - benchmarkStart;

    console.log(`\n⏱️  Total benchmark duration: ${(benchmarkDuration / 1000).toFixed(2)}s`);

    // Move report to results directory
    const targetReportPath = path.join(this.options.outputDir!, path.basename(reportPath));
    await fs.rename(reportPath, targetReportPath);

    return targetReportPath;
  }

  private async generateAggregateReports(): Promise<void> {
    console.log('\n📊 Generating aggregate analysis...');

    // Create benchmark execution summary
    const executionSummary = {
      timestamp: this.startTime,
      duration: Date.now() - this.startTime,
      options: this.options,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuCount: require('os').cpus().length,
        totalMemory: require('os').totalmem(),
        freeMemory: require('os').freemem()
      },
      gitInfo: await this.getGitInfo()
    };

    const summaryPath = path.join(this.options.outputDir!, 'execution-summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(executionSummary, null, 2));

    // Generate recommendations report
    await this.generateRecommendations();

    console.log(`   📋 Execution summary: ${summaryPath}`);
  }

  private async getGitInfo(): Promise<any> {
    try {
      const { execSync } = require('child_process');
      return {
        branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim(),
        commit: execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim(),
        timestamp: execSync('git log -1 --format=%ct', { encoding: 'utf-8' }).trim()
      };
    } catch {
      return { branch: 'unknown', commit: 'unknown', timestamp: 'unknown' };
    }
  }

  private async generateRecommendations(): Promise<void> {
    const recommendations = `# Performance Benchmark Recommendations

## Migration Readiness Assessment

This report provides recommendations based on the performance benchmark results
for migrating from LevelDB to UnifiedJSON state management.

### Key Performance Metrics

1. **Read Operations**: Target < 50ms per contract
2. **Write Operations**: Target < 100ms per contract  
3. **Bulk Operations**: Target < 5 seconds for 100 contracts
4. **Memory Usage**: Target < 500MB for full dataset
5. **Concurrent Access**: Target ≤ 2.5x LevelDB performance

### Migration Decision Matrix

| Scenario | Recommendation |
|----------|----------------|
| All targets met | ✅ **PROCEED** with migration |
| 80%+ targets met | ⚠️ **REVIEW** flagged areas before migration |
| <80% targets met | ❌ **OPTIMIZE** before considering migration |

### Performance Optimization Guidelines

#### For Read Operations
- Enable caching with appropriate cache size
- Use batch operations where possible
- Consider read-through caching strategies

#### For Write Operations  
- Enable atomic writes for data consistency
- Batch multiple writes when feasible
- Monitor file I/O patterns and optimize

#### For Memory Usage
- Implement proper garbage collection strategies
- Use streaming for large datasets
- Monitor memory leaks during long-running operations

#### For Concurrent Access
- Implement proper locking mechanisms
- Use connection pooling for database-like operations
- Consider async queue processing for high concurrency

### Production Deployment Checklist

- [ ] All performance targets met in benchmarks
- [ ] Memory usage remains stable under load
- [ ] Error rates < 1% in all scenarios
- [ ] Backup and rollback procedures tested
- [ ] Monitoring and alerting configured
- [ ] Load testing completed with production data volumes

### Monitoring Requirements

Post-migration monitoring should track:
- Operation latency (p50, p95, p99)
- Error rates and types
- Memory usage trends
- File I/O performance
- Cache hit rates (if applicable)

---
Generated by LookCoin Performance Benchmark Suite
`;

    const recommendationsPath = path.join(this.options.outputDir!, 'migration-recommendations.md');
    await fs.writeFile(recommendationsPath, recommendations);
  }

  private async cleanup(): Promise<void> {
    console.log('\n🧹 Finalizing benchmark results...');
    
    // List all generated files
    const files = await fs.readdir(this.options.outputDir!);
    console.log('\n📁 Generated benchmark files:');
    for (const file of files) {
      const filePath = path.join(this.options.outputDir!, file);
      const stats = await fs.stat(filePath);
      console.log(`   📄 ${file} (${Math.round(stats.size / 1024)}KB)`);
    }

    console.log(`\n✅ All benchmark results saved to: ${this.options.outputDir}`);
  }
}

// Command line interface
function parseCliOptions(): BenchmarkOptions {
  const args = process.argv.slice(2);
  const options: BenchmarkOptions = {};

  // Check for help first
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  for (const arg of args) {
    switch (arg) {
      case '--quick':
        options.quick = true;
        break;
      case '--memory-only':
        options.memoryOnly = true;
        break;
      case '--concurrent':
        options.concurrent = true;
        break;
      case '--production':
        options.production = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      default:
        if (arg.startsWith('--output-dir=')) {
          options.outputDir = arg.split('=')[1];
        } else if (arg.startsWith('--')) {
          console.error(`❌ Unknown option: ${arg}`);
          printUsage();
          process.exit(1);
        }
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`
🚀 LookCoin Performance Benchmark Runner

Usage:
  npm run benchmark [options]

Options:
  --quick           Run reduced iteration benchmarks for faster results
  --memory-only     Run only memory usage analysis
  --concurrent      Run only concurrent access tests
  --production      Use real production data (if available)
  --verbose         Enable verbose logging
  --output-dir=DIR  Specify custom output directory
  --help            Show this help message

Examples:
  npm run benchmark                    # Full benchmark suite
  npm run benchmark -- --quick        # Quick benchmark
  npm run benchmark -- --production   # Use production data
  npm run benchmark -- --verbose      # Detailed output

For optimal performance measurement, run with garbage collection enabled:
  node --expose-gc ./scripts/benchmark/run-performance-benchmarks.ts
`);
}

// Main execution
async function main(): Promise<void> {
  const options = parseCliOptions();
  const runner = new BenchmarkRunner(options);

  console.log('🏁 Starting LookCoin Performance Benchmark Suite...');
  if (options.verbose) {
    console.log(`⚙️  Configuration: ${JSON.stringify(options, null, 2)}`);
  }

  const startTime = Date.now();
  
  try {
    await runner.run();
    const duration = (Date.now() - startTime) / 1000;
    
    console.log('\n' + '='.repeat(80));
    console.log(`🎉 Benchmark suite completed successfully in ${duration.toFixed(2)}s`);
    console.log('='.repeat(80));
    
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    console.log('\n' + '='.repeat(80));
    console.error(`❌ Benchmark suite failed after ${duration.toFixed(2)}s`);
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    console.log('='.repeat(80));
    
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { BenchmarkRunner, BenchmarkOptions };