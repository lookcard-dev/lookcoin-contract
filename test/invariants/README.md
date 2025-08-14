# LookCoin Invariant Testing Suite

This directory contains comprehensive invariant tests for the LookCoin protocol using Foundry's invariant testing framework.

## Overview

The invariant testing suite validates critical system properties that must always hold true, regardless of the sequence of operations performed on the contracts.

## Files

### Core Test Files

- **`InvariantTests.sol`** - Main Foundry invariant test contract with 14 critical invariants
- **`InvariantHandler.sol`** - Stateful fuzzing handler that performs controlled contract interactions  
- **`InvariantTestRunner.ts`** - TypeScript test runner for advanced testing scenarios

## Invariants Tested

### Supply Invariants
1. **Supply Consistency** - `totalSupply() == totalMinted - totalBurned`
2. **Balance Sum Integrity** - `totalSupply == sum(all balances)`
3. **Supply Cap Enforcement** - `totalSupply <= MAX_SUPPLY (5B)`
4. **Mint-Burn Balance** - `totalMinted >= totalBurned`

### Cross-Chain Invariants
5. **Nonce Consistency** - Cross-chain message nonces are monotonic
6. **Trusted Remote Consistency** - Bidirectional trusted remote configuration

### Fee Invariants  
7. **Fee Collection Accuracy** - Total fees == sum of protocol fees
8. **Fee Distribution Consistency** - Protocol fee distribution is accurate

### Oracle Invariants
9. **Oracle Supply Accuracy** - Oracle supply within tolerance of actual
10. **Chain Supply Consistency** - Sum of chain supplies == total supply

### Access Control Invariants
11. **Role-Based Access Integrity** - Only authorized roles can perform operations
12. **Role Hierarchy Consistency** - Admin roles properly configured

### State Invariants
13. **Contract State Consistency** - No inconsistent contract states
14. **Storage Integrity** - Critical storage variables remain consistent

## Running Tests

### Foundry Invariant Tests

```bash
# Run all invariant tests
forge test --match-contract InvariantTests -vvv

# Run with specific profile
forge test --match-contract InvariantTests --fuzz-runs 10000 -vvv

# Run intensive testing
forge test --match-contract InvariantTests --fuzz-runs 50000 --invariant-depth 100 -vvv
```

### TypeScript Test Runner

```bash
# Run with different profiles
npx tsx test/invariants/InvariantTestRunner.ts quick      # 100 runs, 1 minute
npx tsx test/invariants/InvariantTestRunner.ts standard   # 1000 runs, 5 minutes  
npx tsx test/invariants/InvariantTestRunner.ts thorough   # 5000 runs, 20 minutes
npx tsx test/invariants/InvariantTestRunner.ts stress     # 10000 runs, 1 hour
```

## Test Configuration

### Foundry Configuration
The tests use the following Foundry configuration profiles:

- **Default**: 1000 runs, depth 20
- **CI**: 10000 runs, depth 20, fail_on_revert=true
- **Intense**: 50000 runs, depth 50

### Test Actors
The handler creates 10 test actors that perform various operations:
- Minting operations (with role checks)
- Burning operations (with balance checks)
- Token transfers
- Cross-chain operations
- Oracle updates
- Access control tests

## Architecture

### Handler Design
The `InvariantHandler` implements controlled fuzzing by:
- Bounding all inputs to realistic ranges
- Checking permissions before operations
- Tracking system state changes
- Recording ghost variables for verification

### Ghost Variables
The handler tracks these ghost variables:
- `ghost_totalMinted` - Total tokens minted
- `ghost_totalBurned` - Total tokens burned  
- `ghost_totalTransfers` - Number of transfers
- `ghost_crossChainMessages` - Cross-chain messages sent
- `ghost_oracleUpdates` - Oracle updates performed

## Expected Results

All invariants should **PASS** under normal conditions. Failures indicate:
- Critical bugs in contract logic
- Missing access controls
- Cross-chain inconsistencies
- Oracle miscalculations
- Storage corruption

## Debugging Invariant Failures

### Common Issues
1. **Supply Consistency Failures** - Check minting/burning logic
2. **Balance Sum Mismatches** - Verify transfer implementations
3. **Cross-Chain Failures** - Check LayerZero integration
4. **Access Control Failures** - Review role assignments

### Debug Commands
```bash
# Check all invariants manually
forge test --match-test checkAllInvariants -vvv

# Enable handler debugging
forge test --match-contract InvariantTests -vvvv
```

## Integration with CI/CD

The invariant tests should be run as part of the CI pipeline:

```yaml
- name: Run Invariant Tests
  run: |
    forge test --match-contract InvariantTests --fuzz-runs 1000
    npx tsx test/invariants/InvariantTestRunner.ts quick
```

## Performance Considerations

- **Quick Profile**: ~1 minute, suitable for development
- **Standard Profile**: ~5 minutes, suitable for CI
- **Thorough Profile**: ~20 minutes, suitable for releases
- **Stress Profile**: ~1 hour, suitable for comprehensive testing

## Reports

Test results are automatically generated in:
- `reports/invariants/` - JSON and HTML reports
- Console output with detailed statistics
- Gas usage analysis
- Coverage metrics

## Maintenance

### Adding New Invariants
1. Add invariant function to `InvariantTests.sol`
2. Update handler if needed for new operations
3. Add TypeScript test case if complex logic required
4. Update this README with new invariant description

### Updating Handlers
When contracts change:
1. Update handler operations to match new interfaces
2. Adjust bounds and limits for realistic testing
3. Add new ghost variables if needed
4. Update role checks for new permissions

## Security Considerations

These invariant tests are critical for:
- **Financial Security** - Ensuring supply integrity
- **Cross-Chain Safety** - Validating bridge operations
- **Access Control** - Preventing unauthorized actions
- **Upgrade Safety** - Ensuring state consistency

**⚠️ Warning**: Invariant failures should be treated as critical security issues requiring immediate investigation.