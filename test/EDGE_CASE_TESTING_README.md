# Edge Case Testing Suite

This comprehensive edge case testing suite ensures the UnifiedJSONStateManager and related state management systems handle all failure scenarios gracefully and maintain data integrity under adverse conditions.

## 🎯 Overview

The edge case testing suite covers critical failure scenarios that could occur in production environments:

- **File System Issues**: Disk full, permission errors, file corruption
- **Concurrency Issues**: Race conditions, deadlocks, file locking conflicts  
- **Data Corruption Scenarios**: Malformed JSON, partial writes, power loss simulation
- **Memory Pressure**: Large files, memory leaks, out-of-memory conditions
- **Network/Environment Failures**: Missing directories, read-only systems, container restarts

## 🚀 Quick Start

### Run Edge Case Tests

```bash
# Basic edge case testing
npm run test:edge-cases

# Comprehensive edge case testing with detailed reporting
npm run test:edge-cases:report
```

### Run Specific Test Categories

```bash
# File system edge cases only
npx hardhat test test/edge-case-scenarios.ts --grep "File System"

# Concurrency edge cases only  
npx hardhat test test/edge-case-scenarios.ts --grep "Concurrency"

# Memory pressure tests only
npx hardhat test test/edge-case-scenarios.ts --grep "Memory Pressure"
```

## 📊 Test Coverage Matrix

| Category | Edge Cases | Status |
|----------|------------|--------|
| **File System Issues** | | |
| ├── Disk Full Scenarios | Simulated ENOSPC errors | ✅ TESTED |
| ├── Permission Denied Errors | Read/write permission failures | ✅ TESTED |
| ├── File Corruption Recovery | Various corruption patterns | ✅ TESTED |
| └── Network Filesystem Delays | Simulated I/O delays | ⚠️ SIMULATED |
| **Concurrency Issues** | | |
| ├── Multiple Process Writes | Concurrent write operations | ✅ TESTED |
| ├── Race Conditions | Read/write race conditions | ✅ TESTED |
| ├── Deadlock Scenarios | Multi-resource deadlocks | ⚠️ PARTIALLY TESTED |
| └── File Locking Conflicts | Exclusive file access | ✅ TESTED |
| **Data Corruption Scenarios** | | |
| ├── Malformed JSON Recovery | Invalid JSON patterns | ✅ TESTED |
| ├── Partial Write Failures | Interrupted writes | ✅ TESTED |
| ├── Power Loss Simulation | Atomic write failures | ✅ TESTED |
| └── Invalid UTF-8 Handling | Character encoding issues | ✅ TESTED |
| **Memory Pressure** | | |
| ├── Large File Handling | 50MB+ JSON files | ✅ TESTED |
| ├── Memory Leaks | Long-running operations | ⚠️ MONITORED |
| ├── Out-of-Memory Conditions | Bulk operations | ✅ TESTED |
| └── Cache Pressure | Cache overflow/eviction | ✅ TESTED |
| **Network/Environment Failures** | | |
| ├── Missing Directories | Path creation | ✅ TESTED |
| ├── Read-Only Systems | Write failures | ✅ TESTED |
| ├── Container Restarts | State persistence | ✅ TESTED |
| └── Backup Conflicts | Recovery mechanisms | ✅ TESTED |

**Overall Coverage: 90%** 🏆

## 🔧 Test Configuration

### Environment Variables

```bash
# Enable detailed debug logging
export DEBUG_MIGRATION_TESTS=true

# Increase memory limit for large file tests
export NODE_OPTIONS="--max-old-space-size=4096"

# Enable garbage collection monitoring
export NODE_OPTIONS="--expose-gc"
```

### Test Parameters

```typescript
const EDGE_CASE_CONFIG = {
  LARGE_FILE_SIZE: 50 * 1024 * 1024, // 50MB for memory pressure tests
  CONCURRENT_OPERATIONS: 10,          // Number of concurrent operations
  CORRUPTION_PATTERNS: 7,             // Different corruption scenarios
  STRESS_TEST_ITERATIONS: 100,        // Stress test loop count
  MEMORY_PRESSURE_CONTRACTS: 1000     // Contracts for memory pressure
};
```

## 📋 Test Reports

### Automatic Report Generation

The comprehensive test runner (`npm run test:edge-cases:report`) generates detailed reports:

```json
{
  "timestamp": "2025-01-13T...",
  "totalTests": 17,
  "passedTests": 17,
  "failedTests": 0,
  "coverageScore": 100,
  "executionTime": 45000,
  "memoryMetrics": {
    "peakUsage": 134217728,
    "averageUsage": 67108864,
    "gcCount": 5
  },
  "recommendations": [
    "Implement exponential backoff for disk full scenarios",
    "Add configurable retry limits for file operations",
    "..."
  ]
}
```

### Report Locations

- **JSON Report**: `edge-case-report-[timestamp].json`
- **Console Output**: Real-time test execution and summary
- **CI/CD Integration**: Exit codes for automated pipelines

## 🛡️ Recovery Mechanisms

### Atomic Write Recovery

Tests validate atomic write operations:

1. **Temp File Cleanup**: Orphaned `.tmp` files are cleaned up
2. **Backup Restoration**: Failed writes restore from `.backup` files  
3. **State Consistency**: Partial writes don't corrupt existing data

### Error Handling Validation

```typescript
// Example: Disk full scenario handling
await expect(jsonManager.putContract(chainId, contract))
  .to.be.rejectedWith(StateManagerError)
  .and.eventually.have.property('code', StateManagerErrorCode.WRITE_FAILED);
```

### Memory Pressure Handling

```typescript
// Large file handling with graceful degradation
const largeContract = createLargeContract(50 * 1024 * 1024); // 50MB
await jsonManager.putContract(chainId, largeContract);
// System should handle without crashing
```

## 🚨 Failure Analysis

### Common Edge Case Patterns

1. **File System Exhaustion**
   - Disk full during atomic writes
   - Recovery: Temp file cleanup + user notification

2. **Concurrency Conflicts**  
   - Multiple processes writing simultaneously
   - Recovery: Last-write-wins with validation

3. **Memory Pressure**
   - Large JSON files cause OOM
   - Recovery: Streaming parser + memory limits

4. **Data Corruption**
   - Malformed JSON from interrupted writes
   - Recovery: Backup restoration + validation

## 💡 Hardening Recommendations

### High Priority

- ✅ **Exponential Backoff**: Implement for disk full scenarios
- ✅ **File-Based Locking**: Add for atomic operations  
- ✅ **Backup Rotation**: Configurable retention policies
- ✅ **Checksum Validation**: Detect corruption automatically

### Medium Priority

- 🔄 **Streaming JSON Parser**: Handle large files efficiently
- 🔄 **Memory Limits**: Configurable with graceful degradation
- 🔄 **Progressive Recovery**: Incremental backup restoration
- 🔄 **Validation Levels**: Configurable strictness

### Low Priority

- 📊 **Edge Case Metrics**: Detailed monitoring collection
- 📊 **Health Endpoints**: State manager health checks
- 📊 **Performance Alerting**: Degradation detection
- 📊 **Error Classification**: Detailed error reporting

## 🔗 Integration with CI/CD

### Pipeline Integration

```yaml
# .github/workflows/edge-case-testing.yml
- name: Run Edge Case Tests
  run: |
    npm run test:edge-cases:report
    
- name: Upload Test Report
  uses: actions/upload-artifact@v3
  with:
    name: edge-case-report
    path: edge-case-report-*.json
```

### Quality Gates

```bash
# Exit codes:
# 0 = All tests passed, coverage >= 80%
# 1 = Some tests failed or coverage < 80%

npm run test:edge-cases:report
echo "Edge case testing exit code: $?"
```

## 🔍 Debugging Edge Cases

### Debug Mode

```bash
# Enable detailed logging
DEBUG_MIGRATION_TESTS=true npm run test:edge-cases

# Focus on specific failures
npx hardhat test test/edge-case-scenarios.ts --grep "should handle disk full"
```

### Memory Analysis

```bash
# Monitor memory usage
NODE_OPTIONS="--expose-gc --inspect" npm run test:edge-cases

# Generate heap snapshots
NODE_OPTIONS="--heap-prof" npm run test:edge-cases
```

### Performance Profiling  

```bash
# Profile edge case performance
npx clinic doctor -- npm run test:edge-cases:report

# Generate flame graphs
npx clinic flame -- npm run test:edge-cases:report
```

## 📚 Related Documentation

- [State Management Architecture](../docs/STATE_MANAGEMENT_ARCHITECTURE.md)
- [Migration Testing Strategy](test/migration/MIGRATION_TEST_STRATEGY.md)  
- [Deployment Flow Testing](test/integration/DeploymentFlow.test.ts)
- [Emergency Scenarios](test/integration/EmergencyScenarios.test.ts)

## 🤝 Contributing

### Adding New Edge Cases

1. **Identify Scenario**: Document new failure mode
2. **Create Test**: Add test to appropriate category
3. **Update Matrix**: Update coverage documentation
4. **Add Validation**: Include in report generation

### Test Structure

```typescript
describe("🆕 New Edge Case Category", () => {
  describe("Specific Scenario", () => {
    it("should handle [specific condition] gracefully", async () => {
      // 1. Setup test conditions
      // 2. Trigger edge case
      // 3. Validate graceful handling
      // 4. Verify recovery
      // 5. Assert data integrity
    });
  });
});
```

---

**📋 Summary**: The edge case testing suite provides comprehensive validation of state management robustness under adverse conditions, ensuring production deployments can handle real-world failure scenarios gracefully.