# LookCoin Test Fix Implementation Plan

## Executive Summary

**Current State**: 213 failing tests (44% failure rate) across systematic infrastructure and interface issues  
**Target State**: <10 failing tests (>98% pass rate) within 15 days  
**Approach**: 3-phase implementation with clear dependencies and validation gates

## Implementation Phases

### Phase 1: Critical Foundation Fixes (Days 1-5) 🔴
**Objective**: Restore basic test infrastructure to enable remaining fixes  
**Target**: Reduce failures from 213 to <100

#### Task 1.1: Mock Contract Infrastructure (3 days)
**Priority**: CRITICAL - Blocks 150+ tests  
**Assignee**: Agent 1 (Infrastructure)

```bash
# Create comprehensive mock deployment script
touch scripts/test/deploy-mock-infrastructure.ts

# Required mock contracts:
- MockLayerZeroEndpoint with DVN support
- MockCelerMessageBus with fee calculation  
- MockHyperlaneMailbox with ISM validation
- MockGovernance with full RBAC implementation
- MockTimelock with proposal/execution cycle
```

**Deliverables**:
- [ ] `contracts/mocks/LayerZeroMocks.sol` - Complete LZ infrastructure
- [ ] `contracts/mocks/CelerMocks.sol` - Message bus and fee manager
- [ ] `contracts/mocks/HyperlaneMocks.sol` - Mailbox and ISM contracts  
- [ ] `contracts/mocks/GovernanceMocks.sol` - Timelock + multi-sig
- [ ] `scripts/test/deploy-mock-infrastructure.ts` - Automated deployment
- [ ] `test/helpers/mock-setup.ts` - Reusable mock utilities

**Validation**:
```bash
npm run test:helpers # All helper tests pass
npm run test:unit -- --grep "Mock" # Mock tests pass
```

#### Task 1.2: Interface Disambiguation (1 day)  
**Priority**: CRITICAL - Blocks 50+ tests  
**Assignee**: Agent 2 (Interfaces)

**Root Cause**: Multiple `burn()` function signatures causing ethers.js ambiguity
```solidity
// Current problematic signatures:
burn(uint256 amount)           // ERC20 standard burn
burn(address account, uint256 amount)  // Burn from account
```

**Solution**: Use explicit function selectors in tests
```typescript
// Instead of: contract.burn(amount)
// Use: contract["burn(uint256)"](amount) 
// Or: contract["burn(address,uint256)"](account, amount)
```

**Files to Fix**:
- [ ] `test/unit/LookCoin.test.ts` - Fix all burn() calls
- [ ] `test/integration/*` - Update burn usage  
- [ ] `test/helpers/utils.ts` - Add disambiguation helpers
- [ ] Consider: Rename functions to eliminate ambiguity

**Validation**:
```bash
npm run test:unit -- --grep "burn" # No ambiguity errors
```

#### Task 1.3: SupplyOracle Nonce Management (1 day)
**Priority**: CRITICAL - Blocks 30+ tests  
**Assignee**: Agent 3 (Oracle)

**Root Cause**: Test scenarios don't properly manage oracle nonce progression

**Solution**: Implement test-specific nonce management
```typescript
// Add to test helpers:
class TestOracle {
  private nonce = 1;
  
  async getNextNonce(): Promise<number> {
    return this.nonce++;
  }
  
  async resetNonce(): Promise<void> {
    this.nonce = 1;
  }
}
```

**Files to Fix**:
- [ ] `test/helpers/oracle-utils.ts` - Nonce management utilities
- [ ] `test/unit/SupplyOracle.test.ts` - Fix all nonce-related tests
- [ ] `contracts/mocks/MockSupplyOracle.sol` - Add nonce reset functionality

**Validation**:
```bash
npm run test:unit -- --grep "SupplyOracle" # No nonce errors
```

### Phase 2: Core Functionality Restoration (Days 6-10) 🟡
**Objective**: Restore bridge operations and security testing  
**Target**: Reduce failures from <100 to <30

#### Task 2.1: Bridge Protocol Integration (2 days)
**Priority**: HIGH - Enables cross-chain testing  
**Assignee**: Agent 1 (Bridges)

**LayerZero Integration**:
```typescript
// Required DVN configuration for tests
const testDvnConfig = {
  sendUln: "0x...", // Mock ULN address
  receiveUln: "0x...", // Mock ULN address  
  sendExecutor: "0x...", // Mock executor
  receiveExecutor: "0x...", // Mock executor
  dvns: ["0x...", "0x..."] // Mock DVN addresses
};
```

**Celer IM Integration**:
```solidity
// MockMessageBus needs:
- calculateFee() implementation
- sendMessage() with callback  
- executeMessage() with validation
- Proper fee calculation (0.5% base + gas)
```

**Files to Create/Fix**:
- [ ] `contracts/mocks/LayerZeroMocks.sol` - Complete with DVN support
- [ ] `contracts/mocks/CelerMocks.sol` - Message bus with fees
- [ ] `test/unit/LayerZeroModule.test.ts` - Fix configuration tests
- [ ] `test/unit/CelerIMModule.test.ts` - Fix message flow tests

**Validation**:
```bash
npm run test:unit -- --grep "Bridge|Module" # Bridge tests pass
```

#### Task 2.2: Security Test Restoration (2 days)
**Priority**: HIGH - Critical for audit readiness  
**Assignee**: Agent 2 (Security)

**Access Control Fixes**:
```solidity
// MockGovernance must implement:
- DEFAULT_ADMIN_ROLE management
- MINTER_ROLE assignment  
- BURNER_ROLE assignment
- Proper role hierarchy
```

**Economic Attack Simulation**:
```typescript
// Required mock contracts:
- MockDEX (for MEV simulation)
- MockFlashLoan (for flash loan attacks)  
- MockMempool (for front-running tests)
```

**Files to Fix**:
- [ ] `contracts/mocks/SecurityMocks.sol` - Attack simulation contracts
- [ ] `test/security/EconomicAttackTests.test.ts` - Fix attack scenarios
- [ ] `test/security/SimpleEconomicAttackTests.test.ts` - Basic attack tests
- [ ] `test/unit/SecurityManager.test.ts` - Access control tests

**Validation**:
```bash
npm run test:security # Security tests pass
npm run test:unit -- --grep "Security|Access" # Access control tests pass
```

#### Task 2.3: Integration Test Completion (1 day)
**Priority**: HIGH - End-to-end validation  
**Assignee**: Agent 3 (Integration)

**Deployment Flow Tests**:
- Fix "before each" hook failures
- Complete contract deployment sequence
- Validate configuration steps

**Cross-Chain Transfer Tests**:
- Implement multi-network simulation
- Fix bridge protocol switching
- Validate fee calculations

**Files to Fix**:
- [ ] `test/integration/DeploymentFlow.test.ts` - Fix deployment hooks
- [ ] `test/integration/CrossChainTransfers.test.ts` - Fix bridge flows
- [ ] `test/integration/GovernanceFlow.test.ts` - Fix governance tests

**Validation**:
```bash
npm run test:integration # Integration tests pass
```

### Phase 3: Optimization & Edge Cases (Days 11-15) 🟢
**Objective**: Complete testing infrastructure and edge case coverage  
**Target**: <10 failing tests (cosmetic only)

#### Task 3.1: Performance Test Infrastructure (2 days)
**Priority**: MEDIUM - Performance validation  
**Assignee**: Agent 4 (Performance)

**Gas Tracking Fixes**:
```typescript
// Implement consistent gas measurement
class GasTracker {
  private measurements: Map<string, number[]> = new Map();
  
  async measureGas(operation: string, tx: Promise<any>): Promise<number> {
    const receipt = await (await tx).wait();
    const gasUsed = receipt.gasUsed;
    this.recordMeasurement(operation, gasUsed);
    return gasUsed;
  }
}
```

**Load Test Infrastructure**:
- Fix high-concurrency test scenarios
- Implement proper async handling
- Add memory usage tracking

**Files to Fix**:
- [ ] `test/performance/GasOptimizationBenchmarks.test.ts` - Fix gas tracking
- [ ] `test/performance/LoadTests.test.ts` - Fix concurrency issues
- [ ] `test/helpers/performance-utils.ts` - Gas and perf utilities

**Validation**:
```bash
npm run test:performance # Performance tests pass
npm run benchmark # Gas benchmarks functional
```

#### Task 3.2: Upgrade Test Completion (2 days)
**Priority**: MEDIUM - Future upgrade safety  
**Assignee**: Agent 1 (Upgrades)

**UUPS Upgrade Tests**:
```solidity
// MockUpgradeTarget must implement:
contract MockUpgradeTarget is UUPSUpgradeable {
    function _authorizeUpgrade(address) internal override {
        // Test-specific authorization
    }
    
    function validateRollbackCompatibility() external pure returns (bool) {
        // Rollback validation logic
    }
}
```

**Storage Collision Detection**:
- Implement storage layout analysis
- Add collision detection utilities
- Test upgrade compatibility validation

**Files to Fix**:
- [ ] `contracts/mocks/UpgradeMocks.sol` - Complete upgrade targets
- [ ] `test/upgrades/UpgradeMigrationTests.test.ts` - Fix all upgrade tests
- [ ] `test/helpers/upgrade-utils.ts` - Upgrade testing utilities

**Validation**:
```bash
npm run test:upgrades # Upgrade tests pass
```

#### Task 3.3: Edge Case Coverage (1 day)
**Priority**: LOW - Robustness validation  
**Assignee**: Agent 2 (Edge Cases)

**Protocol-Specific Edge Cases**:
- Complete LayerZero edge scenarios
- Fix Celer IM edge cases  
- Add Hyperlane boundary tests

**Extreme Value Testing**:
- Test maximum supply values
- Validate boundary conditions
- Test error message accuracy

**Files to Fix**:
- [ ] `test/protocols/LayerZeroEdgeCases.test.ts` - Complete edge cases
- [ ] `test/protocols/CelerEdgeCases.test.ts` - Fix Celer edge cases
- [ ] `test/protocols/HyperlaneEdgeCases.test.ts` - Add Hyperlane tests

**Validation**:
```bash
npm run test:protocols # Protocol edge cases pass
npm test # Full suite >98% pass rate
```

## Daily Implementation Schedule

### Week 1: Foundation & Core (Days 1-7)

#### Day 1 (Monday): Infrastructure Start
- **AM**: Set up mock contract structure
- **PM**: Begin LayerZero mock implementation

#### Day 2 (Tuesday): Infrastructure Continue  
- **AM**: Complete LayerZero mocks
- **PM**: Implement Celer IM mocks

#### Day 3 (Wednesday): Infrastructure Complete
- **AM**: Add governance mocks
- **PM**: Interface disambiguation fixes

#### Day 4 (Thursday): Oracle & Integration Start
- **AM**: SupplyOracle nonce management
- **PM**: Begin bridge integration tests

#### Day 5 (Friday): Core Functionality
- **AM**: Complete bridge protocol tests
- **PM**: Start security test restoration

#### Day 6 (Saturday): Security Focus
- **AM**: Access control fixes
- **PM**: Economic attack simulations

#### Day 7 (Sunday): Integration Complete
- **AM**: Fix deployment flow tests
- **PM**: Complete cross-chain transfer tests

### Week 2: Optimization & Completion (Days 8-14)

#### Days 8-9: Performance Infrastructure
- Gas tracking implementation
- Load test fixes
- Benchmark restoration

#### Days 10-11: Upgrade Testing  
- UUPS upgrade mock contracts
- Storage collision detection
- Migration procedure tests

#### Days 12-13: Edge Case Coverage
- Protocol-specific edge cases
- Extreme value testing
- Error message validation

#### Day 14: Final Validation
- Full test suite execution
- Regression testing
- Documentation updates

## Risk Mitigation & Contingency Planning

### High-Risk Dependencies
1. **Mock Infrastructure Complexity**: LayerZero and Celer mocks are complex
   - **Mitigation**: Start with minimal viable mocks, iterate
   - **Contingency**: Focus on most critical test scenarios first

2. **Interface Changes**: Disambiguation may require contract changes
   - **Mitigation**: Prefer test-side fixes over contract changes
   - **Contingency**: Use explicit function selectors

3. **Cross-Chain Simulation**: Multi-network testing is complex
   - **Mitigation**: Use simplified mock networks
   - **Contingency**: Focus on single-chain tests first

### Quality Assurance

#### Daily Checkpoints
```bash
# Run before each commit
npm run test:critical  # Must pass for each day's work

# Track progress daily  
npm test 2>&1 | grep -E "(\d+ passing|\d+ failing)" >> progress.log
```

#### Weekly Reviews
- Phase completion validation
- Regression detection
- Progress vs timeline assessment
- Risk reassessment

### Success Criteria

#### Phase Gate Requirements
- **Phase 1 Exit**: <100 failing tests, infrastructure functional
- **Phase 2 Exit**: <30 failing tests, core operations working  
- **Phase 3 Exit**: <10 failing tests, full suite functional

#### Production Readiness
- [ ] >98% test pass rate
- [ ] All critical paths tested
- [ ] Performance baselines established  
- [ ] Security validations complete
- [ ] Upgrade procedures tested
- [ ] Documentation updated

---

**Plan Created**: August 14, 2025  
**Target Completion**: August 29, 2025  
**Review Schedule**: Weekly (Aug 21, Aug 28)  
**Status**: Ready for implementation