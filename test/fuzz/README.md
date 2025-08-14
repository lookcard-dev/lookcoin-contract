# LookCoin Fuzz Testing Suite

This directory contains comprehensive fuzz testing infrastructure for the LookCoin smart contract, utilizing Foundry's native fuzzing capabilities to validate security properties and detect vulnerabilities under random inputs.

## Overview

The fuzz testing suite implements multiple testing strategies:

- **Property-based testing** - Validates contract invariants
- **Differential fuzzing** - Compares behavior across implementations
- **Coverage-guided fuzzing** - Maximizes code path exploration
- **Targeted vulnerability detection** - Focuses on known attack vectors

## Test Files

### 1. FuzzTests.sol
Main fuzz testing contract with comprehensive test coverage:

- **Input boundary fuzzing** - Tests external function parameters
- **State transition fuzzing** - Validates state changes under random conditions
- **Cross-contract interaction fuzzing** - Tests integration with other contracts
- **Time-based operation fuzzing** - Validates time-dependent functionality
- **Role permission matrix fuzzing** - Tests access control mechanisms
- **Protocol parameter fuzzing** - Validates configuration changes
- **Invariant testing** - Ensures critical properties always hold

### 2. FuzzTargets.sol
Specialized contract for targeted vulnerability testing:

- **Critical function targets** - Focuses on high-risk functions
- **Reentrancy testing** - Detects reentrancy vulnerabilities
- **State corruption detection** - Identifies state inconsistencies
- **Access control bypass attempts** - Tests privilege escalation
- **Arithmetic edge cases** - Detects overflow/underflow issues
- **Gas limit testing** - Validates gas consumption patterns

### 3. FuzzTestRunner.ts
TypeScript orchestrator for comprehensive testing campaigns:

- **Multiple test profiles** - Quick, standard, intensive, and extreme
- **Automated reporting** - JSON and Markdown reports
- **Coverage analysis** - Tracks test coverage metrics
- **Vulnerability detection** - Identifies and reports security issues
- **Performance tracking** - Monitors test execution metrics

## Usage

### Quick Start

```bash
# Run standard fuzz testing campaign
npm run fuzz

# Run quick tests (1K runs)
npm run fuzz:quick

# Run intensive tests (50K runs)
npm run fuzz:intensive

# Run extreme tests (100K runs)
npm run fuzz:extreme
```

### Targeted Testing

```bash
# Run targeted vulnerability detection
npm run fuzz:targeted

# Run differential fuzzing
npm run fuzz:differential

# Run comprehensive testing (all modes)
npm run fuzz:all
```

### Direct Forge Commands

```bash
# Basic fuzz tests
npm run test:fuzz

# Quick fuzz tests
npm run test:fuzz:quick

# Invariant-only testing
npm run test:fuzz:invariants

# Vulnerability targets
npm run test:fuzz:targets

# Specific test categories
npm run test:fuzz:boundaries
npm run test:fuzz:transitions
npm run test:fuzz:interactions
npm run test:fuzz:permissions
```

### Coverage Analysis

```bash
# Generate fuzz test coverage
npm run test:fuzz:coverage
```

## Test Profiles

### Quick Profile (1K runs, 5 minutes)
- **Use case**: Development and CI/CD
- **Runs**: 1,000 per test
- **Depth**: 10 call stack levels
- **Timeout**: 5 minutes

### Standard Profile (10K runs, 30 minutes)
- **Use case**: Regular security validation
- **Runs**: 10,000 per test
- **Depth**: 20 call stack levels
- **Timeout**: 30 minutes

### Intensive Profile (50K runs, 1 hour)
- **Use case**: Pre-deployment security audit
- **Runs**: 50,000 per test
- **Depth**: 50 call stack levels
- **Timeout**: 1 hour

### Extreme Profile (100K runs, 2 hours)
- **Use case**: Comprehensive security validation
- **Runs**: 100,000 per test
- **Depth**: 100 call stack levels
- **Timeout**: 2 hours

## Security Properties Tested

### Core Invariants
1. **Supply Consistency**: `totalSupply == totalMinted - totalBurned`
2. **Maximum Supply**: `totalSupply <= MAX_SUPPLY`
3. **Balance Limits**: `individual_balance <= totalSupply`
4. **ERC20 Compliance**: Standard token properties
5. **Admin Role Persistence**: Admin role always maintained

### Vulnerability Classes
- **Reentrancy attacks** - Via external calls and callbacks
- **Integer overflow/underflow** - Arithmetic edge cases
- **Access control bypasses** - Unauthorized function access
- **State corruption** - Inconsistent internal state
- **Gas limit attacks** - DoS via gas consumption
- **Front-running vulnerabilities** - MEV and transaction ordering
- **Cross-chain message manipulation** - LayerZero attack vectors

### Edge Cases Tested
- Zero address interactions
- Maximum uint256 values
- Empty and malformed data
- Extreme gas limits
- Time-based edge cases
- Role transition scenarios
- Protocol parameter boundaries

## Output and Reporting

### Console Output
Real-time progress with color-coded results:
- ✅ **Green**: Tests passing, no issues
- ⚠️  **Yellow**: Warnings or edge cases
- ❌ **Red**: Failures or vulnerabilities
- 🚨 **Critical**: Security violations detected

### Generated Reports

#### JSON Report (`reports/fuzz/fuzz-report-[timestamp].json`)
```json
{
  "timestamp": "2024-01-01T00:00:00Z",
  "configuration": { /* test config */ },
  "summary": {
    "totalRuns": 100000,
    "totalFailures": 0,
    "totalVulnerabilities": 0,
    "successRate": 100.0
  },
  "coverage": { /* coverage metrics */ },
  "results": [ /* detailed results */ ],
  "recommendations": [ /* security recommendations */ ]
}
```

#### Markdown Report (`reports/fuzz/fuzz-report-[timestamp].md`)
Human-readable report with:
- Executive summary
- Coverage analysis
- Detailed test results
- Security recommendations
- Next steps

### Coverage Metrics
- **Contracts covered**: Core contracts tested
- **Functions covered**: Individual function hit count
- **Branch coverage**: Percentage of code paths executed
- **Statement coverage**: Line-by-line execution tracking

## Integration with CI/CD

### GitHub Actions Example
```yaml
- name: Run Fuzz Tests
  run: |
    npm install
    npm run fuzz:quick
    
- name: Upload Fuzz Reports
  uses: actions/upload-artifact@v3
  with:
    name: fuzz-reports
    path: reports/fuzz/
```

### Pre-deployment Checklist
1. ✅ Run intensive fuzz testing (`npm run fuzz:intensive`)
2. ✅ Verify zero vulnerabilities detected
3. ✅ Confirm all invariants hold
4. ✅ Review detailed security report
5. ✅ Address any recommendations

## Advanced Configuration

### Custom Fuzz Parameters
Modify `foundry.toml` for custom configurations:

```toml
[fuzz]
runs = 50000                # Number of fuzz runs
max_test_rejects = 100000   # Maximum rejected inputs
seed = "0x42"               # Deterministic seed

[invariant]
runs = 10000                # Invariant test runs
depth = 50                  # Call stack depth
fail_on_revert = false      # Continue on reverts
```

### Environment Variables
- `FUZZ_RUNS`: Override default run count
- `FUZZ_SEED`: Set deterministic seed
- `FUZZ_TIMEOUT`: Custom timeout (milliseconds)

## Troubleshooting

### Common Issues

#### High Memory Usage
```bash
# Reduce runs for memory-constrained environments
FUZZ_RUNS=1000 npm run fuzz
```

#### Timeout Issues
```bash
# Increase timeout for complex tests
FUZZ_TIMEOUT=7200000 npm run fuzz:intensive
```

#### Coverage Issues
```bash
# Generate detailed coverage report
forge coverage --report debug
```

### Debug Mode
Enable verbose logging:
```bash
DEBUG=true npm run fuzz
```

## Contributing

### Adding New Fuzz Tests
1. Add test function to `FuzzTests.sol` with `testFuzz_` prefix
2. Include appropriate bounds and assumptions
3. Add invariant checks
4. Update documentation

### Adding Vulnerability Targets
1. Add target function to `FuzzTargets.sol` with `fuzzTarget_` prefix
2. Include specific vulnerability scenarios
3. Add event logging for analysis
4. Update test runner categories

### Performance Optimization
- Use `vm.assume()` to filter invalid inputs early
- Implement proper bounds to reduce rejected runs
- Cache expensive operations
- Profile gas usage regularly

## Security Considerations

### Test Isolation
- Each test runs in isolated environment
- State is reset between test runs
- No cross-test contamination

### Deterministic Testing
- Seeds can be fixed for reproducible results
- Critical for debugging specific failures
- Essential for CI/CD consistency

### Production Safety
- Fuzz tests use mock contracts where appropriate
- No real funds or mainnet interactions
- Isolated test environments only

## Performance Metrics

### Typical Execution Times
- **Quick**: 2-5 minutes
- **Standard**: 15-30 minutes  
- **Intensive**: 45-90 minutes
- **Extreme**: 2-4 hours

### Resource Requirements
- **RAM**: 4-8GB recommended
- **CPU**: Multi-core preferred for parallel execution
- **Storage**: 1GB for reports and cache

---

## Support

For questions or issues with fuzz testing:

1. Check existing test results in `reports/fuzz/`
2. Review Foundry documentation for fuzzing
3. Examine similar patterns in existing tests
4. Create detailed issue with reproduction steps

**Happy Fuzzing! 🔍✨**