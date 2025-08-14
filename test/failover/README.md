# Infrastructure Failure Recovery Testing

This directory contains comprehensive infrastructure failure recovery tests for the LookCoin contract system. The tests validate system resilience, recovery procedures, and adherence to Recovery Time Objectives (RTO) and Recovery Point Objectives (RPO).

## Overview

The failover testing infrastructure simulates realistic infrastructure failures and validates the system's ability to detect, respond to, and recover from various failure scenarios while maintaining data integrity and service availability.

## Architecture

### Core Components

1. **FailureSimulator.sol** - Mock contract for simulating infrastructure failures
2. **InfrastructureFailureTests.test.ts** - Comprehensive failure scenario testing
3. **RecoveryProcedures.test.ts** - RTO/RPO validation and recovery metrics
4. **FailureSimulator.test.ts** - Basic functionality validation

### Failure Categories Tested

#### 1. Oracle Network Partition Recovery
- **Scenarios**: Network partitions affecting oracle consensus
- **Recovery**: Automatic failover and consensus restoration
- **RTO Target**: 5 minutes (Critical)
- **RPO Target**: 1 minute (Critical)

#### 2. Bridge Module Total Failure
- **Scenarios**: Complete protocol failures and cascading failures
- **Recovery**: Multi-protocol failover and service restoration
- **RTO Target**: 15 minutes (High Priority)
- **RPO Target**: 5 minutes (High Priority)

#### 3. RPC Endpoint Cascade Failures
- **Scenarios**: Progressive RPC endpoint failures
- **Recovery**: Automatic endpoint failover and load balancing
- **RTO Target**: 15 minutes (High Priority)
- **RPO Target**: 5 minutes (High Priority)

#### 4. Multi-Region Coordination Failures
- **Scenarios**: Regional isolation and split-brain scenarios
- **Recovery**: Geographic failover and coordination restoration
- **RTO Target**: 30 minutes (Medium Priority)
- **RPO Target**: 15 minutes (Medium Priority)

#### 5. Validator Set Corruption
- **Scenarios**: Validator corruption below and above safety thresholds
- **Recovery**: Validator set restoration and emergency procedures
- **RTO Target**: 5 minutes (Critical)
- **RPO Target**: 1 minute (Critical)

#### 6. Emergency Migration Procedures
- **Scenarios**: Complete system migration under emergency conditions
- **Recovery**: Automated migration with data preservation
- **RTO Target**: 5 minutes (Critical)
- **RPO Target**: 1 minute (Critical)

## Service Level Objectives (SLOs)

### Recovery Time Objectives (RTO)
- **Critical**: 5 minutes - Core consensus and security functions
- **High**: 15 minutes - Bridge protocols and cross-chain operations  
- **Medium**: 30 minutes - Regional coordination and non-critical features
- **Low**: 60 minutes - Administrative and monitoring functions

### Recovery Point Objectives (RPO)
- **Critical**: 1 minute - Maximum acceptable data loss for critical operations
- **High**: 5 minutes - Bridge transactions and oracle updates
- **Medium**: 15 minutes - Regional sync and coordination data
- **Low**: 30 minutes - Non-critical operational data

### Availability Targets
- **Critical Components**: 99.99% uptime (52 minutes/year downtime)
- **High Priority**: 99.9% uptime (8.8 hours/year downtime)
- **Medium Priority**: 99.5% uptime (1.8 days/year downtime)
- **Low Priority**: 99.0% uptime (3.7 days/year downtime)

## Test Execution

### Run All Failover Tests
```bash
npx hardhat test test/failover/
```

### Run Specific Test Suites
```bash
# Basic FailureSimulator functionality
npx hardhat test test/failover/FailureSimulator.test.ts

# Infrastructure failure scenarios
npx hardhat test test/failover/InfrastructureFailureTests.test.ts

# Recovery procedure validation
npx hardhat test test/failover/RecoveryProcedures.test.ts
```

### Run Specific Failure Scenarios
```bash
# Oracle partition recovery
npx hardhat test test/failover/ --grep "oracle network partition"

# Bridge failure handling
npx hardhat test test/failover/ --grep "bridge module failure"

# RTO validation
npx hardhat test test/failover/ --grep "Recovery Time Objective"
```

## FailureSimulator Contract API

### Core Functions

#### Oracle Failure Simulation
```solidity
function registerOracleNode(address nodeAddress) external
function simulateOracleFailure(address nodeAddress, bool offline, bool corrupted, uint256 corruptionPercent) external
function recoverOracleNode(address nodeAddress) external
```

#### RPC Endpoint Simulation
```solidity
function registerRPCEndpoint(bytes32 endpointId, string calldata url) external
function simulateRPCFailure(bytes32 endpointId, string calldata reason) external
function simulateRPCCascadeFailure(bytes32[] calldata endpointIds) external
function recoverRPCEndpoint(bytes32 endpointId) external
```

#### Bridge Protocol Simulation
```solidity
function simulateBridgeFailure(uint256 protocol, bytes32 messageId) external
function simulateProtocolFailure(uint256 protocol, uint256 errorRate, uint256 latency) external
function recoverBridgeProtocol(uint256 protocol) external
```

#### Recovery Tracking
```solidity
function startRecoveryProcedure(bytes32 procedureId, string calldata failureType, uint256 rto, uint256 rpo) external
function completeRecoveryProcedure(bytes32 procedureId) external
function getRecoveryMetrics(bytes32 procedureId) external view returns (RecoveryMetrics)
```

### Access Control
- **FAILURE_ADMIN_ROLE**: Can initiate failure simulations
- **OPERATOR_ROLE**: Can perform recovery operations
- **DEFAULT_ADMIN_ROLE**: Full administrative control

## Test Scenarios

### 1. Oracle Network Partition Recovery
Tests oracle consensus recovery under network partition conditions:
- **Partition Detection**: Validates detection of oracle network splits
- **Consensus Degradation**: Tests system behavior with reduced oracle availability
- **Recovery Procedures**: Validates restoration of full consensus
- **Data Consistency**: Ensures no data loss during partition/recovery

### 2. Bridge Protocol Failures
Tests cross-chain bridge resilience:
- **Single Protocol Failure**: Automatic failover to alternative protocols
- **Cascading Failures**: Handling of multiple concurrent protocol failures
- **Load Redistribution**: Proper load balancing during failures
- **Service Restoration**: Complete protocol recovery procedures

### 3. RPC Endpoint Cascade Failures
Tests RPC infrastructure resilience:
- **Progressive Failures**: Gradual endpoint failure progression
- **Automatic Failover**: Transparent endpoint switching
- **Load Balancing**: Traffic redistribution during failures
- **Recovery Validation**: Endpoint restoration and health checking

### 4. Multi-Region Coordination
Tests geographic distribution resilience:
- **Regional Isolation**: Complete region connectivity loss
- **Split-Brain Prevention**: Coordination failure handling
- **Geographic Failover**: Cross-region service migration
- **Data Synchronization**: Regional sync restoration

### 5. Validator Set Corruption
Tests consensus mechanism resilience:
- **Corruption Detection**: Automated detection of validator issues
- **Threshold Management**: Behavior at various corruption levels
- **Emergency Procedures**: Actions when corruption exceeds safety limits
- **Set Restoration**: Complete validator set recovery

### 6. Emergency Migration
Tests complete system migration capabilities:
- **Migration Triggers**: Conditions requiring emergency migration
- **Data Preservation**: Ensuring zero data loss during migration
- **Service Continuity**: Minimizing service disruption
- **Rollback Procedures**: Handling migration failures

## Validation Criteria

### Functional Requirements
- ✅ All failure scenarios can be detected within specified timeframes
- ✅ Recovery procedures complete within RTO limits
- ✅ Data loss remains within RPO limits  
- ✅ Service availability meets SLO targets
- ✅ Emergency procedures can be executed successfully

### Performance Requirements
- ✅ Failure detection: < 30 seconds
- ✅ Recovery initiation: < 60 seconds
- ✅ Full service restoration within RTO
- ✅ Zero data corruption during failures
- ✅ Graceful degradation under stress

### Security Requirements
- ✅ Access controls prevent unauthorized failure simulation
- ✅ Recovery procedures maintain security posture
- ✅ No security vulnerabilities introduced during failures
- ✅ Audit trail maintained throughout recovery
- ✅ Emergency procedures cannot be abused

## Monitoring and Alerting

### Key Metrics Tracked
- **Recovery Time**: Actual vs. target RTO
- **Data Loss**: Actual vs. target RPO  
- **Availability**: Service uptime percentage
- **Mean Time To Recovery (MTTR)**: Average recovery duration
- **Mean Time Between Failures (MTBF)**: System reliability metric

### Alert Conditions
- RTO threshold exceeded (95% of limit)
- RPO violation detected
- Multiple concurrent failures
- Recovery procedure failure
- Emergency migration triggered

### Reporting
- Recovery procedure completion reports
- SLO compliance analysis
- Failure trend analysis
- Recovery time optimization recommendations
- Incident post-mortem generation

## Best Practices

### Test Development
1. **Realistic Scenarios**: Base tests on actual production failure patterns
2. **Comprehensive Coverage**: Test all failure modes and combinations
3. **Time Boundaries**: Validate RTO/RPO compliance strictly
4. **Data Integrity**: Verify data consistency throughout recovery
5. **Documentation**: Maintain clear test descriptions and expectations

### Recovery Procedures
1. **Automation First**: Prefer automated over manual recovery
2. **Clear Escalation**: Define escalation paths for complex failures
3. **Regular Testing**: Execute recovery procedures regularly
4. **Continuous Improvement**: Update procedures based on test results
5. **Documentation**: Maintain up-to-date recovery documentation

### Monitoring
1. **Proactive Detection**: Monitor leading indicators of failures
2. **Comprehensive Logging**: Log all recovery-related events
3. **Performance Tracking**: Monitor recovery procedure performance
4. **Trend Analysis**: Identify patterns in failure/recovery data
5. **Regular Reviews**: Periodically review and update monitoring

## Contributing

When adding new failure scenarios or recovery procedures:

1. **Document Scope**: Clearly define what failure condition is being tested
2. **Set Objectives**: Define specific RTO/RPO targets for the scenario
3. **Implement Simulation**: Add failure simulation to FailureSimulator.sol
4. **Write Tests**: Create comprehensive test coverage for the scenario
5. **Validate Metrics**: Ensure RTO/RPO compliance is validated
6. **Update Documentation**: Update this README with new scenario details

## References

- [LookCoin Technical Architecture](../../docs/TECHNICAL.md)
- [Security Procedures](../../docs/SECURITY.md)
- [Deployment Guide](../../docs/DEPLOYMENT.md)
- [Supply Oracle Documentation](../../docs/ORACLE.md)