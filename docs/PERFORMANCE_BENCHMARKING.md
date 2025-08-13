# Performance Benchmarking Suite

Comprehensive performance benchmarking framework for validating the migration from LevelDB to UnifiedJSON state management in the LookCoin contract deployment system.

## Overview

The Performance Benchmarking Suite provides exhaustive performance analysis to ensure that the migration from LevelDB to UnifiedJSON meets production requirements with minimal performance degradation.

### Key Performance Targets

| Metric | Target | Description |
|--------|--------|-------------|
| **Read Operations** | < 50ms per contract | Single contract retrieval time |
| **Write Operations** | < 100ms per contract | Single contract storage time |
| **Bulk Operations** | < 5 seconds for 100 contracts | Large dataset processing |
| **Memory Usage** | < 500MB for full dataset | Maximum memory consumption |
| **Performance Degradation** | ≤ 10% vs LevelDB | Overall performance regression limit |

### Performance Ratios (JSON vs LevelDB)

- **Read Operations**: ≤ 2.0x
- **Write Operations**: ≤ 3.0x
- **Bulk Operations**: ≤ 1.5x
- **Query Operations**: ≤ 5.0x
- **Memory Usage**: ≤ 1.5x
- **Concurrent Access**: ≤ 2.5x

## Test Coverage

### Core Benchmark Scenarios

1. **Single Contract Operations**
   - Baseline read/write performance
   - Individual contract CRUD operations
   - Performance percentiles (p50, p95, p99)

2. **Bulk Operations**
   - 50-contract batches (realistic load)
   - 100+ contract stress testing
   - Bulk read/write operations

3. **Concurrent Access**
   - 5-10 parallel operations
   - Race condition handling
   - Thread safety validation

4. **Memory Analysis**
   - Heap usage monitoring
   - Memory leak detection
   - Garbage collection impact

5. **Real Production Data**
   - BSC Testnet/Mainnet contracts
   - Base Sepolia contracts
   - Optimism Sepolia contracts
   - Sapphire Mainnet contracts

6. **Cold Start vs Hot Cache**
   - Initial load performance
   - Cache effectiveness analysis
   - Startup time optimization

## Quick Start

### Prerequisites

- Node.js 20+
- tsx (TypeScript execution)
- Access to production deployment files (optional)

### Basic Usage

```bash
# Full benchmark suite (recommended)
npm run benchmark

# Quick benchmark (reduced iterations)
npm run benchmark:quick

# Memory usage analysis only
npm run benchmark:memory

# Concurrent access testing
npm run benchmark:concurrent

# Use real production data
npm run benchmark:production

# Enable garbage collection for precise memory measurement
npm run benchmark:gc
```

### Advanced Usage

```bash
# Custom output directory
npm run benchmark -- --output-dir=/path/to/results

# Verbose logging
npm run benchmark -- --verbose

# Combination of options
npm run benchmark -- --quick --production --verbose
```

## Architecture

### Performance Measurement Framework

```typescript
interface OperationBenchmark {
  operation: string;
  averageTime: number;
  minTime: number;
  maxTime: number;
  p50: number;     // 50th percentile
  p95: number;     // 95th percentile  
  p99: number;     // 99th percentile
  totalTime: number;
  iterations: number;
  throughput: number;  // operations per second
  errorRate: number;
}
```

### Test Environment

```typescript
interface TestEnvironment {
  nodeVersion: string;
  platform: string;
  architecture: string;
  cpuCount: number;
  memoryAvailable: number;
  gcEnabled: boolean;
}
```

### Benchmark Configuration

```typescript
const BENCHMARK_CONFIG = {
  iterations: {
    baseline: 100,    // High precision baseline metrics
    bulk: 25,         // Moderate bulk operations
    stress: 10,       // Resource-intensive stress tests
    concurrent: 20    // Parallel operations
  },
  datasets: {
    single: 1,        // Single operations
    bulk: 50,         // Bulk operations
    stress: 150       // Stress testing
  },
  timeouts: {
    operation: 30000, // 30 second per operation
    suite: 300000     // 5 minute per suite
  }
};
```

## Test Suites

### 1. Single Contract Benchmarks

**Purpose**: Establish baseline performance for individual operations.

**Tests**:
- Single contract read operations
- Single contract write operations
- Contract existence checks
- Contract deletion operations

**Acceptance Criteria**:
- Read operations: < 50ms average
- Write operations: < 100ms average
- JSON performance: ≤ 2x LevelDB reads, ≤ 3x LevelDB writes

### 2. Bulk Operation Benchmarks

**Purpose**: Validate performance under realistic production loads.

**Tests**:
- Batch contract storage (50 contracts)
- Batch contract retrieval
- Cross-network queries
- Large dataset processing

**Acceptance Criteria**:
- Bulk operations: < 5 seconds for 100 contracts
- JSON performance: ≤ 1.5x LevelDB bulk operations

### 3. Stress Test Benchmarks

**Purpose**: Ensure system stability under maximum expected load.

**Tests**:
- 150+ contract operations
- Memory pressure scenarios  
- Extended operation sequences
- Resource exhaustion handling

**Acceptance Criteria**:
- No memory leaks detected
- Error rate < 1%
- Graceful degradation under load

### 4. Concurrent Access Benchmarks

**Purpose**: Validate thread safety and concurrent performance.

**Tests**:
- 10 parallel read operations
- Concurrent read/write operations
- Race condition detection
- Lock contention analysis

**Acceptance Criteria**:
- No data corruption
- JSON performance: ≤ 2.5x LevelDB concurrent operations

### 5. Memory Usage Analysis

**Purpose**: Ensure memory efficiency and leak prevention.

**Tests**:
- Heap usage monitoring
- Memory growth patterns
- Garbage collection impact
- Long-running operation stability

**Acceptance Criteria**:
- Total memory: < 500MB for full dataset
- JSON memory usage: ≤ 1.5x LevelDB usage
- No memory leaks over time

### 6. Cache Performance Analysis

**Purpose**: Validate caching effectiveness for JSON backend.

**Tests**:
- Cold start performance
- Cache hit/miss ratios
- Cache invalidation impact
- Memory vs speed tradeoffs

**Acceptance Criteria**:
- Cache hit rate: > 80%
- Cache speedup: > 1.5x cold start

## Report Generation

### Automated Reports

The benchmark suite generates comprehensive reports:

1. **Detailed JSON Report**: Complete performance metrics and raw data
2. **Markdown Summary**: Human-readable performance analysis
3. **Migration Recommendations**: Production readiness assessment
4. **Execution Summary**: Test environment and configuration details

### Sample Report Output

```markdown
# Performance Benchmark Report

**Assessment:** PASS
**Duration:** 125.3s

## Performance Summary

| Operation | LevelDB | UnifiedJSON | Ratio | Target | Status |
|-----------|---------|-------------|-------|---------|--------|
| Single Read | 12.5ms | 18.7ms | 1.50x | ≤2.0x | ✅ |
| Single Write | 28.3ms | 72.1ms | 2.55x | ≤3.0x | ✅ |
| Bulk Read | 156ms | 203ms | 1.30x | ≤1.5x | ✅ |
| Memory Usage | 45MB | 62MB | 1.38x | ≤1.5x | ✅ |

## Overall Assessment

✅ **PASS** - UnifiedJSON backend meets all performance requirements 
and is ready for production migration.
```

## Production Integration

### CI/CD Integration

```yaml
# Example GitHub Actions workflow
- name: Run Performance Benchmarks
  run: |
    npm run benchmark:quick
    npm run benchmark:memory
  env:
    NODE_OPTIONS: "--expose-gc"
```

### Performance Monitoring

Post-migration monitoring should track:
- Operation latency percentiles
- Error rates by operation type
- Memory usage trends
- Cache hit rates
- File I/O performance

### Alerting Thresholds

- Read latency p95 > 100ms
- Write latency p95 > 200ms  
- Error rate > 1%
- Memory usage > 750MB
- Cache hit rate < 70%

## Troubleshooting

### Common Issues

**High Memory Usage**
```bash
# Enable garbage collection
npm run benchmark:gc

# Reduce dataset size
npm run benchmark:quick
```

**Performance Regression**
```bash
# Run detailed analysis
npm run benchmark -- --verbose

# Focus on specific operations
npm run benchmark:concurrent
npm run benchmark:memory
```

**Test Timeouts**
```bash
# Increase timeout in benchmark config
# Or run smaller test suites
npm run benchmark:quick
```

### Debug Mode

```bash
# Enable debug logging
DEBUG_BENCHMARK=true npm run benchmark

# Verbose output with timing details
npm run benchmark -- --verbose
```

## Development

### Adding New Benchmarks

1. **Create Test Scenario**
```typescript
async runCustomBenchmark(): Promise<void> {
  const benchmark = await this.measureOperation(
    () => this.customOperation(),
    iterations,
    'custom_operation'
  );
  
  this.report.benchmarks.custom = benchmark;
}
```

2. **Add Performance Targets**
```typescript
const PERFORMANCE_TARGETS = {
  // ...existing targets
  custom: 2.0 // Custom operation target ratio
};
```

3. **Update Report Generation**
```typescript
// Add to comparison analysis
this.report.comparison.performanceRatios.custom = customRatio;
this.report.comparison.targetCompliance.custom = customRatio <= PERFORMANCE_TARGETS.custom;
```

### Extending Test Data

```typescript
// Add new production networks
const PRODUCTION_NETWORKS = {
  NEW_NETWORK: { 
    chainId: 12345, 
    name: 'newnetwork', 
    expectedContracts: 5, 
    tier: 'mainnet' 
  }
};
```

## Best Practices

### Performance Testing

1. **Consistent Environment**
   - Use dedicated hardware for benchmarking
   - Disable background processes
   - Run multiple iterations for statistical significance

2. **Realistic Data**
   - Use production-like data volumes
   - Test with actual contract structures
   - Include edge cases and variations

3. **Comprehensive Coverage**
   - Test all critical operation paths
   - Include failure scenarios
   - Validate concurrent access patterns

### Result Interpretation

1. **Statistical Significance**
   - Focus on percentiles (p95, p99) not just averages
   - Consider variance and outliers
   - Run multiple benchmark sessions

2. **Performance Trends**
   - Track performance over time
   - Identify regressions early
   - Correlate with code changes

3. **Production Readiness**
   - All targets must be met consistently
   - Error rates must be acceptable
   - Memory usage must be stable

## Integration Testing

### Validation Against Real Data

```bash
# Test with BSC Testnet data
npm run benchmark:production

# Verify cross-network consistency
npm run benchmark -- --production --verbose
```

### Migration Simulation

The benchmark suite simulates the complete migration process:

1. **Data Population**: Load real production contracts
2. **Operation Simulation**: Execute typical deployment workflows
3. **Performance Validation**: Measure all critical operations
4. **Regression Analysis**: Compare against LevelDB baseline

## Conclusion

The Performance Benchmarking Suite ensures that the UnifiedJSON state management system meets production requirements while maintaining the performance characteristics necessary for the LookCoin deployment infrastructure.

Regular benchmarking should be part of the development workflow to catch performance regressions early and ensure optimal system performance in production.

---

For questions or issues with the benchmarking suite, refer to the troubleshooting section or consult the development team.